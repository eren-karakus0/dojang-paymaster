import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
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
