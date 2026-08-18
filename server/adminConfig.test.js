import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAdminEntryPath } from './adminConfig.js';

test('sanitizeAdminEntryPath accepts default and valid custom paths', () => {
  assert.equal(sanitizeAdminEntryPath('/admin'), '/admin');
  assert.equal(sanitizeAdminEntryPath('secure_path_123'), '/secure_path_123');
  assert.equal(sanitizeAdminEntryPath('/secure_path_123/'), '/secure_path_123');
});

test('sanitizeAdminEntryPath rejects reserved and malformed paths', () => {
  assert.equal(sanitizeAdminEntryPath('/api'), null);
  assert.equal(sanitizeAdminEntryPath('/api/adminsecret'), null);
  assert.equal(sanitizeAdminEntryPath('/room'), null);
  assert.equal(sanitizeAdminEntryPath('/tv'), null);
  assert.equal(sanitizeAdminEntryPath('/short'), null);
  assert.equal(sanitizeAdminEntryPath('/has/slash'), null);
});
