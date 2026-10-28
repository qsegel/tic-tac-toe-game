import type { DatabaseSync } from 'node:sqlite';
import { RATING_START, nextRating } from '@ttt/shared';
import type {
  Game,
  LeaderboardEntry,
  LeaderboardResponse,
  Mark,
  MatchListResponse,
  MatchResult,
  MatchSummary,
  StatsResponse,
  Winner,
} from '@ttt/shared';

interface StatsRow {
  wins: number;
  losses: number;
  draws: number;
  abandoned: number;
}

interface UserRatingRow {
  rating: number;
  best_rating: number;
  rated_games: number;
}

interface MatchRow {
  id: number;
  code: string;
  round: number;
  status: 'finished' | 'abandoned';
  winner: Winner | null;
  my_mark: Mark;
  result: MatchResult;
  opponent_name: string | null;
  rated: number;
  rating_before: number | null;
  rating_after: number | null;
  finished_at: number;
}

interface LeaderboardRow {
  position: number;
  id: string;
  name: string;
  rating: number;
  rated_games: number;
  wins: number;
  losses: number;
  draws: number;
}

interface RatingPair {
  X: { before: number; after: number };
  O: { before: number; after: number };
}

const RANKED_USERS = `
  WITH ranked AS (
    SELECT id, name, rating, rated_games, created_at,
           ROW_NUMBER() OVER (
             ORDER BY rating DESC, rated_games DESC, created_at ASC, id ASC
           ) AS position
    FROM users
    WHERE rated_games > 0
  )
`;

/**
 * Сохраняет завершённые раунды и отдаёт статистику.
 *
 * Игра живёт в памяти, но результат каждого завершённого раунда попадает
 * в SQLite. Рематч увеличивает `round`, поэтому каждый раунд — отдельный матч.
 * Рейтинг меняется только в партиях двух зарегистрированных игроков.
 */
export class MatchHistory {
  constructor(private readonly db: DatabaseSync) {}

  record(game: Game): void {
    if (game.status !== 'finished' && game.status !== 'abandoned') return;
    // Тренировка с ботом не попадает ни в историю, ни в рейтинг.
    if (game.mode === 'bot') return;
    if (!game.players.O) return;

    const xUser = registeredId(game.players.X.playerId);
    const oUser = registeredId(game.players.O.playerId);
    // Матч двух гостей никому не будет виден — не засоряем базу.
    if (!xUser && !oUser) return;

    const rated =
      game.status === 'finished' && game.winner !== null && xUser !== null && oUser !== null;

    let inTransaction = false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      inTransaction = true;

      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO matches (game_id, round, code, status, winner, finished_at, rated)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(game.id, game.round, game.code, game.status, game.winner, game.updatedAt, rated ? 1 : 0);

      if (Number(inserted.changes) === 0) {
        this.db.exec('ROLLBACK');
        inTransaction = false;
        return;
      }

      const matchId = Number(inserted.lastInsertRowid);
      const ratings = rated && xUser && oUser ? this.applyRatings(game, xUser, oUser) : null;
      const insertPlayer = this.db.prepare(
        `INSERT INTO match_players
           (match_id, user_id, name, mark, result, rating_before, rating_after)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const mark of ['X', 'O'] as const) {
        const slot = game.players[mark];
        if (!slot) continue;
        const rating = ratings?.[mark] ?? null;
        insertPlayer.run(
          matchId,
          registeredId(slot.playerId),
          slot.name,
          mark,
          resultFor(game, mark),
          rating?.before ?? null,
          rating?.after ?? null,
        );
      }

      this.db.exec('COMMIT');
      inTransaction = false;
    } catch (error) {
      if (inTransaction) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // Соединение могло уже закрыться — исходную ошибку важнее не потерять.
        }
      }
      throw error;
    }
  }

  stats(userId: string): StatsResponse {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END), 0) AS wins,
           COALESCE(SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END), 0) AS losses,
           COALESCE(SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END), 0) AS draws,
           COALESCE(SUM(CASE WHEN result = 'abandoned' THEN 1 ELSE 0 END), 0) AS abandoned
         FROM match_players
         WHERE user_id = ?`,
      )
      .get(userId) as unknown as StatsRow | undefined;

    const ratingRow = this.db
      .prepare('SELECT rating, best_rating, rated_games FROM users WHERE id = ?')
      .get(userId) as unknown as UserRatingRow | undefined;

    const rankRow = this.db
      .prepare(`${RANKED_USERS} SELECT position FROM ranked WHERE id = ?`)
      .get(userId) as { position: number } | undefined;

    const wins = Number(row?.wins ?? 0);
    const losses = Number(row?.losses ?? 0);
    const draws = Number(row?.draws ?? 0);
    const abandoned = Number(row?.abandoned ?? 0);

    return {
      wins,
      losses,
      draws,
      abandoned,
      played: wins + losses + draws + abandoned,
      rating: Number(ratingRow?.rating ?? RATING_START),
      bestRating: Number(ratingRow?.best_rating ?? RATING_START),
      ratedGames: Number(ratingRow?.rated_games ?? 0),
      rank: rankRow ? Number(rankRow.position) : null,
    };
  }

  list(userId: string, limit: number, offset: number): MatchListResponse {
    const rows = this.db
      .prepare(
        `SELECT
           m.id,
           m.code,
           m.round,
           m.status,
           m.winner,
           m.rated,
           mp.mark AS my_mark,
           mp.result,
           mp.rating_before,
           mp.rating_after,
           m.finished_at,
           (SELECT op.name FROM match_players op
             WHERE op.match_id = m.id AND op.mark <> mp.mark
             LIMIT 1) AS opponent_name
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
         WHERE mp.user_id = ?
         ORDER BY m.finished_at DESC, m.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as unknown as MatchRow[];

    const totalRow = this.db
      .prepare('SELECT COUNT(*) AS total FROM match_players WHERE user_id = ?')
      .get(userId) as { total: number };
    const total = Number(totalRow.total);

    const matches: MatchSummary[] = rows.map((row) => {
      const before = row.rating_before === null ? null : Number(row.rating_before);
      const after = row.rating_after === null ? null : Number(row.rating_after);
      return {
        id: Number(row.id),
        code: row.code,
        round: Number(row.round),
        status: row.status,
        winner: row.winner,
        myMark: row.my_mark,
        result: row.result,
        opponentName: row.opponent_name,
        rated: Number(row.rated) === 1,
        ratingDelta: before !== null && after !== null ? after - before : null,
        ratingAfter: after,
        finishedAt: Number(row.finished_at),
      };
    });

    return { matches, total, hasMore: offset + matches.length < total };
  }

  leaderboard(limit: number, offset: number, meId: string | null): LeaderboardResponse {
    const rows = this.db
      .prepare(
        `${RANKED_USERS}
         SELECT
           r.position,
           r.id,
           r.name,
           r.rating,
           r.rated_games,
           (SELECT COUNT(*) FROM match_players mp JOIN matches m ON m.id = mp.match_id
             WHERE mp.user_id = r.id AND m.rated = 1 AND mp.result = 'win') AS wins,
           (SELECT COUNT(*) FROM match_players mp JOIN matches m ON m.id = mp.match_id
             WHERE mp.user_id = r.id AND m.rated = 1 AND mp.result = 'loss') AS losses,
           (SELECT COUNT(*) FROM match_players mp JOIN matches m ON m.id = mp.match_id
             WHERE mp.user_id = r.id AND m.rated = 1 AND mp.result = 'draw') AS draws
         FROM ranked r
         ORDER BY r.position
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as unknown as LeaderboardRow[];

    const totalRow = this.db
      .prepare('SELECT COUNT(*) AS total FROM users WHERE rated_games > 0')
      .get() as { total: number };
    const total = Number(totalRow.total);

    const meRow = meId
      ? (this.db
          .prepare(
            `${RANKED_USERS}
             SELECT
               r.position,
               r.id,
               r.name,
               r.rating,
               r.rated_games,
               (SELECT COUNT(*) FROM match_players mp WHERE mp.user_id = r.id AND mp.result = 'win') AS wins,
               (SELECT COUNT(*) FROM match_players mp WHERE mp.user_id = r.id AND mp.result = 'loss') AS losses,
               (SELECT COUNT(*) FROM match_players mp WHERE mp.user_id = r.id AND mp.result = 'draw') AS draws
             FROM ranked r
             WHERE r.id = ?`,
          )
          .get(meId) as unknown as LeaderboardRow | undefined)
      : undefined;

    return {
      entries: rows.map((row) => toEntry(row, row.id === meId)),
      total,
      hasMore: offset + rows.length < total,
      me: meRow ? toEntry(meRow, true) : null,
    };
  }

  private applyRatings(game: Game, xUser: string, oUser: string): RatingPair {
    const xRating = this.readRating(xUser);
    const oRating = this.readRating(oUser);
    const xScore: 0 | 0.5 | 1 = game.winner === 'draw' ? 0.5 : game.winner === 'X' ? 1 : 0;
    const oScore: 0 | 0.5 | 1 = xScore === 0.5 ? 0.5 : xScore === 1 ? 0 : 1;

    const xAfter = nextRating(xRating, oRating, xScore);
    const oAfter = nextRating(oRating, xRating, oScore);

    this.updateRating(xUser, xAfter);
    this.updateRating(oUser, oAfter);

    return {
      X: { before: xRating, after: xAfter },
      O: { before: oRating, after: oAfter },
    };
  }

  private readRating(userId: string): number {
    const row = this.db.prepare('SELECT rating FROM users WHERE id = ?').get(userId) as
      | { rating: number }
      | undefined;
    return Number(row?.rating ?? RATING_START);
  }

  private updateRating(userId: string, rating: number): void {
    this.db
      .prepare(
        `UPDATE users
         SET rating = ?, best_rating = MAX(best_rating, ?), rated_games = rated_games + 1
         WHERE id = ?`,
      )
      .run(rating, rating, userId);
  }
}

/** Ошибка блокировки SQLite: имеет смысл повторить запись. */
export function isSqliteBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /SQLITE_BUSY|SQLITE_LOCKED/.test(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(message);
}

function toEntry(row: LeaderboardRow, isMe: boolean): LeaderboardEntry {
  return {
    position: Number(row.position),
    name: row.name,
    rating: Number(row.rating),
    games: Number(row.rated_games),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws),
    isMe,
  };
}

function registeredId(playerId: string): string | null {
  return playerId.startsWith('usr_') ? playerId : null;
}

function resultFor(game: Game, mark: Mark): MatchResult {
  if (game.status === 'finished') {
    if (game.winner === 'draw') return 'draw';
    return game.winner === mark ? 'win' : 'loss';
  }
  return game.winner === mark ? 'win' : 'abandoned';
}
