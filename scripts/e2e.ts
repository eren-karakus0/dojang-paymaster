// FR-22 / FR-23: end-to-end run against the official GIWA bundler.
//  positive: the attested primary EOA (delegated to Simple7702Account v0.9) sends a UserOp; the
//            paymaster pays for it and the EOA balance does not change.
//  negative: an unattested, delegated helper EOA is refused by the bundler (SenderNotVerified).
// Usage: node scripts/e2e.ts   (writes docs/evidence/e2e.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeEventLog, formatEther, http, parseAbi, toFunctionSelector, type Address } from 'viem';
import { createBundlerClient, entryPoint09Abi, toSimple7702SmartAccount } from 'viem/account-abstraction';
import { ensureDelegated } from './lib/canonical.ts';
import { chainContext } from './lib/chain.ts';
import { findWallet, loadLocalConfig, type WalletEntry } from './lib/config.ts';
import { ENTRY_POINT_V09, SIMPLE_7702_ACCOUNT } from './lib/constants.ts';
import { DEPLOYMENTS_PATH, type Deployments } from './lib/deployments.ts';
import { withWalletAccount } from './lib/wallet-key.ts';

// Live validation measured 135.9k gas including the 21k intrinsic cost (docs/evidence/opcode-audit.json).
const PAYMASTER_VERIFICATION_GAS = 200_000n;
const PAYMASTER_POST_OP_GAS = 60_000n;
const SPONSORED_EVENT = parseAbi(['event Sponsored(address indexed account, uint256 indexed epoch, uint256 actualGasCost)']);
const NOT_VERIFIED_SELECTOR = toFunctionSelector('SenderNotVerified(address)');

const config = loadLocalConfig();
const ctx = chainContext(config);
const client = ctx.client;
const deployments = JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8')) as Deployments;
if (!deployments.paymaster) throw new Error('paymaster not deployed yet');
const paymaster = deployments.paymaster.address;

const deposit = async () => (await client.readContract({ address: ENTRY_POINT_V09, abi: entryPoint09Abi, functionName: 'getDepositInfo', args: [paymaster] })).deposit;

async function sponsoredOperation(wallet: WalletEntry) {
  return withWalletAccount(wallet, async (owner) => {
    const account = await toSimple7702SmartAccount({ client, owner, entryPoint: '0.9' });
    const bundler = createBundlerClient({ account, client, transport: http(config.bundlerUrl, { timeout: 30_000 }) });
    const delegatedBefore = await account.isDeployed();
    const request = await bundler.prepareUserOperation({
      calls: [{ to: wallet.address as Address, value: 0n }],
      paymaster, paymasterVerificationGasLimit: PAYMASTER_VERIFICATION_GAS, paymasterPostOpGasLimit: PAYMASTER_POST_OP_GAS,
    });
    // Prepared with a stub signature for estimation; the real signature is added here.
    const signature = await account.signUserOperation(request);
    const userOpHash = await bundler.sendUserOperation({ ...request, signature });
    const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash, timeout: 90_000 });
    return { receipt, userOpHash, delegatedBefore, delegatedAfter: await account.isDeployed() };
  });
}

// Positive path. The delegation itself is a type-4 transaction paid by the EOA (see ensureDelegated);
// balances are measured afterwards so the check below covers only the sponsored UserOp.
const primary = findWallet(config, 'primary');
await withWalletAccount(primary, (owner) => ensureDelegated(ctx, owner, SIMPLE_7702_ACCOUNT['0.9']));
const [depositBefore, primaryBalanceBefore] = await Promise.all([deposit(), client.getBalance({ address: primary.address })]);
const positive = await sponsoredOperation(primary);
const [depositAfter, primaryBalanceAfter] = await Promise.all([deposit(), client.getBalance({ address: primary.address })]);
const sponsoredLog = positive.receipt.logs
  .filter((log) => log.address.toLowerCase() === paymaster.toLowerCase())
  .map((log) => decodeEventLog({ abi: SPONSORED_EVENT, data: log.data, topics: log.topics }))[0];
if (!positive.receipt.success) throw new Error('sponsored UserOp reverted');
if (primaryBalanceAfter !== primaryBalanceBefore) throw new Error('the verified EOA paid for its own operation');

// Negative path: must fail before inclusion, with the paymaster's SenderNotVerified revert.
const helper = findWallet(config, 'helper-1');
let negative: { refused: boolean; paymasterReason: boolean; message: string };
try {
  await sponsoredOperation(helper);
  negative = { refused: false, paymasterReason: false, message: 'UserOp was accepted' };
} catch (error) {
  const text = error instanceof Error ? `${error.message}` : String(error);
  negative = { refused: true, paymasterReason: text.toLowerCase().includes(NOT_VERIFIED_SELECTOR.slice(2)), message: text.split('\n').slice(0, 3).join(' ') };
}

const evidence = {
  checkedAt: new Date().toISOString(),
  paymaster,
  positive: {
    userOpHash: positive.userOpHash,
    transactionHash: positive.receipt.receipt.transactionHash,
    success: positive.receipt.success,
    delegatedBeforeOp: positive.delegatedBefore,
    delegatedAfterOp: positive.delegatedAfter,
    actualGasCostEth: formatEther(positive.receipt.actualGasCost),
    paymasterDepositSpentEth: formatEther(depositBefore - depositAfter),
    senderBalanceChangeEth: formatEther(primaryBalanceAfter - primaryBalanceBefore),
    sponsoredEvent: sponsoredLog ? { epoch: sponsoredLog.args.epoch.toString(), bookedEth: formatEther(sponsoredLog.args.actualGasCost) } : null,
  },
  negative,
};
writeFileSync('docs/evidence/e2e.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
if (!negative.refused || !negative.paymasterReason) process.exit(1);
