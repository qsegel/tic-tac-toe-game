import type { ApiErrorBody, GameSessionResponse } from '@ttt/shared';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const BASE_URL = import.meta.env.VITE_API_URL ?? '';
const WS_BASE_URL = import.meta.env.VITE_WS_URL ?? '';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Адрес сокета строится по тем же правилам, что и HTTP-база:
 * явный `VITE_WS_URL` → origin API → текущий origin.
 */
export function websocketUrl(token: string): string {
  const base = WS_BASE_URL || apiOrigin() || window.location.origin;
  const url = new URL('/ws', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}

/** Origin HTTP API, если он задан абсолютным URL; относительный путь живёт на текущем origin. */
function apiOrigin(): string | null {
  if (!BASE_URL) return null;
  try {
    const url = new URL(BASE_URL, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = init?.signal ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: init?.signal ?? controller?.signal,
    });
  } catch {
    const timedOut = controller?.signal.aborted === true;
    throw new ApiError(
      timedOut ? 'Сервер не отвечает. Попробуйте ещё раз.' : 'Сервер недоступен. Проверьте соединение.',
      'NETWORK',
      0,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const body = data as ApiErrorBody | null;
    throw new ApiError(
      body?.message ?? 'Не удалось выполнить запрос',
      body?.code ?? 'INTERNAL',
      response.status,
    );
  }

  return data as T;
}

export function createGame(name: string): Promise<GameSessionResponse> {
  return request<GameSessionResponse>('/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function joinGame(code: string, name: string): Promise<GameSessionResponse> {
  return request<GameSessionResponse>(`/api/games/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}
