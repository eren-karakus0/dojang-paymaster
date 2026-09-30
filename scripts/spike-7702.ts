// Risk spike T2: can GIWA Sepolia and its bundler run EIP-7702 accounts on EntryPoint v0.9?
// Idempotent: each step checks chain state first and is skipped when already done.
import { formatEther, http, parseEther } from 'viem';
import { createBundlerClient, toSimple7702SmartAccount } from 'viem/account-abstraction';
import { ensureDelegated, ensureSimple7702Account } from './lib/canonical.ts';
import { chainContext, sendGuarded } from './lib/chain.ts';
import { findWallet, loadLocalConfig } from './lib/config.ts';
import { SIMPLE_7702_ACCOUNT } from './lib/constants.ts';
import { withWalletAccount } from './lib/wallet-key.ts';

const HELPER_FUNDING = parseEther('0.003');
const HELPER_MIN_BALANCE = parseEther('0.002');

const config = loadLocalConfig();
const ctx = chainContext(config);
const primary = findWallet(config, 'primary');
const helper = findWallet(config, 'helper-1');

// 1. Canonical Simple7702Account for EntryPoint v0.9 (same init code and salt as on Ethereum Sepolia).
await withWalletAccount(primary, (account) => ensureSimple7702Account(ctx, account, '0.9'));
console.log('Simple7702Account v0.9 present at canonical address');

// 2. Fund the helper wallet only up to what the spike needs.
if (await ctx.client.getBalance({ address: helper.address }) < HELPER_MIN_BALANCE) {
  await withWalletAccount(primary, (account) => sendGuarded(ctx, account, { label: 'fund helper-1', to: helper.address, value: HELPER_FUNDING }));
}

await withWalletAccount(helper, async (owner) => {
  // 3. Delegate (or re-delegate) the helper EOA with a plain type-4 transaction.
  await ensureDelegated(ctx, owner, SIMPLE_7702_ACCOUNT['0.9']);
  console.log('helper-1 delegated to Simple7702Account v0.9');

  // 4. Self-funded UserOp through the official bundler proves bundler-side 7702 support.
  const account = await toSimple7702SmartAccount({ client: ctx.client, owner, entryPoint: '0.9' });
  const bundler = createBundlerClient({ account, client: ctx.client, transport: http(config.bundlerUrl, { timeout: 30_000 }) });
  const request = await bundler.prepareUserOperation({ calls: [{ to: helper.address, value: 0n }] });
  const worstCase = (request.callGasLimit + request.verificationGasLimit + request.preVerificationGas) * request.maxFeePerGas;
  ctx.guard.reserve('helper-1 self-paid UserOp', worstCase);
  // prepareUserOperation fills a stub signature for gas estimation; the real one is added here.
  const signature = await account.signUserOperation(request);
  const userOpHash = await bundler.sendUserOperation({ ...request, signature });
  console.log(`UserOp sent ${userOpHash}`);
  const result = await bundler.waitForUserOperationReceipt({ hash: userOpHash, timeout: 90_000 });
  console.log(JSON.stringify({ success: result.success, tx: result.receipt.transactionHash, actualGasCostEth: formatEther(result.actualGasCost) }));
  if (!result.success) throw new Error('UserOp reverted');
});
console.log(`worst-case reserved this run: ${formatEther(ctx.guard.reservedWei)} ETH`);
