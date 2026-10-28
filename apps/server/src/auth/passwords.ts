import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
/**
 * Параметры соответствуют альтернативе OWASP для scrypt: N=2^15, r=8, p=3.
 * ~34 МБ памяти на хэш, ~150 мс на типичном железе.
 */
const SCRYPT_OPTIONS: ScryptOptions = {
  N: 32_768,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024,
};

/** Верхние границы: защита от повреждённого/подменённого хэша в БД. */
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

/**
 * scrypt из стандартной библиотеки: не нужны нативные зависимости.
 * Параметры заданы выше и совместимы с форматом хэша — при их изменении
 * старые хэши продолжат проверяться, потому что N/r/p читаются из строки.
 */
export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return derive(password, salt).then(
    (key) => `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64')}$${key.toString('base64')}`,
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (![N, r, p].every((value) => Number.isSafeInteger(value) && value > 0)) return false;
  if (N > MAX_N || r > MAX_R || p > MAX_P) return false;

  const salt = Buffer.from(rawSalt ?? '', 'base64');
  if (salt.length < 8 || salt.length > 64) return false;

  const expected = Buffer.from(rawHash ?? '', 'base64');
  if (expected.length !== KEY_LENGTH) return false;

  try {
    const actual = await derive(password, salt, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function derive(password: string, salt: Buffer, options: ScryptOptions = SCRYPT_OPTIONS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
