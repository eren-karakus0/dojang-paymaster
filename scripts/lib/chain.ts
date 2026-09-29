import {
  createPublicClient, createWalletClient, formatEther, http,
  type Address, type Hex, type LocalAccount, type SignedAuthorizationList, type TransactionReceipt,
} from 'viem';
import { giwaSepolia } from 'viem/chains';
import { publicActionsL2 } from 'viem/op-stack';
import type { LocalConfig } from './config.ts';

const RECEIPT_TIMEOUT_MS = 90_000;
// Headroom on estimated gas; the unused part is never charged.
const GAS_HEADROOM_PERCENT = 20n;

export type GiwaPublicClient = ReturnType<typeof giwaPublicClient>;

export function giwaPublicClient(config: LocalConfig) {
  return createPublicClient({ chain: giwaSepolia, transport: http(config.rpcUrl, { timeout: 30_000, retryCount: 0 }) })
    .extend(publicActionsL2());
}

/** Accumulates worst-case cost of every transaction in one script run and refuses to exceed the cap. */
export class SpendGuard {
  #reservedWei = 0n;
  readonly capWei: bigint;
  constructor(capWei: bigint) { this.capWei = capWei; }
  reserve(label: string, amountWei: bigint): void {
    if (this.#reservedWei + amountWei > this.capWei) {
      throw new Error(`${label}: worst-case cost ${formatEther(amountWei)} ETH would exceed the run cap of ${formatEther(this.capWei)} ETH`);
    }
    this.#reservedWei += amountWei;
  }
  get reservedWei(): bigint { return this.#reservedWei; }
}

export interface GuardedRequest {
  label: string;
  to: Address;
  data?: Hex;
  value?: bigint;
  authorizationList?: SignedAuthorizationList;
}

export interface ChainContext { client: GiwaPublicClient; rpcUrl: string; guard: SpendGuard }

export function chainContext(config: LocalConfig): ChainContext {
  return { client: giwaPublicClient(config), rpcUrl: config.rpcUrl, guard: new SpendGuard(config.spendCapWei) };
}

/**
 * Simulates, prices (execution + L1 fee + value), reserves against the guard, sends once and waits for
 * the receipt. Throws on simulation failure, cap overrun, revert or timeout. Never resends: after a
 * timeout, inspect the logged hash instead of re-running blindly.
 */
export async function sendGuarded(
  { client, rpcUrl, guard }: ChainContext, account: LocalAccount, request: GuardedRequest,
): Promise<TransactionReceipt> {
  if (await client.getChainId() !== giwaSepolia.id) throw new Error('RPC is not GIWA Sepolia');
  const base = { account, to: request.to, data: request.data ?? '0x', value: request.value ?? 0n,
    ...(request.authorizationList ? { authorizationList: request.authorizationList } : {}) } as const;
  await client.call(base);
  const gas = (await client.estimateGas(base)) * (100n + GAS_HEADROOM_PERCENT) / 100n;
  const fees = await client.estimateFeesPerGas();
  const l1Fee = await client.estimateL1Fee({ ...base, gas, chain: giwaSepolia });
  guard.reserve(request.label, gas * fees.maxFeePerGas + l1Fee + base.value);

  const wallet = createWalletClient({ account, chain: giwaSepolia, transport: http(rpcUrl) });
  const hash = await wallet.sendTransaction({ ...base, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  console.log(`${request.label}: sent ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  if (receipt.status !== 'success') throw new Error(`${request.label}: reverted in ${hash}`);
  return receipt;
}

const STATE_POLL_MS = 1_000;
const STATE_TIMEOUT_MS = 30_000;

/**
 * The public RPC is load-balanced and a node may lag the one that returned a receipt. Polls until
 * `read` satisfies `done`, and throws after 30 s so a real failure is not mistaken for lag.
 */
export async function waitForState<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + STATE_TIMEOUT_MS;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`${label}: expected state not visible after ${STATE_TIMEOUT_MS / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, STATE_POLL_MS));
  }
}
