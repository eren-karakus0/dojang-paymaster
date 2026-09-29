import { readFileSync } from 'node:fs';
import { concat, createWalletClient, http, type Address, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { giwaSepolia } from 'viem/chains';
import { sendGuarded, waitForState, type ChainContext } from './chain.ts';
import { DETERMINISTIC_DEPLOYER, SIMPLE_7702_ACCOUNT, type EntryPointVersion } from './constants.ts';

/**
 * Deploys eth-infinitism's Simple7702Account at its canonical address by replaying the CREATE2 input
 * recorded by scripts/fetch-canonical-7702.ts. No-op when the code already exists.
 */
export async function ensureSimple7702Account(ctx: ChainContext, deployer: PrivateKeyAccount, version: EntryPointVersion): Promise<void> {
  const address = SIMPLE_7702_ACCOUNT[version];
  if (await ctx.client.getCode({ address })) return;
  const input = readFileSync(`deployments/canonical/simple7702account-v${version}.calldata`, 'utf8').trim() as Hex;
  await sendGuarded(ctx, deployer, { label: `deploy Simple7702Account v${version}`, to: DETERMINISTIC_DEPLOYER, data: input });
  await waitForState(`Simple7702Account v${version} code`, () => ctx.client.getCode({ address }), (code) => !!code);
}

/** EIP-7702 delegation designator: 0xef0100 followed by the implementation address. */
export const delegationCode = (implementation: Address): Hex => concat(['0xef0100', implementation]).toLowerCase() as Hex;

/**
 * Delegates `owner`'s EOA to `implementation` with a self-executed type-4 transaction paid by the EOA.
 * No-op when already delegated there. Used instead of an in-UserOp authorization because the GIWA
 * bundler rejects viem 2.56.9's `factory: "0x7702"` encoding (see docs/pattern.md).
 */
export async function ensureDelegated(ctx: ChainContext, owner: PrivateKeyAccount, implementation: Address): Promise<void> {
  const read = () => ctx.client.getCode({ address: owner.address });
  if ((await read())?.toLowerCase() === delegationCode(implementation)) return;
  const wallet = createWalletClient({ account: owner, chain: giwaSepolia, transport: http(ctx.rpcUrl) });
  const authorization = await wallet.signAuthorization({ contractAddress: implementation, executor: 'self' });
  await sendGuarded(ctx, owner, { label: `7702 delegation of ${owner.address}`, to: owner.address, authorizationList: [authorization] });
  await waitForState('7702 delegation', read, (code) => code?.toLowerCase() === delegationCode(implementation));
}
