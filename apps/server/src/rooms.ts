import { randomInt, randomUUID } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  GameError,
  RECONNECT_GRACE_MS,
  ROOM_TTL_MS,
  applyMove,
  createGame,
  joinGame,
  makeSlot,
  markOf,
  opponentOf,
  startRematch,
} from '@ttt/shared';
import type { Game, Mark, PlayerSlot } from '@ttt/shared';

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

export interface RoomRegistryOptions {
  now?: () => number;
  graceMs?: number;
  ttlMs?: number;
  maxRooms?: number;
}

type MarkPair = readonly [Mark, Mark];

const MARKS: MarkPair = ['X', 'O'];

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
  private readonly listeners = new Set<(game: Game) => void>();

  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly ttlMs: number;
  private readonly maxRooms: number;

  constructor(options: RoomRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.graceMs = options.graceMs ?? RECONNECT_GRACE_MS;
    this.ttlMs = options.ttlMs ?? ROOM_TTL_MS;
    this.maxRooms = options.maxRooms ?? 10_000;
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

  join(code: string, playerId: string, name: string): CreateResult {
    const game = this.getByCode(code);
    if (!game) {
      throw new GameError('NOT_FOUND', 'Комната не найдена');
    }

    // Повторный вход того же игрока (перезагрузка, возврат по ссылке)
    // не должен создавать второго участника.
    const existing = markOf(game, playerId);
    if (existing) {
      return { game, playerId, mark: existing };
    }

    const guest = makeSlot({ playerId, name });
    const next = joinGame(game, guest, this.now());

    this.games.set(next.id, next);
    // Гость мог так и не открыть сокет: не даём партии зависнуть навсегда.
    this.scheduleForDisconnected(next);
    this.emit(next);

    return { game: next, playerId: guest.playerId, mark: 'O' };
  }

  move(gameId: string, playerId: string, index: number, version: number): Game {
    const game = this.getGame(gameId);
    const next = applyMove(game, { playerId, index, version }, this.now());
    this.games.set(next.id, next);
    this.emit(next);
    return next;
  }

  rematch(gameId: string, playerId: string): Game {
    const game = this.getGame(gameId);

    // Повторный голос того же игрока не должен порождать рассылку.
    if (game.rematchVotes.includes(playerId)) {
      return game;
    }

    const { game: next, started } = startRematch(game, playerId, this.now());
    this.games.set(next.id, next);
    if (started) {
      this.scheduleForDisconnected(next);
    }
    this.emit(next);
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

    return { game: next, playerId, mark };
  }

  /** Сокет закрылся: даём время на переподключение. */
  detach(gameId: string, playerId: string): void {
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
      const hasPlayers = game.players.X.connected || game.players.O?.connected === true;

      // Комнату с живыми игроками не трогаем: иначе рематч вернёт NOT_FOUND.
      if (idle > this.ttlMs && !hasPlayers) {
        this.deleteGame(gameId);
        removed += 1;
      }
    }

    return removed;
  }

  dispose(): void {
    for (const timer of this.abandonTimers.values()) {
      clearTimeout(timer);
    }
    this.abandonTimers.clear();
    this.listeners.clear();
  }

  // ── внутреннее ────────────────────────────────────────────────────────────

  private emit(game: Game): void {
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

function slotOf(game: Game, mark: Mark): PlayerSlot {
  const slot = game.players[mark];
  if (!slot) {
    throw new GameError('NOT_IN_GAME', 'Игрок не найден в партии');
  }
  return slot;
}
