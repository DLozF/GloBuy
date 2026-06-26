import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidInstallToken } from '../src/index.js';

test('accepts a crypto.randomUUID install token', () => {
  assert.equal(isValidInstallToken('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'), true);
  assert.equal(isValidInstallToken('A1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D'), true); // case-insensitive
});

test('accepts the timestamp+random-hex fallback token', () => {
  // String(Date.now()) + Math.random().toString(16).slice(2)
  assert.equal(isValidInstallToken('1719400000000abc123def456'), true);
  assert.equal(isValidInstallToken('1719400000000123abcdef'), true); // hex tail starting with digits
});

test('rejects malformed / garbage tokens before they spend the shared pool', () => {
  for (const bad of ['', '   ', 'token', 'not-a-uuid', '12345', '<script>', null, undefined, 42, {}]) {
    assert.equal(isValidInstallToken(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});
