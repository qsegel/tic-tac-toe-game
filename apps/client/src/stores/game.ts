import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { BotDifficulty, ClientMessage, Mark, PublicGame, ServerMessage } from '@ttt/shared';
import { ApiError, createBotGame, createGame, joinGame, websocketUrl } from '@/lib/api';
import { clearSession, loadSession, saveSession, type Session } from '@/lib/session';
import { useAuthStore } from '@/stores/auth';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

const HEARTBEAT_MS = 25_000;
const SILENCE_LIMIT_MS = 60_000;
const MOVE_TIMEOUT_MS = 8_000;
const REMATCH_TIMEOUT_MS = 8_000;
const CLOSE_REPLACED = 4001;
const CLOSE_POLICY_VIOLATION = 1008;

/** Причины закрытия сокета, после которых сохранённая сессия бесполезна. */
const STALE_SESSION_REASONS = new Set([
  'invalid-token',
  'token-required',
  'unauthorized',
  'code-required',
  'INVALID_TOKEN',
  'NOT_FOUND',
  'NOT_IN_GAME',
]);

export const useGameStore = defineStore('game', () => {
  const session = ref<Session | null>(null);
  const game = ref<PublicGame | null>(null);
  const you = ref<Mark | null>(null);
  const connection = ref<ConnectionState>('idle');
  const error = ref<string | null>(null);
  const pendingMove = ref(false);
  const pendingRematch = ref(false);
  const sessionExpired = ref(false);

  const socket = shallowRef<WebSocket | null>(null);

  let retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let rematchTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMessageAt = 0;
  let manualClose = false;

  const opponentMark = computed<Mark | null>(() => {
    if (you.value === 'X') return 'O';
    if (you.value === 'O') return 'X';
    return null;
  });

  const me = computed(() => {
    if (!game.value || !you.value) return null;
    return game.value.players[you.value];
  });

  const opponent = computed(() => {
    if (!game.value || !opponentMark.value) return null;
    return game.value.players[opponentMark.value];
  });

  const opponentOnline = computed(() => opponent.value?.connected === true);
  const isBotGame = computed(() => (game.value?.mode ?? session.value?.mode) === 'bot');
  const isMyTurn = computed(() => game.value?.status === 'playing' && game.value.turn === you.value);
  const canPlay = computed(
    () => isMyTurn.value && connection.value === 'open' && !pendingMove.value,
  );
  const rematchVotes = computed(() => game.value?.rematchVotes.length ?? 0);
  const myRematchVote = computed(() =>
    you.value ? (game.value?.rematchVotes.includes(you.value) ?? false) : false,
  );
  const opponentRematchVote = computed(() =>
    opponentMark.value ? (game.value?.rematchVotes.includes(opponentMark.value) ?? false) : false,
  );
  const waitingForOpponent = computed(() => game.value?.status === 'waiting');

  /**
   * `sticky` — сообщение не исчезает само: проблемы с сессией и соединением
   * должны висеть, пока пользователь их не решит.
   */
  function setError(message: string | null, sticky = false): void {
    error.value = message;
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    if (message && !sticky) {
      errorTimer = setTimeout(() => {
        error.value = null;
        errorTimer = null;
      }, 6_000);
    }
  }

  function send(message: ClientMessage): boolean {
    const current = socket.value;
    if (!current || current.readyState !== WebSocket.OPEN) return false;
    try {
      current.send(JSON.stringify(message));
      return true;
    } catch {
      // Сокет мог закрыться между проверкой readyState и отправкой.
      return false;
    }
  }

  /** Возврат во вкладку не должен выглядеть как «минута тишины» и рвать живой сокет. */
  function onVisibilityChange(): void {
    if (typeof document === 'undefined' || document.hidden) return;
    lastMessageAt = Date.now();
    send({ type: 'ping' });
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    lastMessageAt = Date.now();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastMessageAt > SILENCE_LIMIT_MS) {
        // В фоновой вкладке таймеры троттлятся: не рвём сокет из-за этого.
        if (typeof document !== 'undefined' && document.hidden) return;
        socket.value?.close();
        return;
      }
      send({ type: 'ping' });
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  }

  function detachSocket(): void {
    const current = socket.value;
    if (!current) return;
    socket.value = null;
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    try {
      current.close();
    } catch {
      // сокет уже закрыт
    }
  }

  function clearRetryTimer(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function clearMovePending(): void {
    pendingMove.value = false;
    if (moveTimer) {
      clearTimeout(moveTimer);
      moveTimer = null;
    }
  }

  function clearRematchPending(): void {
    pendingRematch.value = false;
    if (rematchTimer) {
      clearTimeout(rematchTimer);
      rematchTimer = null;
    }
  }

  function clearPending(): void {
    clearMovePending();
    clearRematchPending();
  }

  function clearGameState(): void {
    game.value = null;
    you.value = null;
    clearPending();
  }

  /**
   * Сессия стала недействительной (рестарт сервера, истёк TTL комнаты,
   * чужой/битый токен). Сбрасываем её, чтобы показать форму входа.
   */
  function forgetSession(message: string): void {
    const active = session.value;
    if (active) clearSession(active.code);
    retry = 0;
    clearRetryTimer();
    stopHeartbeat();
    clearPending();
    session.value = null;
    clearGameState();
    connection.value = 'closed';
    setError(message, true);
  }

  function connect(fresh = false): void {
    const active = session.value;
    if (!active) return;

    if (fresh) retry = 0;
    manualClose = false;
    clearPending();
    clearRetryTimer();
    detachSocket();
    connection.value = retry > 0 ? 'reconnecting' : 'connecting';

    let ws: WebSocket;
    try {
      ws = new WebSocket(websocketUrl(active.code));
    } catch {
      connection.value = 'closed';
      setError('Не удалось подключиться к игре — проверьте адрес сервера', true);
      return;
    }
    socket.value = ws;

    ws.onopen = () => {
      connection.value = 'open';
      retry = 0;
      startHeartbeat();
    };

    ws.onmessage = (event: MessageEvent) => {
      lastMessageAt = Date.now();
      handleMessage(String(event.data));
    };

    ws.onclose = (event: CloseEvent) => {
      stopHeartbeat();
      clearPending();
      if (socket.value === ws) socket.value = null;
      if (manualClose) {
        connection.value = 'closed';
        return;
      }
      handleClose(event);
    };
  }

  function handleClose(event: CloseEvent): void {
    const { code, reason } = event;

    if (code === CLOSE_REPLACED || reason === 'replaced-by-new-session') {
      connection.value = 'closed';
      setError('Игра уже открыта в другой вкладке', true);
      return;
    }

    if (reason === 'unauthorized') {
      useAuthStore().clear();
      sessionExpired.value = true;
      forgetSession('Сессия истекла — войдите снова');
      return;
    }

    if (STALE_SESSION_REASONS.has(reason)) {
      forgetSession(
        reason === 'NOT_FOUND'
          ? 'Комната больше не существует — войдите в другую или создайте новую'
          : 'Сессия недействительна — войдите в комнату заново',
      );
      return;
    }

    if (reason === 'too-many-connections') {
      connection.value = 'reconnecting';
      setError('Слишком много подключений — пробуем ещё раз');
      scheduleReconnect();
      return;
    }

    if (reason === 'origin-not-allowed') {
      connection.value = 'closed';
      setError('Сервер не разрешает подключение с этого адреса', true);
      return;
    }

    // Фолбэк для серверов, которые не передают reason.
    if (code === CLOSE_POLICY_VIOLATION) {
      forgetSession('Сессия недействительна — войдите в комнату заново');
      return;
    }

    connection.value = 'reconnecting';
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    retry += 1;
    const delay = Math.min(500 * 2 ** Math.min(retry - 1, 5), 8_000) + Math.random() * 250;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function handleMessage(raw: string): void {
    if (!session.value) return;

    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    if (message.type === 'state') {
      clearPending();
      game.value = message.game;
      you.value = message.you;
      if (session.value && session.value.mark !== message.you) {
        session.value = { ...session.value, mark: message.you };
        saveSession(session.value);
      }
      return;
    }

    if (message.type === 'error') {
      clearPending();
      setError(message.message);
    }
  }

  function disconnect(): void {
    manualClose = true;
    clearRetryTimer();
    stopHeartbeat();
    clearPending();
    detachSocket();
    connection.value = 'closed';
    setError(null);
  }

  function enter(code: string): void {
    setError(null);
    sessionExpired.value = false;
    const normalized = code.toUpperCase();

    if (session.value?.code === normalized) {
      if (!socket.value) connect(true);
      return;
    }

    disconnect();
    session.value = null;
    clearGameState();

    const saved = loadSession(normalized);
    if (!saved) return;

    session.value = saved;
    you.value = saved.mark;
    connect(true);
  }

  async function create(): Promise<string> {
    setError(null);
    sessionExpired.value = false;
    try {
      const response = await createGame();
      const next: Session = { ...response };
      saveSession(next);
      session.value = next;
      clearGameState();
      you.value = next.mark;
      connect(true);
      return next.code;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось создать игру');
      throw cause;
    }
  }

  async function createBot(difficulty: BotDifficulty): Promise<string> {
    setError(null);
    sessionExpired.value = false;
    try {
      const response = await createBotGame(difficulty);
      const next: Session = { ...response };
      saveSession(next);
      session.value = next;
      clearGameState();
      you.value = next.mark;
      connect(true);
      return next.code;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось начать игру с ботом');
      throw cause;
    }
  }

  async function join(code: string): Promise<void> {
    setError(null);
    sessionExpired.value = false;
    try {
      const response = await joinGame(code);
      const next: Session = { ...response };
      saveSession(next);
      session.value = next;
      clearGameState();
      you.value = next.mark;
      connect(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось войти в игру');
      throw cause;
    }
  }

  function play(index: number): void {
    const active = session.value;
    const current = game.value;
    if (!active || !current || !canPlay.value || pendingMove.value) return;
    if (current.board[index]) return;
    if (!send({ type: 'move', gameId: active.gameId, index, version: current.version })) {
      setError('Не удалось отправить ход — проверьте соединение');
      return;
    }

    pendingMove.value = true;
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      moveTimer = null;
      pendingMove.value = false;
      setError('Сервер не ответил на ход — попробуйте ещё раз');
    }, MOVE_TIMEOUT_MS);
  }

  function voteRematch(): boolean {
    if (myRematchVote.value || pendingRematch.value) return false;
    if (connection.value !== 'open') {
      setError('Нет соединения — дождитесь переподключения');
      return false;
    }
    if (!send({ type: 'rematch' })) {
      setError('Не удалось отправить запрос — проверьте соединение');
      return false;
    }

    pendingRematch.value = true;
    if (rematchTimer) clearTimeout(rematchTimer);
    rematchTimer = setTimeout(() => {
      rematchTimer = null;
      pendingRematch.value = false;
      setError('Сервер не ответил на запрос рематча — попробуйте ещё раз');
    }, REMATCH_TIMEOUT_MS);
    return true;
  }

  function leave(): void {
    sessionExpired.value = false;
    const active = session.value;
    if (!active) {
      clearPending();
      return;
    }
    send({ type: 'leave' });
    clearSession(active.code);
    session.value = null;
    clearGameState();
    disconnect();
  }

  function clearSessionExpired(): void {
    sessionExpired.value = false;
  }

  return {
    session,
    game,
    you,
    connection,
    error,
    pendingMove,
    pendingRematch,
    sessionExpired,
    me,
    opponent,
    opponentMark,
    opponentOnline,
    isBotGame,
    isMyTurn,
    canPlay,
    rematchVotes,
    myRematchVote,
    opponentRematchVote,
    waitingForOpponent,
    enter,
    create,
    createBot,
    join,
    play,
    voteRematch,
    leave,
    disconnect,
    clearSessionExpired,
    setError,
  };
});
