import type { Mark } from '@ttt/shared';

export interface Session {
  gameId: string;
  code: string;
  playerId: string;
  token: string;
  mark: Mark;
  name: string;
}

const SESSION_PREFIX = 'ttt:session:';
const NAME_KEY = 'ttt:name';

/** Имя переживает перезапуск браузера, сессия — нет (она привязана к вкладке). */
function nameStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Сессии живут в sessionStorage: у каждой вкладки своя сессия.
 * Иначе вторая вкладка при входе в ту же комнату перезаписывала бы
 * токен первой, и после перезагрузки игрок превращался бы в соперника.
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

export function saveSession(session: Session): void {
  try {
    sessionStorageSafe()?.setItem(SESSION_PREFIX + session.code, JSON.stringify(session));
  } catch {
    // приватный режим / переполнение — переподключение просто не сработает
  }
}

export function loadSession(code: string): Session | null {
  try {
    const raw = sessionStorageSafe()?.getItem(SESSION_PREFIX + code.toUpperCase());
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isFilledString(parsed.gameId) || !isFilledString(parsed.playerId)) return null;
    if (!isFilledString(parsed.token) || !isFilledString(parsed.code)) return null;
    if (!isMark(parsed.mark)) return null;

    return {
      gameId: parsed.gameId,
      code: parsed.code.toUpperCase(),
      playerId: parsed.playerId,
      token: parsed.token,
      mark: parsed.mark,
      name: typeof parsed.name === 'string' ? parsed.name : '',
    };
  } catch {
    return null;
  }
}

export function clearSession(code: string): void {
  try {
    sessionStorageSafe()?.removeItem(SESSION_PREFIX + code.toUpperCase());
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
