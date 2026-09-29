// Private keys live only in Windows DPAPI (LocalMachine) files outside this repository. They are
// decrypted into a Buffer through a private stdout pipe of a child process, used, and zeroed. They
// never pass through argv, environment variables, logs or plaintext files.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress, type PrivateKeyAccount } from 'viem/accounts';
import type { WalletEntry } from './config.ts';

const HEX_KEY = /^(?:0x)?[a-fA-F0-9]{64}$/;
const DPAPI_TIMEOUT_MS = 10_000;

export class WalletKeyError extends Error {
  constructor(walletId: string, reason: string) { super(`Wallet "${walletId}": ${reason}`); }
}

function powershell(command: string, options: { input?: Buffer; env: NodeJS.ProcessEnv; capture: boolean }): Buffer {
  if (process.platform !== 'win32') throw new Error('DPAPI wallet files require Windows');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: DPAPI_TIMEOUT_MS, maxBuffer: 256,
    stdio: [options.input ? 'pipe' : 'ignore', options.capture ? 'pipe' : 'ignore', 'ignore'],
    ...(options.input ? { input: options.input } : {}),
    env: { ...process.env, ...options.env },
  });
}

function decrypt(keyFile: string): Buffer {
  return powershell(`Add-Type -AssemblyName System.Security; $ErrorActionPreference='Stop';
    $blob=[Convert]::FromBase64String([IO.File]::ReadAllText($env:DP_KEY_FILE));
    $bytes=[Security.Cryptography.ProtectedData]::Unprotect($blob,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine);
    try { $out=[Console]::OpenStandardOutput(); $out.Write($bytes,0,$bytes.Length) } finally { [Array]::Clear($bytes,0,$bytes.Length) }`,
  { env: { DP_KEY_FILE: resolve(keyFile) }, capture: true });
}

function toHexKey(bytes: Buffer, walletId: string): Hex {
  const value = bytes.toString('utf8').trim();
  if (!HEX_KEY.test(value)) throw new WalletKeyError(walletId, 'decrypted content is not a private key');
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex;
}

/**
 * Runs `use` with a signing account for the configured wallet and clears the decrypted buffer afterwards.
 * Throws WalletKeyError when the file cannot be decrypted or belongs to a different address.
 * The viem account keeps its own key copy until garbage collection; do not retain it after `use` returns.
 */
export async function withWalletAccount<T>(wallet: WalletEntry, use: (account: PrivateKeyAccount) => Promise<T>): Promise<T> {
  let bytes: Buffer | undefined;
  try {
    try { bytes = decrypt(wallet.keyFile); } catch { throw new WalletKeyError(wallet.id, 'DPAPI decryption failed'); }
    const account = privateKeyToAccount(toHexKey(bytes, wallet.id));
    if (account.address.toLowerCase() !== wallet.address.toLowerCase()) throw new WalletKeyError(wallet.id, 'key does not match configured address');
    return await use(account);
  } finally {
    bytes?.fill(0);
  }
}

/** Generates a new key, stores it DPAPI-encrypted at `keyFile` and returns only its address. */
export function createProtectedWallet(keyFile: string): `0x${string}` {
  if (existsSync(keyFile)) throw new Error(`Refusing to overwrite existing key file ${keyFile}`);
  const key = generatePrivateKey();
  const input = Buffer.from(key, 'utf8');
  try {
    powershell(`Add-Type -AssemblyName System.Security; $ErrorActionPreference='Stop';
      $bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());
      try { $blob=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine);
        [IO.File]::WriteAllText($env:DP_KEY_FILE,[Convert]::ToBase64String($blob)) } finally { [Array]::Clear($bytes,0,$bytes.Length) }`,
    { input, env: { DP_KEY_FILE: resolve(keyFile) }, capture: false });
    return privateKeyToAddress(key);
  } finally {
    input.fill(0);
  }
}
