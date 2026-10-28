import type {
  ApiErrorBody,
  AuthResponse,
  BotDifficulty,
  GameSessionResponse,
  LeaderboardResponse,
  MatchListResponse,
  StatsResponse,
} from '@ttt/shared';

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

/** Убираем хвостовые слэши: иначе `/api/...` превращается в `//api/...`. */
function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

const BASE_URL = withoutTrailingSlash(import.meta.env.VITE_API_URL ?? '');
const WS_BASE_URL = withoutTrailingSlash(import.meta.env.VITE_WS_URL ?? '');
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Адрес сокета строится по тем же правилам, что и HTTP-база:
 * явный `VITE_WS_URL` → origin API → текущий origin.
 *
 * `wss:` сохраняем отдельно: на HTTPS-странице `ws:` будет заблокирован
 * браузером как mixed content.
 */
export function websocketUrl(code: string): string {
  const base = WS_BASE_URL || apiOrigin() || window.location.origin;

  let url: URL;
  try {
    url = new URL('/ws', base);
  } catch {
    // Некорректный VITE_WS_URL не должен ломать игровой экран.
    url = new URL('/ws', window.location.origin);
  }

  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  url.searchParams.set('code', code.toUpperCase());
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
      credentials: 'include',
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
  let parsed = false;
  if (text) {
    try {
      data = JSON.parse(text);
      parsed = true;
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

  // Пустой ответ допустим только для 204; иначе клиент получит `null`
  // и построит сессию с `undefined` вместо кода комнаты.
  if (text && !parsed) {
    throw new ApiError('Сервер вернул некорректный ответ', 'BAD_RESPONSE', response.status);
  }

  return data as T;
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function register(input: { email: string; password: string; name: string }): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register', jsonBody(input));
}

export function login(input: { email: string; password: string }): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', jsonBody(input));
}

export function loginAsGuest(name: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/guest', jsonBody({ name }));
}

export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export function fetchMe(): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/me');
}

export function createGame(): Promise<GameSessionResponse> {
  return request<GameSessionResponse>('/api/games', { method: 'POST' });
}

export function createBotGame(difficulty: BotDifficulty): Promise<GameSessionResponse> {
  return request<GameSessionResponse>('/api/games/bot', jsonBody({ difficulty }));
}

export function joinGame(code: string): Promise<GameSessionResponse> {
  return request<GameSessionResponse>(`/api/games/${encodeURIComponent(code)}/join`, { method: 'POST' });
}

export function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>('/api/me/stats');
}

export function fetchMatches(limit = 20, offset = 0): Promise<MatchListResponse> {
  return request<MatchListResponse>(`/api/me/matches?limit=${limit}&offset=${offset}`);
}

export function fetchLeaderboard(limit = 20, offset = 0): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>(`/api/leaderboard?limit=${limit}&offset=${offset}`);
}
