import type { DatabaseSync } from 'node:sqlite';
import type { Game, Mark, MatchListResponse, MatchResult, MatchSummary, StatsResponse, Winner } from '@ttt/shared';

interface StatsRow {
  wins: number;
  losses: number;
  draws: number;
  abandoned: number;
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
  finished_at: number;
}

/**
 * Сохраняет завершённые раунды и отдаёт статистику.
 *
 * Игра живёт в памяти, но результат каждого завершённого раунда попадает
 * в SQLite. Рематч увеличивает `round`, поэтому каждый раунд — отдельный матч.
 */
export class MatchHistory {
  constructor(private readonly db: DatabaseSync) {}

  record(game: Game): void {
    if (game.status !== 'finished' && game.status !== 'abandoned') return;
    if (!game.players.O) return;

    const xUser = registeredId(game.players.X.playerId);
    const oUser = registeredId(game.players.O.playerId);
    // Матч двух гостей никому не будет виден — не засоряем базу.
    if (!xUser && !oUser) return;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO matches (game_id, round, code, status, winner, finished_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(game.id, game.round, game.code, game.status, game.winner, game.updatedAt);

      if (Number(inserted.changes) === 0) {
        this.db.exec('ROLLBACK');
        return;
      }

      const matchId = Number(inserted.lastInsertRowid);
      const insertPlayer = this.db.prepare(
        `INSERT INTO match_players (match_id, user_id, name, mark, result)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const mark of ['X', 'O'] as const) {
        const slot = game.players[mark];
        if (!slot) continue;
        insertPlayer.run(matchId, registeredId(slot.playerId), slot.name, mark, resultFor(game, mark));
      }

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
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

    const wins = Number(row?.wins ?? 0);
    const losses = Number(row?.losses ?? 0);
    const draws = Number(row?.draws ?? 0);
    const abandoned = Number(row?.abandoned ?? 0);
    return { wins, losses, draws, abandoned, played: wins + losses + draws + abandoned };
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
           mp.mark AS my_mark,
           mp.result,
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

    const matches: MatchSummary[] = rows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      round: Number(row.round),
      status: row.status,
      winner: row.winner,
      myMark: row.my_mark,
      result: row.result,
      opponentName: row.opponent_name,
      finishedAt: Number(row.finished_at),
    }));

    return { matches, total, hasMore: offset + matches.length < total };
  }
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
