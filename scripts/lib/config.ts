import { existsSync, readFileSync } from 'node:fs';
import { isAddress, type Address } from 'viem';

export interface WalletEntry { id: string; address: Address; keyFile: string }
export interface LocalConfig {
  rpcUrl: string;
  bundlerUrl: string;
  wallets: WalletEntry[];
  // Upper bound on ETH that one script run may spend (wei, decimal string in the file).
  spendCapWei: bigint;
}

export const CONFIG_PATH = 'config/local.json';
const WALLET_ID = /^[a-z0-9-]{1,32}$/;

class ConfigError extends Error {
  constructor(detail: string) { super(`Invalid ${CONFIG_PATH}: ${detail}`); }
}

function httpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^https:\/\/[^\s]+$/.test(value)) throw new ConfigError(`${field} must be an https URL`);
  return value;
}

function wallet(raw: unknown, index: number): WalletEntry {
  const entry = raw as Partial<Record<keyof WalletEntry, unknown>>;
  if (typeof entry?.id !== 'string' || !WALLET_ID.test(entry.id)) throw new ConfigError(`wallets[${index}].id`);
  if (typeof entry.address !== 'string' || !isAddress(entry.address)) throw new ConfigError(`wallets[${index}].address`);
  if (typeof entry.keyFile !== 'string' || !entry.keyFile.endsWith('.dpapi')) throw new ConfigError(`wallets[${index}].keyFile must be a .dpapi file`);
  return { id: entry.id, address: entry.address, keyFile: entry.keyFile };
}

export function parseLocalConfig(raw: unknown): LocalConfig {
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data?.['wallets'])) throw new ConfigError('wallets must be an array');
  const wallets = data['wallets'].map(wallet);
  if (new Set(wallets.map((w) => w.id)).size !== wallets.length) throw new ConfigError('duplicate wallet id');
  const cap = data['spendCapWei'];
  if (typeof cap !== 'string' || !/^[1-9]\d{0,30}$/.test(cap)) throw new ConfigError('spendCapWei must be a positive decimal string');
  return { rpcUrl: httpsUrl(data['rpcUrl'], 'rpcUrl'), bundlerUrl: httpsUrl(data['bundlerUrl'], 'bundlerUrl'), wallets, spendCapWei: BigInt(cap) };
}

export function loadLocalConfig(options: { optional: true }): LocalConfig | null;
export function loadLocalConfig(options?: { optional?: false }): LocalConfig;
export function loadLocalConfig(options: { optional?: boolean } = {}): LocalConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    if (options.optional) return null;
    throw new ConfigError('file not found; copy config/example.json');
  }
  return parseLocalConfig(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
}

export function findWallet(config: LocalConfig, id: string): WalletEntry {
  const entry = config.wallets.find((w) => w.id === id);
  if (!entry) throw new ConfigError(`wallet "${id}" is not configured`);
  return entry;
}
