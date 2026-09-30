# dojang-paymaster

A reference ERC-4337 paymaster for [GIWA](https://docs.giwa.io) that sponsors gas only for addresses holding a [Dojang](https://github.com/giwa-io/dojang) "Verified Address" attestation, plus the small library that makes the Dojang check usable inside ERC-4337 validation.

> **Status: reference implementation, not audited, testnet only.** Contracts are tested and deployed on GIWA Sepolia. The live sponsored-UserOp demo is **not completed**: the GIWA bundler requires a 1 ETH stake for this kind of paymaster (see [Limitations](#limitations)). Development is paused at this point.

## Why

`DojangScroll.isVerified()` evaluates attestation expiry with `block.timestamp`. ERC-7562 bans `TIMESTAMP` during ERC-4337 validation, so a paymaster that calls it is rejected by the bundler at `eth_sendUserOperation`, even though `eth_call` and gas estimation succeed ([giwa-io/dojang#37](https://github.com/giwa-io/dojang/issues/37)). GIWA ships an EntryPoint, a bundler and Dojang, but the obvious way to combine them does not work.

This repository implements the workaround described in that issue as reusable, tested code:

1. Look up the attester currently registered for an attester id (`DojangAttesterBook`), the attestation uid (`AttestationIndexer`) and the record (`EAS`). These are plain storage reads.
2. Reject revoked or mismatching records without touching the clock.
3. Return the attestation's `expirationTime` as `validUntil` and let the EntryPoint enforce it.

## What is here

| Path | Purpose |
|---|---|
| `src/libraries/DojangAddressVerifier.sol` | Clock-free Verified Address check returning `{verified, validUntil, attesterId, uid}` |
| `src/DojangVerifiedPaymaster.sol` | EntryPoint v0.9 paymaster with per-operation and per-account budgets |
| `src/interfaces/IDojang.sol` | Minimal interfaces of the deployed Dojang/EAS contracts |
| `test/` | 36 unit/fuzz tests (mock Dojang, real EntryPoint v0.9, EIP-7702 accounts) and a GIWA Sepolia fork test |
| `scripts/` | TypeScript (viem) deployment, opcode audit and end-to-end scripts |
| `deployments/91342.json` | Addresses and transaction hashes on GIWA Sepolia |
| `docs/pattern.md` | The problem, the pattern and what was learned on GIWA |
| `docs/rehber-tr.md` | Short guide in Turkish |

### Differences from `DojangScroll.isVerified`

- Expiry is **not** evaluated by the library; callers must pass `validUntil` to the EntryPoint (the paymaster does).
- The attestation payload must be exactly ABI-encoded `true`. DojangScroll ignores the payload.
- Recipient, schema and attester of the returned record are re-checked.
- `validUntil` is capped at `2^47 - 1`: EntryPoint v0.9 reads bit 47 as "block-number range".

Like DojangScroll, the library follows the live configuration (schema book, attester book, indexer) and only honours the attester **currently** registered for an id, so attester rotations are followed.

## Deployments (GIWA Sepolia, chain id 91342)

| Contract | Address |
|---|---|
| DojangVerifiedPaymaster (source verified on Blockscout) | [`0xD89E68Af3084D8DFb38304cDD1B253E13Ed866Ad`](https://sepolia-explorer.giwa.io/address/0xD89E68Af3084D8DFb38304cDD1B253E13Ed866Ad) |
| EntryPoint v0.9 (existing) | `0x433709009B8330FDa32311DF1C2AFA402eD8D009` |
| Simple7702Account v0.9 (canonical address, deployed by this project) | `0xa46cc63eBF4Bd77888AA327837d20b23A63a56B5` |
| Simple7702Account v0.8 (canonical address, deployed by this project) | `0xe6Cae83BdE06E4c305530e199D7217f42808555B` |
| DojangScroll (existing) | `0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9` |

The Simple7702Account deployments replay eth-infinitism's original CREATE2 input from Ethereum Sepolia (`deployments/canonical/`, reproduced by `scripts/fetch-canonical-7702.ts`), so viem's `toSimple7702SmartAccount` defaults work on GIWA.

## Evidence

- **Tests:** `forge test` runs 36 tests; `DOJANG_FORK_ACCOUNT=<verified address> forge test --match-contract DojangForkTest` checks per-attester parity with the live `DojangScroll`.
- **ERC-7562 opcode audit** (`docs/evidence/opcode-audit.json`): a `debug_traceCall` of the deployed paymaster's `validatePaymasterUserOp` contains no banned opcode; the same audit on `DojangScroll.isVerified` reports `TIMESTAMP`.
- **Gas:** validation costs 65.7k gas against mocks and 135.9k in the live trace (including the 21k intrinsic cost; the Dojang contracts are proxies with cold reads).
- **EIP-7702 on GIWA:** a delegated EOA sent a self-paid UserOp through the official bundler (transaction `0x8e507629c23c9af243308a66bb744a2436806af4f8c7225f2fc9980ead5b0096`).

## Limitations

- **1 ETH stake.** The paymaster reads storage of other contracts during validation (ERC-7562 `[STO-033]`), which requires a staked entity. The GIWA bundler answered `entity stake/unstake delay too low` with `minimumStake = 1 ETH` and `minimumUnstakeDelay = 86400`. The deployed paymaster is staked with 0.001 ETH, so **sponsored UserOps are currently refused** and `scripts/e2e.ts` has not passed on the live network. With a 1 ETH stake it is expected to work, but that is untested.
- **In-UserOp EIP-7702 authorization.** The bundler rejected viem 2.56.9's encoding of a UserOp that carries the authorization (`factory: "0x7702"`). Delegation is therefore done with a separate type-4 transaction; fully gasless onboarding was not achieved. The cause was not investigated further.
- **Not audited.** Budgets are approximate: the EntryPoint computes `actualGasCost` before `postOp`, so the paymaster adds a fixed `POST_OP_OVERHEAD_GAS` allowance and may over-count slightly.
- Only the Verified Address Dojang type is supported. Budget periods are advanced by the owner, because validation cannot read time.
- Trust: the paymaster follows whatever Dojang's admins configure.

## Usage

Requirements: [Foundry](https://book.getfoundry.sh), Node.js 22.18+.

```bash
git clone --recurse-submodules https://github.com/eren-karakus0/dojang-paymaster
cd dojang-paymaster
forge build
forge test
npm ci --ignore-scripts && npm run check
```

Using the library in your own paymaster or account:

```solidity
DojangAddressVerifier.Verdict memory verdict =
    DojangAddressVerifier.check(IDojangScroll(DOJANG_SCROLL), userOp.sender, attesterIds);
if (!verdict.verified) revert SenderNotVerified(userOp.sender);
return (context, _packValidationData(false, verdict.validUntil, 0));
```

UserOps sponsored by `DojangVerifiedPaymaster` should set `paymasterVerificationGasLimit` to about 200,000 and `paymasterPostOpGasLimit` to about 60,000.

### Scripts

The scripts sign with keys stored in Windows DPAPI files outside the repository; keys are decrypted in-process only while signing and never appear in arguments, environment variables or output. Copy `config/example.json` to `config/local.json` first.

| Command | What it does |
|---|---|
| `node scripts/deploy.ts` | Deploys, stakes and funds the paymaster (idempotent, spend-capped) |
| `node scripts/opcode-audit.ts <sender>` | Reports ERC-7562 banned opcodes in paymaster validation |
| `node scripts/e2e.ts` | Sponsored UserOp from an attested EOA and refusal of an unattested one (needs the 1 ETH stake) |
| `node scripts/spike-7702.ts` | EIP-7702 delegation and a self-paid UserOp through the bundler |

## License

MIT
