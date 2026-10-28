import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';

test('passwords: hash и verify работают, чужой пароль не подходит', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.match(hash, /^scrypt\$32768\$8\$3\$/);
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('passwords: битый хэш не роняет проверку', async () => {
  assert.equal(await verifyPassword('x', ''), false);
  assert.equal(await verifyPassword('x', 'bcrypt$1$2$3$4$5'), false);
  assert.equal(await verifyPassword('x', 'scrypt$0$8$1$c2FsdA==$AAAA'), false);
  assert.equal(await verifyPassword('x', 'scrypt$abc$8$1$c2FsdA==$AAAA'), false);
});

test('passwords: подменённый или слишком дорогой хэш отклоняется', async () => {
  const hash = await hashPassword('password123');
  const parts = hash.split('$');

  const tampered = [...parts];
  const chars = [...(tampered[5] ?? '')];
  chars[10] = chars[10] === 'A' ? 'B' : 'A';
  tampered[5] = chars.join('');
  assert.equal(await verifyPassword('password123', tampered.join('$')), false);

  const tooExpensive = [...parts];
  tooExpensive[1] = String(1 << 21);
  assert.equal(await verifyPassword('password123', tooExpensive.join('$')), false);

  const hugeSalt = [...parts];
  hugeSalt[4] = Buffer.alloc(65, 1).toString('base64');
  assert.equal(await verifyPassword('password123', hugeSalt.join('$')), false);
});
