import type { DatabaseSync } from 'node:sqlite';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
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
    createdAt: row.created_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}
