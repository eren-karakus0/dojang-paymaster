// Usage: node scripts/create-wallet.ts <wallet-id> <directory for the .dpapi file (outside the repo)>
// Creates a DPAPI-protected key and registers its public address in config/local.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { CONFIG_PATH, loadLocalConfig } from './lib/config.ts';
import { createProtectedWallet } from './lib/wallet-key.ts';

const [id, directory] = process.argv.slice(2);
if (!id || !/^[a-z0-9-]{1,32}$/.test(id) || !directory || !isAbsolute(directory)) {
  throw new Error('usage: create-wallet.ts <id> <absolute key directory>');
}
if (resolve(directory).startsWith(resolve('.'))) throw new Error('key directory must be outside the repository');
const config = loadLocalConfig();
if (config.wallets.some((w) => w.id === id)) throw new Error(`wallet "${id}" already exists`);

const keyFile = join(directory, `${id}.dpapi`).replaceAll('\\', '/');
const address = createProtectedWallet(keyFile);
const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { wallets: unknown[] };
raw.wallets.push({ id, address, keyFile });
writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n');
console.log(JSON.stringify({ id, address }));
