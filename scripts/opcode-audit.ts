// FR-19: traces paymaster validation with debug_traceCall and reports ERC-7562 banned opcodes.
// A control trace of DojangScroll.isVerified shows the audit detects the TIMESTAMP read from #37.
// Usage: node scripts/opcode-audit.ts <sender address>   (writes docs/evidence/opcode-audit.json)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { encodeFunctionData, isAddress, type Abi, type Address, type Hex } from 'viem';
import { giwaPublicClient } from './lib/chain.ts';
import { loadLocalConfig } from './lib/config.ts';
import { ENTRY_POINT_V09 } from './lib/constants.ts';
import { DEPLOYMENTS_PATH, type Deployments } from './lib/deployments.ts';

// ERC-7562 [OP-011] block-environment and other forbidden opcodes; GAS is allowed only right before a
// *CALL [OP-012]. BALANCE/SELFBALANCE are listed as banned for unstaked entities; reported here anyway.
const BANNED = new Set(['GASPRICE', 'GASLIMIT', 'DIFFICULTY', 'PREVRANDAO', 'TIMESTAMP', 'BASEFEE', 'BLOCKHASH',
  'NUMBER', 'SELFBALANCE', 'BALANCE', 'ORIGIN', 'CREATE', 'CREATE2', 'COINBASE', 'SELFDESTRUCT', 'BLOBHASH',
  'BLOBBASEFEE', 'INVALID']);
const CALLS = new Set(['CALL', 'STATICCALL', 'DELEGATECALL', 'CALLCODE']);

interface StructLog { op: string; depth: number; pc: number }
interface TraceResult { failed: boolean; gas: number; structLogs: StructLog[] }
interface Finding { op: string; depth: number; pc: number }

const sender = process.argv[2];
if (!sender || !isAddress(sender)) throw new Error('usage: opcode-audit.ts <sender address>');
const config = loadLocalConfig();
const client = giwaPublicClient(config);
const deployments = JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8')) as Deployments;
if (!deployments.paymaster) throw new Error('paymaster not deployed yet');
const paymasterAbi = (JSON.parse(readFileSync('out/DojangVerifiedPaymaster.sol/DojangVerifiedPaymaster.json', 'utf8')) as { abi: Abi }).abi;

async function trace(from: Address, to: Address, data: Hex): Promise<{ result: TraceResult; findings: Finding[] }> {
  const result = await client.request({
    method: 'debug_traceCall' as never,
    params: [{ from, to, data }, 'latest', { disableStorage: true, enableMemory: false, disableStack: true }] as never,
  }) as TraceResult;
  const findings: Finding[] = [];
  result.structLogs.forEach((step, index) => {
    const next = result.structLogs[index + 1];
    const gasBeforeCall = step.op === 'GAS' && next !== undefined && CALLS.has(next.op);
    if (BANNED.has(step.op) || (step.op === 'GAS' && !gasBeforeCall)) findings.push({ op: step.op, depth: step.depth, pc: step.pc });
  });
  return { result, findings };
}

const op = {
  sender, nonce: 0n, initCode: '0x', callData: '0x', accountGasLimits: `0x${'0'.repeat(64)}`, preVerificationGas: 0n,
  gasFees: `0x${'0'.repeat(64)}`, paymasterAndData: '0x', signature: '0x',
} as const;
const validation = await trace(ENTRY_POINT_V09, deployments.paymaster.address, encodeFunctionData({
  abi: paymasterAbi, functionName: 'validatePaymasterUserOp', args: [op, `0x${'0'.repeat(64)}`, 10n ** 12n],
}));
const control = await trace(sender, deployments.dojangScroll, encodeFunctionData({
  abi: [{ type: 'function', name: 'isVerified', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'bool' }] }],
  functionName: 'isVerified', args: [sender, deployments.paymaster.attesterIds[2]!],
}));

const report = {
  checkedAt: new Date().toISOString(),
  block: (await client.getBlockNumber()).toString(),
  paymaster: deployments.paymaster.address,
  paymasterValidation: { reverted: validation.result.failed, steps: validation.result.structLogs.length, gas: validation.result.gas, bannedOpcodes: validation.findings },
  controlDojangScrollIsVerified: { steps: control.result.structLogs.length, bannedOpcodes: [...new Set(control.findings.map((f) => f.op))] },
};
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/opcode-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (validation.result.failed) throw new Error('validation reverted; the audit only covers the successful path for a verified sender');
if (validation.findings.length > 0) process.exit(1);
