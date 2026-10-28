import type { ErrorCode, GameMode, Mark, PublicGame, Winner } from './types.js';

/** Сообщения от клиента к серверу. */
export type ClientMessage =
  | { type: 'move'; gameId: string; index: number; version: number }
  | { type: 'rematch' }
  | { type: 'leave' }
  | { type: 'ping' };

/** Сообщения от сервера к клиенту. */
export type ServerMessage =
  | { type: 'state'; game: PublicGame; you: Mark }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'pong' };

/** Тело ответа HTTP API при ошибке. */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
}

/** Ответ на создание/вход в игру. Секретов больше нет: идентификация — cookie. */
export interface GameSessionResponse {
  gameId: string;
  code: string;
  playerId: string;
  mark: Mark;
  mode: GameMode;
}

/** Текущий пользователь. У гостя `email === null`, `guest === true`. */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string;
  guest: boolean;
  /** У гостя рейтинга нет. */
  rating: number | null;
  createdAt: number;
}

export interface AuthResponse {
  user: AuthUser;
}

export interface StatsResponse {
  wins: number;
  losses: number;
  draws: number;
  abandoned: number;
  played: number;
  rating: number;
  bestRating: number;
  /** Сколько партий повлияло на рейтинг. */
  ratedGames: number;
  /** Место в лидерборде; `null`, пока нет ни одной рейтинговой партии. */
  rank: number | null;
}

export type MatchResult = 'win' | 'loss' | 'draw' | 'abandoned';

/** Одна завершённая партия (раунд) в истории игрока. */
export interface MatchSummary {
  id: number;
  code: string;
  round: number;
  status: 'finished' | 'abandoned';
  winner: Winner | null;
  myMark: Mark;
  result: MatchResult;
  opponentName: string | null;
  /** Партия повлияла на рейтинг. */
  rated: boolean;
  ratingDelta: number | null;
  ratingAfter: number | null;
  finishedAt: number;
}

export interface MatchListResponse {
  matches: MatchSummary[];
  total: number;
  hasMore: boolean;
}

/** Строка лидерборда. Идентификатор пользователя наружу не отдаём. */
export interface LeaderboardEntry {
  position: number;
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  isMe: boolean;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  hasMore: boolean;
  /** Позиция текущего пользователя, даже если она вне страницы. */
  me: LeaderboardEntry | null;
}
