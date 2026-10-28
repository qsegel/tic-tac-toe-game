import { randomInt, randomUUID } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  GameError,
  RECONNECT_GRACE_MS,
  ROOM_TTL_MS,
  applyMove,
  chooseBotMove,
  createBotGame,
  createGame,
  joinGame,
  makeSlot,
  markOf,
  opponentOf,
  startRematch,
} from '@ttt/shared';
import type { BotDifficulty, Game, Mark, PlayerSlot } from '@ttt/shared';

export interface CreateResult {
  game: Game;
  playerId: string;
  mark: Mark;
}

export interface AttachResult {
  game: Game;
  playerId: string;
  mark: Mark;
}

export interface JoinResult extends CreateResult {
  /** `true` — игрок только что занял второй слот; `false` — уже был в комнате. */
  created: boolean;
}

export interface RoomRegistryOptions {
  now?: () => number;
  graceMs?: number;
  ttlMs?: number;
  maxRooms?: number;
  /** Пауза перед ходом бота: нужна для UX и для тестов. */
  botDelayMs?: number;
  /** Источник случайности для бота (подменяется в тестах). */
  botRandom?: () => number;
}

type MarkPair = readonly [Mark, Mark];

const MARKS: MarkPair = ['X', 'O'];
const BOT_NAME = 'Бот';
const DEFAULT_BOT_DELAY_MS = 550;

/**
 * Хранилище комнат в памяти процесса.
 *
 * Всё состояние партии живёт здесь, поэтому при рестарте сервера партии
 * теряются — для MVP это осознанный компромисс. Идентификация игроков
 * приходит снаружи: `playerId` — это id аккаунта или гостя.
 */
export class RoomRegistry {
  private readonly games = new Map<string, Game>();
  private readonly codes = new Map<string, string>();
  private readonly abandonTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<(game: Game) => void>();
  private disposed = false;

  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly ttlMs: number;
  private readonly maxRooms: number;
  private readonly botDelayMs: number;
  private readonly botRandom: () => number;

  constructor(options: RoomRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.graceMs = options.graceMs ?? RECONNECT_GRACE_MS;
    this.ttlMs = options.ttlMs ?? ROOM_TTL_MS;
    this.maxRooms = options.maxRooms ?? 10_000;
    this.botDelayMs = options.botDelayMs ?? DEFAULT_BOT_DELAY_MS;
    this.botRandom = options.botRandom ?? Math.random;
  }

  /** Подписка на изменения: WS-рассылка и запись истории. */
  subscribe(listener: (game: Game) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getByCode(code: string): Game | undefined {
    const gameId = this.codes.get(code.trim().toUpperCase());
    return gameId ? this.games.get(gameId) : undefined;
  }

  create(playerId: string, name: string): CreateResult {
    if (this.games.size >= this.maxRooms) {
      throw new GameError('ROOM_LIMIT', 'Сервер перегружен, попробуйте позже');
    }

    const now = this.now();
    const code = this.uniqueCode();
    const host = makeSlot({ playerId, name });
    const game = createGame({ id: randomUUID(), code, host, now });

    this.games.set(game.id, game);
    this.codes.set(code, game.id);

    return { game, playerId: host.playerId, mark: 'X' };
  }

  /** Тренировочная партия: бот занимает второй слот сразу. */
  createBot(playerId: string, name: string, difficulty: BotDifficulty): CreateResult {
    if (this.games.size >= this.maxRooms) {
      throw new GameError('ROOM_LIMIT', 'Сервер перегружен, попробуйте позже');
    }

    const now = this.now();
    const code = this.uniqueCode();
    const host = makeSlot({ playerId, name });
    const game = createBotGame({
      id: randomUUID(),
      code,
      host,
      botId: `bot_${randomUUID()}`,
      botName: BOT_NAME,
      difficulty,
      now,
    });

    this.games.set(game.id, game);
    this.codes.set(code, game.id);
    // Человек ещё не открыл сокет: если он передумал, комната не должна висеть.
    this.scheduleForDisconnected(game);

    return { game, playerId: host.playerId, mark: 'X' };
  }

  join(code: string, playerId: string, name: string): JoinResult {
    const game = this.getByCode(code);
    if (!game) {
      throw new GameError('NOT_FOUND', 'Комната не найдена');
    }

    // Повторный вход того же игрока (перезагрузка, возврат по ссылке)
    // не должен создавать второго участника.
    const existing = markOf(game, playerId);
    if (existing) {
      return { game, playerId, mark: existing, created: false };
    }

    const guest = makeSlot({ playerId, name });
    const next = joinGame(game, guest, this.now());

    this.games.set(next.id, next);
    // Гость мог так и не открыть сокет: не даём партии зависнуть навсегда.
    this.scheduleForDisconnected(next);
    this.emit(next);

    return { game: next, playerId: guest.playerId, mark: 'O', created: true };
  }

  move(gameId: string, playerId: string, index: number, version: number): Game {
    const game = this.getGame(gameId);
    const next = applyMove(game, { playerId, index, version }, this.now());
    this.games.set(next.id, next);
    this.emit(next);
    this.maybeScheduleBot(next);
    return next;
  }

  rematch(gameId: string, playerId: string): Game {
    const game = this.getGame(gameId);

    // Повторный голос того же игрока не должен порождать рассылку.
    if (game.rematchVotes.includes(playerId)) {
      return game;
    }

    let result = startRematch(game, playerId, this.now());

    // Бот соглашается сразу после человека: не заставляем ждать ответа.
    if (
      result.game.mode === 'bot' &&
      result.game.botPlayerId &&
      !result.game.rematchVotes.includes(result.game.botPlayerId)
    ) {
      result = startRematch(result.game, result.game.botPlayerId, this.now());
    }

    const next = result.game;
    this.games.set(next.id, next);
    if (result.started) {
      this.scheduleForDisconnected(next);
    }
    this.emit(next);
    if (result.started) {
      this.maybeScheduleBot(next);
    }
    return next;
  }

  /** Игрок открыл сокет (впервые или после обрыва). */
  attach(code: string, playerId: string): AttachResult {
    const game = this.getByCode(code);
    if (!game) {
      throw new GameError('NOT_FOUND', 'Партия не найдена');
    }

    const mark = markOf(game, playerId);
    if (!mark) {
      throw new GameError('NOT_IN_GAME', 'Вы не участник этой партии');
    }

    this.clearAbandonTimer(game.id, playerId);

    const wasDisconnected = !slotOf(game, mark).connected;
    if (!wasDisconnected) {
      return { game, playerId, mark };
    }

    const next = this.cloneAndStore(game);
    const nextSlot = slotOf(next, mark);
    nextSlot.connected = true;
    nextSlot.disconnectedAt = null;
    next.updatedAt = this.now();
    this.emit(next);
    this.maybeScheduleBot(next);

    return { game: next, playerId, mark };
  }

  /** Сокет закрылся: даём время на переподключение. */
  detach(gameId: string, playerId: string): void {
    if (this.disposed) return;
    const game = this.games.get(gameId);
    if (!game) return;

    const mark = markOf(game, playerId);
    if (!mark) return;
    if (!slotOf(game, mark).connected) return;

    const next = this.cloneAndStore(game);
    const nextSlot = slotOf(next, mark);
    nextSlot.connected = false;
    nextSlot.disconnectedAt = this.now();
    next.updatedAt = this.now();

    if (next.status === 'playing' || next.status === 'waiting') {
      this.scheduleAbandon(next.id, playerId);
    }
    this.emit(next);
  }

  /** Явный выход из комнаты. */
  leave(gameId: string, playerId: string): Game | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const mark = markOf(game, playerId);
    if (!mark) return null;

    // С ботом прощаться не нужно: комната сразу становится ненужной.
    if (game.mode === 'bot') {
      this.deleteGame(game.id);
      return null;
    }

    if (game.status === 'waiting') {
      this.deleteGame(game.id);
      return null;
    }

    if (game.status === 'playing') {
      this.abandon(game.id, playerId, true);
      return this.games.get(game.id) ?? null;
    }

    const next = this.cloneAndStore(game);
    const nextSlot = slotOf(next, mark);
    nextSlot.connected = false;
    nextSlot.disconnectedAt = this.now();
    next.updatedAt = this.now();
    this.emit(next);
    return next;
  }

  /** Удаляет комнаты, в которых никого нет, чтобы Map не рос бесконечно. */
  sweep(): number {
    const now = this.now();
    let removed = 0;

    for (const [gameId, game] of this.games) {
      const idle = now - game.updatedAt;
      // Бот «подключён» всегда, но живой комнату делает только человек.
      const hasPlayers = hasHumanConnected(game);

      // Комнату с живыми игроками не трогаем: иначе рематч вернёт NOT_FOUND.
      if (idle > this.ttlMs && !hasPlayers) {
        this.deleteGame(gameId);
        removed += 1;
      }
    }

    return removed;
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.abandonTimers.values()) {
      clearTimeout(timer);
    }
    this.abandonTimers.clear();
    for (const timer of this.botTimers.values()) {
      clearTimeout(timer);
    }
    this.botTimers.clear();
    this.listeners.clear();
    this.games.clear();
    this.codes.clear();
  }

  // ── внутреннее ────────────────────────────────────────────────────────────

  private emit(game: Game): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      listener(game);
    }
  }

  private getGame(gameId: string): Game {
    const game = this.games.get(gameId);
    if (!game) {
      throw new GameError('NOT_FOUND', 'Партия не найдена');
    }
    return game;
  }

  private cloneAndStore(game: Game): Game {
    const next: Game = {
      ...game,
      board: [...game.board],
      players: { X: { ...game.players.X }, O: game.players.O ? { ...game.players.O } : null },
      rematchVotes: [...game.rematchVotes],
      winningLine: game.winningLine ? [...game.winningLine] : null,
    };
    this.games.set(next.id, next);
    return next;
  }

  private scheduleForDisconnected(game: Game): void {
    for (const mark of MARKS) {
      const slot = game.players[mark];
      if (!slot || slot.connected) continue;
      this.scheduleAbandon(game.id, slot.playerId);
    }
  }

  private scheduleAbandon(gameId: string, playerId: string): void {
    if (this.disposed) return;
    const key = timerKey(gameId, playerId);
    this.clearAbandonTimer(gameId, playerId);

    const timer = setTimeout(() => {
      this.abandonTimers.delete(key);
      this.abandon(gameId, playerId, false);
    }, this.graceMs);
    timer.unref?.();
    this.abandonTimers.set(key, timer);
  }

  private clearAbandonTimer(gameId: string, playerId: string): void {
    const key = timerKey(gameId, playerId);
    const timer = this.abandonTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.abandonTimers.delete(key);
    }
  }

  private abandon(gameId: string, playerId: string, force: boolean): void {
    if (this.disposed) return;
    const game = this.games.get(gameId);
    if (!game) return;

    const mark = markOf(game, playerId);
    if (!mark) return;
    if (!force && slotOf(game, mark).connected) return;

    // Комната ожидания без второго игрока никому не нужна: после grace-периода
    // удаляем её, а не оставляем «брошенной» до общего TTL.
    if (game.status === 'waiting') {
      this.deleteGame(gameId);
      return;
    }
    if (game.status !== 'playing') return;

    const other = opponentOf(mark);
    const opponentSlot = game.players[other];
    const next = this.cloneAndStore(game);
    const nextSlot = slotOf(next, mark);
    nextSlot.connected = false;
    nextSlot.disconnectedAt = this.now();
    next.status = 'abandoned';
    // Победитель — только если соперник действительно остался в игре.
    next.winner = game.status === 'playing' && opponentSlot?.connected ? other : null;
    next.version += 1;
    next.updatedAt = this.now();

    if (opponentSlot) {
      this.clearAbandonTimer(gameId, opponentSlot.playerId);
    }
    this.emit(next);

    // С ботом некого ждать: после grace-периода комнату можно удалить.
    if (next.mode === 'bot') {
      this.deleteGame(gameId);
    }
  }

  /**
   * Планирует ход бота, если сейчас его очередь. Таймер перечитывает
   * состояние: за время «раздумий» партию могли бросить или перезапустить.
   */
  private maybeScheduleBot(game: Game): void {
    if (this.disposed) return;
    this.clearBotTimer(game.id);
    if (game.mode !== 'bot' || !game.botPlayerId) return;
    if (game.status !== 'playing') return;

    const botMark = markOf(game, game.botPlayerId);
    if (!botMark || game.turn !== botMark) return;

    const version = game.version;
    const timer = setTimeout(() => {
      this.botTimers.delete(game.id);
      const current = this.games.get(game.id);
      if (!current || current.status !== 'playing' || current.version !== version) return;
      if (!current.botPlayerId) return;

      const mark = markOf(current, current.botPlayerId);
      if (!mark || current.turn !== mark) return;

      const index = chooseBotMove(
        current.board,
        mark,
        current.botDifficulty ?? 'medium',
        this.botRandom,
      );
      if (index === null) return;

      try {
        const moved = applyMove(
          current,
          { playerId: current.botPlayerId, index, version: current.version },
          this.now(),
        );
        this.games.set(moved.id, moved);
        this.emit(moved);
        this.maybeScheduleBot(moved);
      } catch {
        // Состояние изменилось, пока бот «думал»: следующий ход запланирует
        // тот, кто это изменение сделал.
      }
    }, this.botDelayMs);
    timer.unref?.();
    this.botTimers.set(game.id, timer);
  }

  private clearBotTimer(gameId: string): void {
    const timer = this.botTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.botTimers.delete(gameId);
    }
  }

  private uniqueCode(): string {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      let code = '';
      for (let index = 0; index < CODE_LENGTH; index += 1) {
        code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)] ?? '';
      }
      if (!this.codes.has(code)) return code;
    }
    throw new GameError('INTERNAL', 'Не удалось создать комнату, попробуйте ещё раз');
  }

  private deleteGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;

    this.codes.delete(game.code);
    this.clearBotTimer(gameId);
    for (const mark of MARKS) {
      const slot = game.players[mark];
      if (!slot) continue;
      this.clearAbandonTimer(gameId, slot.playerId);
    }
    this.games.delete(gameId);
  }
}

function timerKey(gameId: string, playerId: string): string {
  return `${gameId}:${playerId}`;
}

function hasHumanConnected(game: Game): boolean {
  return MARKS.some((mark) => {
    const slot = game.players[mark];
    if (!slot || !slot.connected) return false;
    return slot.playerId !== game.botPlayerId;
  });
}

function slotOf(game: Game, mark: Mark): PlayerSlot {
  const slot = game.players[mark];
  if (!slot) {
    throw new GameError('NOT_IN_GAME', 'Игрок не найден в партии');
  }
  return slot;
}
