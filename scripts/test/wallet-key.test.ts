import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProtectedWallet, withWalletAccount } from '../lib/wallet-key.ts';

test('a generated DPAPI wallet signs as its own address and is not stored in plaintext', { skip: process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dojang-key-'));
  try {
    const keyFile = join(dir, 'fixture.dpapi');
    const address = createProtectedWallet(keyFile);
    assert.doesNotMatch(readFileSync(keyFile, 'utf8'), /[0-9a-f]{64}/i);
    const signer = await withWalletAccount({ id: 'fixture', address, keyFile }, async (account) => account.address);
    assert.equal(signer, address);
    await assert.rejects(withWalletAccount({ id: 'fixture', address: '0x0000000000000000000000000000000000000001', keyFile }, async () => 0),
      /does not match configured address/);
    assert.throws(() => createProtectedWallet(keyFile), /Refusing to overwrite/);
  } finally { rmSync(dir, { recursive: true }); }
});
