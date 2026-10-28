import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS: ScryptOptions = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

/**
 * scrypt из стандартной библиотеки: не нужны нативные зависимости,
 * а параметры соответствуют рекомендациям OWASP для интерактивного входа.
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

  let expected: Buffer;
  try {
    expected = Buffer.from(rawHash ?? '', 'base64');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await derive(password, Buffer.from(rawSalt ?? '', 'base64'), { N, r, p, maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function derive(password: string, salt: Buffer, options: ScryptOptions = SCRYPT_OPTIONS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
