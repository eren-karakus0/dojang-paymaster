// Fails when a committed or staged file looks like it contains a private key.
// Only file:line locations are printed, never the matched value.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { privateKeyToAddress } from 'viem/accounts';
import { loadLocalConfig } from './lib/config.ts';

const SKIPPED = [/^lib\//, /^package-lock\.json$/, /\.(png|jpg|ico|woff2?)$/];
const ASSIGNED_KEY = /(private[_ -]?key|secret|mnemonic|seed[_ -]?phrase)["']?\s*[:=]\s*["']?(0x)?[0-9a-f]{64}\b/i;
const HEX_64 = /\b(?:0x)?([0-9a-fA-F]{64})\b/g;
// secp256k1 group order: values at or above it are not valid private keys.
const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function candidateFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return output.split('\n').filter((path) => path && !SKIPPED.some((rule) => rule.test(path)) && existsSync(path));
}

function protectedAddresses(): Set<string> {
  // Without a local config (CI), only the assignment pattern is enforced.
  const config = loadLocalConfig({ optional: true });
  return new Set((config?.wallets ?? []).map((wallet) => wallet.address.toLowerCase()));
}

function derivesProtectedAddress(hex: string, protectedSet: Set<string>): boolean {
  const value = BigInt(`0x${hex}`);
  if (protectedSet.size === 0 || value === 0n || value >= CURVE_ORDER) return false;
  return protectedSet.has(privateKeyToAddress(`0x${hex}`).toLowerCase());
}

const protectedSet = protectedAddresses();
const findings: string[] = [];
for (const path of candidateFiles()) {
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const location = `${path}:${index + 1}`;
    if (ASSIGNED_KEY.test(line)) findings.push(`${location} assigned key-like value`);
    for (const match of line.matchAll(HEX_64)) {
      if (derivesProtectedAddress(match[1]!, protectedSet)) findings.push(`${location} private key of a protected wallet`);
    }
  });
}
if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, protectedWallets: protectedSet.size }));
