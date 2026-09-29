import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Address, Hash } from 'viem';

export const DEPLOYMENTS_PATH = 'deployments/91342.json';

export interface TxRecord { hash: Hash; block: string }
export interface PaymasterRecord {
  address: Address;
  owner: Address;
  deployment: TxRecord;
  attesterIds: Hash[];
  maxCostPerOpWei: string;
  maxCostPerAccountWei: string;
  gitCommit: string;
}
export interface Deployments {
  chainId: 91342;
  entryPoint: Address;
  simple7702Account: Address;
  dojangScroll: Address;
  paymaster?: PaymasterRecord;
  stake?: TxRecord & { amountWei: string; unstakeDelaySec: number };
  deposits?: (TxRecord & { amountWei: string })[];
}

/** Public, committed record of what was deployed. Contains addresses and hashes only. */
export function readDeployments(defaults: Omit<Deployments, 'paymaster' | 'stake' | 'deposits'>): Deployments {
  if (!existsSync(DEPLOYMENTS_PATH)) return { ...defaults };
  const stored = JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8')) as Deployments;
  if (stored.chainId !== 91342) throw new Error(`${DEPLOYMENTS_PATH} is not for GIWA Sepolia`);
  return stored;
}

export function writeDeployments(record: Deployments): void {
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(record, null, 2) + '\n');
}
