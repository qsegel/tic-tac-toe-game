import { CODE_ALPHABET, CODE_LENGTH } from '@ttt/shared';
import type { GameMode, Mark } from '@ttt/shared';

export interface Session {
  gameId: string;
  code: string;
  playerId: string;
  mark: Mark;
  mode: GameMode;
}

const SESSION_PREFIX = 'ttt:session:';
const NAME_KEY = 'ttt:name';

/** Имя гостя переживает перезапуск браузера, сессия — нет (она привязана к вкладке). */
function nameStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Сессии живут в sessionStorage: у каждой вкладки своя игровая сессия.
 * Идентификация пользователя при этом общая — она в httpOnly cookie.
 */
function sessionStorageSafe(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isMark(value: unknown): value is Mark {
  return value === 'X' || value === 'O';
}

/** Код комнаты в хранилище всегда в верхнем регистре. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Проверка формата кода до запроса на сервер. */
export function isGameCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  return [...code].every((char) => CODE_ALPHABET.includes(char));
}

export function saveSession(session: Session): void {
  const code = normalizeCode(session.code);
  if (!isGameCode(code)) return;
  try {
    sessionStorageSafe()?.setItem(SESSION_PREFIX + code, JSON.stringify({ ...session, code }));
  } catch {
    // приватный режим / переполнение — переподключение просто не сработает
  }
}

export function loadSession(code: string): Session | null {
  const key = normalizeCode(code);
  if (!isGameCode(key)) return null;

  try {
    const raw = sessionStorageSafe()?.getItem(SESSION_PREFIX + key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isFilledString(parsed.gameId) || !isFilledString(parsed.playerId)) return null;
    if (!isFilledString(parsed.code)) return null;
    if (normalizeCode(parsed.code) !== key) return null;
    if (!isMark(parsed.mark)) return null;

    return {
      gameId: parsed.gameId,
      code: key,
      playerId: parsed.playerId,
      mark: parsed.mark,
      // Старые сессии в sessionStorage не знают о режиме — считаем их обычными.
      mode: parsed.mode === 'bot' ? 'bot' : 'pvp',
    };
  } catch {
    return null;
  }
}

export function clearSession(code: string): void {
  const key = normalizeCode(code);
  if (!isGameCode(key)) return;
  try {
    sessionStorageSafe()?.removeItem(SESSION_PREFIX + key);
  } catch {
    // ignore
  }
}

export function loadName(): string {
  try {
    return nameStorage()?.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    nameStorage()?.setItem(NAME_KEY, name);
  } catch {
    // ignore
  }
}
