import test from 'node:test';
import assert from 'node:assert/strict';
import { findWallet, parseLocalConfig } from '../lib/config.ts';

const valid = {
  rpcUrl: 'https://sepolia-rpc.giwa.io', bundlerUrl: 'https://sepolia-bundler.giwa.io', spendCapWei: '12000000000000000',
  wallets: [{ id: 'primary', address: '0x0000000000000000000000000000000000000001', keyFile: 'C:/keys/primary.dpapi' }],
};

test('valid config parses with a bigint spend cap', () => {
  const config = parseLocalConfig(valid);
  assert.equal(config.spendCapWei, 12_000_000_000_000_000n);
  assert.equal(findWallet(config, 'primary').keyFile, 'C:/keys/primary.dpapi');
});

test('config rejects plaintext key files, http URLs, zero caps and duplicate ids', () => {
  const wallet = valid.wallets[0]!;
  for (const broken of [
    { ...valid, wallets: [{ ...wallet, keyFile: 'C:/keys/primary.txt' }] },
    { ...valid, rpcUrl: 'http://sepolia-rpc.giwa.io' },
    { ...valid, spendCapWei: '0' },
    { ...valid, spendCapWei: 12 },
    { ...valid, wallets: [wallet, wallet] },
    { ...valid, wallets: [{ ...wallet, address: '0x1234' }] },
  ]) assert.throws(() => parseLocalConfig(broken), /Invalid config/);
});

test('unknown wallet id is an error, not a silent default', () => {
  assert.throws(() => findWallet(parseLocalConfig(valid), 'helper-1'), /not configured/);
});
