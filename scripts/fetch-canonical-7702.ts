// Provenance step: copies the exact CREATE2 deployment input of eth-infinitism's Simple7702Account from
// Ethereum Sepolia and proves it reproduces the canonical address. Usage: node scripts/fetch-canonical-7702.ts <0.8|0.9>
import { writeFileSync } from 'node:fs';
import { createPublicClient, getContractAddress, http, slice, type Address, type Hash, type Hex } from 'viem';
import { DETERMINISTIC_DEPLOYER, SIMPLE_7702_ACCOUNT, type EntryPointVersion } from './lib/constants.ts';

// Creation transactions on Ethereum Sepolia, found through the Blockscout address API (2026-09-29).
const SOURCE_TX: Record<EntryPointVersion, Hash> = {
  '0.8': '0x8c0ce96a99ec7b002c86ade26e11ae0c9353536e1a0e8edee07525cdc9303fcc',
  '0.9': '0xaae79a4cac92a50bc136db417ada20a154ecb67f7364410a5b13d3751b474df8',
};

const version = process.argv[2];
if (version !== '0.8' && version !== '0.9') throw new Error('usage: fetch-canonical-7702.ts <0.8|0.9>');
const canonical: Address = SIMPLE_7702_ACCOUNT[version];

const sepolia = createPublicClient({ transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
const tx = await sepolia.getTransaction({ hash: SOURCE_TX[version] });
if (tx.to?.toLowerCase() !== DETERMINISTIC_DEPLOYER.toLowerCase()) throw new Error('source tx is not a deterministic-deployer call');
const salt = slice(tx.input, 0, 32);
const initCode = slice(tx.input, 32) as Hex;
const derived = getContractAddress({ opcode: 'CREATE2', from: DETERMINISTIC_DEPLOYER, salt, bytecode: initCode });
if (derived.toLowerCase() !== canonical.toLowerCase()) throw new Error(`derived ${derived} != canonical ${canonical}`);
writeFileSync(`deployments/canonical/simple7702account-v${version}.calldata`, tx.input + '\n');
console.log(JSON.stringify({ version, derived, salt, initCodeBytes: (initCode.length - 2) / 2 }));
