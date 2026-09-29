// Deploys and funds DojangVerifiedPaymaster on GIWA Sepolia with the primary wallet as owner.
// Idempotent: every step reads chain state and only sends what is missing. Usage: node scripts/deploy.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { encodeDeployData, encodeFunctionData, formatEther, getAddress, parseEther, type Abi, type Address, type Hash, type Hex } from 'viem';
import { entryPoint09Abi } from 'viem/account-abstraction';
import { ensureSimple7702Account } from './lib/canonical.ts';
import { chainContext, sendGuarded, waitForState } from './lib/chain.ts';
import { findWallet, loadLocalConfig } from './lib/config.ts';
import { ENTRY_POINT_V09, SIMPLE_7702_ACCOUNT } from './lib/constants.ts';
import { readDeployments, writeDeployments } from './lib/deployments.ts';
import { withWalletAccount } from './lib/wallet-key.ts';

const DOJANG_SCROLL: Address = '0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9';
// Address Dojang attester ids registered on GIWA Sepolia (giwa-io/dojang broadcast records, 2026-09-29).
const ATTESTER_IDS: Hash[] = [
  '0x38d8cb51c229b3d73d4726e3c12bc280371c6eecea81939e3685e1f5b54c702b',
  '0x8c5b37d692bb30f1bf88ddb3478c84d86c7fb5778b789e8f4b79493cf9a7902e',
  '0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678',
  '0xd1d363b0d54eb2b25cea87dce463bdcf40dd33875a10849f4945ed2dabc14246',
];
// A sponsored op costs ~2.5e-7 ETH on GIWA today; the limits leave two orders of magnitude of headroom.
const MAX_COST_PER_OP = parseEther('0.0001');
const MAX_COST_PER_ACCOUNT = parseEther('0.001');
// Matches the stake other paymasters on GIWA locked (EntryPoint StakeLocked logs, 2026-09-29).
const STAKE = parseEther('0.001');
const UNSTAKE_DELAY_SEC = 86_400;
const DEPOSIT_TARGET = parseEther('0.005');

const artifact = JSON.parse(readFileSync('out/DojangVerifiedPaymaster.sol/DojangVerifiedPaymaster.json', 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain', 'src'], { encoding: 'utf8' }).trim()) throw new Error('src/ has uncommitted changes; deploy a committed revision');

const config = loadLocalConfig();
const ctx = chainContext(config);
const primary = findWallet(config, 'primary');
const record = readDeployments({ chainId: 91342, entryPoint: ENTRY_POINT_V09, simple7702Account: SIMPLE_7702_ACCOUNT['0.9'], dojangScroll: DOJANG_SCROLL });

await withWalletAccount(primary, async (owner) => {
  await ensureSimple7702Account(ctx, owner, '0.9');

  if (!record.paymaster || !(await ctx.client.getCode({ address: record.paymaster.address }))) {
    const data = encodeDeployData({
      abi: artifact.abi, bytecode: artifact.bytecode.object,
      args: [ENTRY_POINT_V09, owner.address, DOJANG_SCROLL, ATTESTER_IDS, MAX_COST_PER_OP, MAX_COST_PER_ACCOUNT],
    });
    const receipt = await sendGuarded(ctx, owner, { label: 'deploy DojangVerifiedPaymaster', data });
    if (!receipt.contractAddress) throw new Error('deployment receipt has no contract address');
    const address = getAddress(receipt.contractAddress);
    await waitForState('paymaster code', () => ctx.client.getCode({ address }), (code) => !!code);
    record.paymaster = {
      address, owner: owner.address, deployment: { hash: receipt.transactionHash, block: receipt.blockNumber.toString() },
      attesterIds: ATTESTER_IDS, maxCostPerOpWei: MAX_COST_PER_OP.toString(), maxCostPerAccountWei: MAX_COST_PER_ACCOUNT.toString(), gitCommit,
    };
    writeDeployments(record);
  }
  const paymaster = record.paymaster.address;
  const depositInfo = () => ctx.client.readContract({ address: ENTRY_POINT_V09, abi: entryPoint09Abi, functionName: 'getDepositInfo', args: [paymaster] });

  if ((await depositInfo()).stake < STAKE) {
    const receipt = await sendGuarded(ctx, owner, {
      label: 'addStake', to: paymaster, value: STAKE,
      data: encodeFunctionData({ abi: artifact.abi, functionName: 'addStake', args: [UNSTAKE_DELAY_SEC] }),
    });
    record.stake = { hash: receipt.transactionHash, block: receipt.blockNumber.toString(), amountWei: STAKE.toString(), unstakeDelaySec: UNSTAKE_DELAY_SEC };
    writeDeployments(record);
    await waitForState('stake', depositInfo, (info) => info.stake >= STAKE);
  }

  const deposit = (await depositInfo()).deposit;
  if (deposit < DEPOSIT_TARGET) {
    const amount = DEPOSIT_TARGET - deposit;
    const receipt = await sendGuarded(ctx, owner, {
      label: 'deposit', to: paymaster, value: amount, data: encodeFunctionData({ abi: artifact.abi, functionName: 'deposit' }),
    });
    record.deposits = [...(record.deposits ?? []), { hash: receipt.transactionHash, block: receipt.blockNumber.toString(), amountWei: amount.toString() }];
    writeDeployments(record);
  }

  const info = await waitForState('deposit', depositInfo, (value) => value.deposit >= DEPOSIT_TARGET);
  console.log(JSON.stringify({ paymaster, staked: info.staked, stakeEth: formatEther(info.stake), unstakeDelaySec: info.unstakeDelaySec, depositEth: formatEther(info.deposit) }));
});
console.log(`worst-case reserved this run: ${formatEther(ctx.guard.reservedWei)} ETH`);
