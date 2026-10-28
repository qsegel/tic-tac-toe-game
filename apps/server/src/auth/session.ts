import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GameError, sanitizeName } from '@ttt/shared';
import type { AuthUser } from '@ttt/shared';
import { EmailTakenError, UserStore } from './users.js';
import { hashPassword, verifyPassword } from './passwords.js';

export const SESSION_COOKIE = 'ttt_session';
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface SessionClaims {
  sub: string;
  role: 'user' | 'guest';
  name?: string;
  iat: number;
  exp: number;
}

interface SessionPayload {
  sub: string;
  role: 'user' | 'guest';
  name?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionPayload;
    user: SessionClaims;
  }
}

export interface AuthServiceOptions {
  /** Ставить флаг Secure всегда, даже если запрос пришёл по http (за reverse-proxy). */
  cookieSecure?: boolean;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

/**
 * Dummy-хэш для выравнивания времени логина. Считаем один раз на процесс:
 * иначе каждый тестовый `buildApp` платит за scrypt при старте.
 */
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing');
  return dummyHashPromise;
}

export class AuthService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly users: UserStore,
    private readonly options: AuthServiceOptions = {},
  ) {}

  async register(input: { email: string; password: string; name: string }): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    if (this.users.findByEmail(email)) {
      throw new GameError('EMAIL_TAKEN', 'Этот email уже зарегистрирован');
    }

    const passwordHash = await hashPassword(input.password);
    let stored;
    try {
      stored = this.users.create({
        id: `usr_${randomUUID()}`,
        email,
        name: input.name,
        passwordHash,
        createdAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof EmailTakenError) {
        throw new GameError('EMAIL_TAKEN', 'Этот email уже зарегистрирован');
      }
      throw error;
    }

    const user = toAuthUser(stored);
    return { user, token: this.issueToken(user) };
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const stored = this.users.findByEmail(normalizeEmail(input.email));
    const expected = stored?.passwordHash ?? (await dummyHash());
    const valid = await verifyPassword(input.password, expected);
    if (!stored || !valid) {
      throw new GameError('INVALID_CREDENTIALS', 'Неверный email или пароль');
    }

    const user = toAuthUser(stored);
    return { user, token: this.issueToken(user) };
  }

  guest(rawName: string): AuthResult {
    const name = sanitizeName(rawName);
    if (!name) {
      throw new GameError('BAD_REQUEST', 'Введите имя');
    }

    const user: AuthUser = {
      id: `guest_${randomUUID()}`,
      email: null,
      name,
      guest: true,
      rating: null,
      createdAt: Date.now(),
    };
    return { user, token: this.issueToken(user) };
  }

  async authenticateRequest(request: FastifyRequest): Promise<AuthUser> {
    let claims: SessionClaims;
    try {
      claims = await request.jwtVerify();
    } catch {
      throw new GameError('UNAUTHORIZED', 'Требуется вход');
    }
    return this.resolve(claims);
  }

  /** Проверка JWT без Fastify request: используется при WebSocket-upgrade. */
  authenticateToken(token: string): AuthUser {
    let claims: SessionClaims;
    try {
      claims = this.app.jwt.verify<SessionClaims>(token);
    } catch {
      throw new GameError('UNAUTHORIZED', 'Сессия недействительна');
    }
    return this.resolve(claims);
  }

  setCookie(reply: FastifyReply, token: string, request: FastifyRequest): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.options.cookieSecure === true || request.protocol === 'https',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }

  clearCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  private issueToken(user: AuthUser): string {
    return this.app.jwt.sign({
      sub: user.id,
      role: user.guest ? 'guest' : 'user',
      ...(user.guest ? { name: user.name } : {}),
    });
  }

  private resolve(claims: SessionClaims): AuthUser {
    if (claims.role === 'guest') {
      if (typeof claims.sub !== 'string' || !claims.sub.startsWith('guest_')) {
        throw new GameError('UNAUTHORIZED', 'Сессия недействительна');
      }
      return {
        id: claims.sub,
        email: null,
        name: sanitizeName(claims.name) ?? 'Гость',
        guest: true,
        rating: null,
        createdAt: claims.iat ? claims.iat * 1000 : Date.now(),
      };
    }

    if (claims.role !== 'user' || typeof claims.sub !== 'string') {
      throw new GameError('UNAUTHORIZED', 'Сессия недействительна');
    }

    const stored = this.users.findById(claims.sub);
    if (!stored) {
      throw new GameError('UNAUTHORIZED', 'Сессия недействительна');
    }
    return toAuthUser(stored);
  }
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  rating: number;
  createdAt: number;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    guest: false,
    rating: user.rating,
    createdAt: user.createdAt,
  };
}
