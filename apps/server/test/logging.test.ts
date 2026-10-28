import assert from 'node:assert/strict';
import test from 'node:test';
import { redactToken } from '../src/app.js';

test('redactToken скрывает токен в query и не трогает остальной URL', () => {
  assert.equal(redactToken('/ws?token=secret'), '/ws?token=[redacted]');
  assert.equal(redactToken('/ws?token=secret&x=1'), '/ws?token=[redacted]&x=1');
  assert.equal(redactToken('/ws?x=1&token=secret'), '/ws?x=1&token=[redacted]');
  assert.equal(redactToken('/ws?tokens=secret'), '/ws?tokens=secret');
  assert.equal(redactToken('/health'), '/health');
  assert.equal(redactToken(undefined), undefined);
});
