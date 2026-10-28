/** Размер поля 3x3. */
export const BOARD_SIZE = 9;

/** Линия поля: три индекса, которые дают победу. */
export type WinLine = readonly [number, number, number];

export const WIN_LINES: readonly WinLine[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** Алфавит кода комнаты без похожих символов (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export const NAME_MAX_LENGTH = 20;

/** Сколько ждём вернувшегося игрока, прежде чем отменить партию. */
export const RECONNECT_GRACE_MS = 30_000;

/** Сколько живёт завершённая/брошенная комната. */
export const ROOM_TTL_MS = 10 * 60_000;

/** Лимит сообщений `move` на сокет. */
export const MOVE_RATE_LIMIT = 10;
export const MOVE_RATE_WINDOW_MS = 1_000;

/** Общий лимит WS-сообщений на сокет (включая ping/rematch). */
export const WS_MESSAGE_RATE_LIMIT = 30;
export const WS_MESSAGE_RATE_WINDOW_MS = 1_000;

/** Максимальный размер входящего WS-сообщения. */
export const MAX_MESSAGE_BYTES = 4_096;
