import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { ClientMessage, Mark, PublicGame, ServerMessage } from '@ttt/shared';
import { ApiError, createGame, joinGame, websocketUrl } from '@/lib/api';
import { clearSession, loadSession, saveSession, type Session } from '@/lib/session';
import { useAuthStore } from '@/stores/auth';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

const HEARTBEAT_MS = 25_000;
const SILENCE_LIMIT_MS = 60_000;
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

  const socket = shallowRef<WebSocket | null>(null);

  let retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMessageAt = 0;
  let manualClose = false;
  let awaitingState = false;

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
  const isMyTurn = computed(() => game.value?.status === 'playing' && game.value.turn === you.value);
  const canPlay = computed(() => isMyTurn.value && connection.value === 'open');
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
    current.send(JSON.stringify(message));
    return true;
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    lastMessageAt = Date.now();
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

  function clearGameState(): void {
    game.value = null;
    you.value = null;
    awaitingState = false;
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
    awaitingState = false;
    clearRetryTimer();
    detachSocket();
    connection.value = retry > 0 ? 'reconnecting' : 'connecting';

    const ws = new WebSocket(websocketUrl(active.code));
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
      awaitingState = false;
      game.value = message.game;
      you.value = message.you;
      if (session.value && session.value.mark !== message.you) {
        session.value = { ...session.value, mark: message.you };
        saveSession(session.value);
      }
      return;
    }

    if (message.type === 'error') {
      awaitingState = false;
      setError(message.message);
    }
  }

  function disconnect(): void {
    manualClose = true;
    clearRetryTimer();
    stopHeartbeat();
    detachSocket();
    connection.value = 'closed';
    setError(null);
  }

  function enter(code: string): void {
    setError(null);
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

  async function join(code: string): Promise<void> {
    setError(null);
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
    if (!active || !current || !canPlay.value || awaitingState) return;
    if (current.board[index]) return;
    if (send({ type: 'move', gameId: active.gameId, index, version: current.version })) {
      awaitingState = true;
    }
  }

  function voteRematch(): boolean {
    if (myRematchVote.value) return false;
    if (connection.value !== 'open') {
      setError('Нет соединения — дождитесь переподключения');
      return false;
    }
    return send({ type: 'rematch' });
  }

  function leave(): void {
    const active = session.value;
    if (!active) return;
    send({ type: 'leave' });
    clearSession(active.code);
    session.value = null;
    clearGameState();
    disconnect();
  }

  return {
    session,
    game,
    you,
    connection,
    error,
    me,
    opponent,
    opponentMark,
    opponentOnline,
    isMyTurn,
    canPlay,
    rematchVotes,
    myRematchVote,
    opponentRematchVote,
    waitingForOpponent,
    enter,
    create,
    join,
    play,
    voteRematch,
    leave,
    disconnect,
    setError,
  };
});
