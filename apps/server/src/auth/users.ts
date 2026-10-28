import type { DatabaseSync } from 'node:sqlite';
import { RATING_START } from '@ttt/shared';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  rating: number;
  bestRating: number;
  ratedGames: number;
  createdAt: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  rating: number;
  best_rating: number;
  rated_games: number;
  created_at: number;
}

export class EmailTakenError extends Error {
  constructor() {
    super('Email already registered');
    this.name = 'EmailTakenError';
  }
}

export class UserStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: { id: string; email: string; name: string; passwordHash: string; createdAt: number }): StoredUser {
    try {
      this.db
        .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(input.id, input.email, input.name, input.passwordHash, input.createdAt);
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailTakenError();
      throw error;
    }

    return {
      id: input.id,
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      rating: RATING_START,
      bestRating: RATING_START,
      ratedGames: 0,
      createdAt: input.createdAt,
    };
  }

  findByEmail(email: string): StoredUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    return row ? toStoredUser(row) : null;
  }

  findById(id: string): StoredUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toStoredUser(row) : null;
  }
}

function toStoredUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    rating: Number(row.rating),
    bestRating: Number(row.best_rating),
    ratedGames: Number(row.rated_games),
    createdAt: Number(row.created_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}
