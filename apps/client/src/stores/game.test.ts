import type { Cell, PublicGame } from '@ttt/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './game';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  closeWith(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  sentMessages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

function makeGame(overrides: Partial<PublicGame> = {}): PublicGame {
  return {
    id: 'game-1',
    code: 'ABC234',
    board: Array<Cell>(9).fill(null),
    players: {
      X: { name: 'Аня', connected: true },
      O: { name: 'Боб', connected: true },
    },
    turn: 'X',
    status: 'playing',
    winner: null,
    winningLine: null,
    version: 1,
    round: 1,
    rematchVotes: [],
    createdAt: 0,
    ...overrides,
  };
}

const session = {
  gameId: 'game-1',
  code: 'ABC234',
  playerId: 'player-1',
  mark: 'X' as const,
};

const SESSION_KEY = 'ttt:session:ABC234';

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  sessionStorage.clear();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(session), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('game store', () => {
  it('создаёт игру, сохраняет сессию и открывает сокет', async () => {
    const store = useGameStore();
    const code = await store.create();

    expect(code).toBe('ABC234');
    expect(store.session?.playerId).toBe('player-1');
    expect(sessionStorage.getItem(SESSION_KEY)).toContain('player-1');
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]!.url).toContain('/ws?code=ABC234');

    FakeSocket.instances[0]!.open();
    expect(store.connection).toBe('open');
  });

  it('применяет снапшот состояния и отправляет ход с версией', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.receive({ type: 'state', game: makeGame(), you: 'X' });
    expect(store.game?.status).toBe('playing');
    expect(store.you).toBe('X');
    expect(store.canPlay).toBe(true);

    store.play(4);
    expect(socket.sentMessages()).toEqual([
      { type: 'move', gameId: 'game-1', index: 4, version: 1 },
    ]);
  });

  it('игнорирует второй клик до прихода нового состояния', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'state', game: makeGame(), you: 'X' });

    store.play(0);
    store.play(1);
    expect(socket.sent).toHaveLength(1);

    socket.receive({
      type: 'state',
      game: makeGame({ version: 2, board: ['X', null, null, null, null, null, null, null, null] }),
      you: 'X',
    });
    expect(store.game?.version).toBe(2);
  });

  it('не отправляет ход, когда сейчас очередь соперника', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'state', game: makeGame({ turn: 'O' }), you: 'X' });

    expect(store.canPlay).toBe(false);
    store.play(0);
    expect(socket.sent).toHaveLength(0);
  });

  it('обновляет метку в сессии после рематча', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'state', game: makeGame(), you: 'X' });

    socket.receive({ type: 'state', game: makeGame({ status: 'finished', winner: 'X' }), you: 'X' });
    socket.receive({ type: 'state', game: makeGame({ version: 7 }), you: 'O' });

    expect(store.you).toBe('O');
    expect(store.session?.mark).toBe('O');
    expect(sessionStorage.getItem(SESSION_KEY)).toContain('"mark":"O"');
  });

  it('понимает, кто именно проголосовал за рематч', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.receive({
      type: 'state',
      game: makeGame({ status: 'finished', winner: 'X', rematchVotes: ['X'] }),
      you: 'X',
    });
    expect(store.rematchVotes).toBe(1);
    expect(store.myRematchVote).toBe(true);
    expect(store.opponentRematchVote).toBe(false);

    socket.receive({
      type: 'state',
      game: makeGame({ status: 'finished', winner: 'X', rematchVotes: ['X'] }),
      you: 'O',
    });
    expect(store.myRematchVote).toBe(false);
    expect(store.opponentRematchVote).toBe(true);

    socket.receive({ type: 'state', game: makeGame({ version: 7, rematchVotes: [] }), you: 'O' });
    expect(store.rematchVotes).toBe(0);
    expect(store.myRematchVote).toBe(false);
  });

  it('не отправляет голос за рематч без соединения', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({
      type: 'state',
      game: makeGame({ status: 'finished', winner: 'X' }),
      you: 'X',
    });

    socket.closeWith(1006, '');
    expect(store.connection).toBe('reconnecting');

    expect(store.voteRematch()).toBe(false);
    expect(socket.sentMessages()).not.toContainEqual({ type: 'rematch' });
    expect(store.error).toContain('соединения');

    store.disconnect();
  });

  it('показывает ошибку сервера', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.receive({ type: 'error', code: 'NOT_YOUR_TURN', message: 'Сейчас ход соперника' });
    expect(store.error).toBe('Сейчас ход соперника');
  });

  it('переподключается после обрыва связи', async () => {
    vi.useFakeTimers();
    const store = useGameStore();
    await store.create();

    const first = FakeSocket.instances[0]!;
    first.open();
    first.closeWith(1006, '');

    expect(store.connection).toBe('reconnecting');
    expect(FakeSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1]!.url).toContain('/ws?code=ABC234');
  });

  it('сбрасывает протухшую сессию и auth-состояние, если cookie истекла', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'state', game: makeGame(), you: 'X' });

    socket.closeWith(1008, 'unauthorized');

    expect(store.session).toBeNull();
    expect(store.game).toBeNull();
    expect(store.you).toBeNull();
    expect(store.connection).toBe('closed');
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(store.error).toContain('Сессия');
  });

  it('не переподключается, если игру открыли в другой вкладке', async () => {
    vi.useFakeTimers();
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.closeWith(4001, 'replaced-by-new-session');

    expect(store.connection).toBe('closed');
    expect(store.session).not.toBeNull();
    expect(store.error).toContain('другой вкладке');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('переподключается при превышении лимита соединений', async () => {
    vi.useFakeTimers();
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.closeWith(1008, 'too-many-connections');

    expect(store.connection).toBe('reconnecting');
    expect(store.session).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('очищает состояние при выходе из комнаты', async () => {
    const store = useGameStore();
    await store.create();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'state', game: makeGame(), you: 'X' });

    store.leave();

    expect(socket.sentMessages()).toContainEqual({ type: 'leave' });
    expect(store.session).toBeNull();
    expect(store.game).toBeNull();
    expect(store.you).toBeNull();
    expect(store.connection).toBe('closed');
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('переиспользует сохранённую сессию при входе в комнату', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

    const store = useGameStore();
    store.enter('abc234');

    expect(store.session?.code).toBe('ABC234');
    expect(store.you).toBe('X');
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('не подключается без сохранённой сессии', () => {
    const store = useGameStore();
    store.enter('ZZZZZZ');

    expect(store.session).toBeNull();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('не подключается по битой сессии из хранилища', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, mark: 'Z' }));

    const store = useGameStore();
    store.enter('ABC234');

    expect(store.session).toBeNull();
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
