# Using Dojang inside ERC-4337 validation on GIWA

Checked on GIWA Sepolia (chain id 91342) on 2026-09-29. Observations are direct measurements unless marked as inference.

## The problem

`DojangScroll.isVerified(address, attesterId)` ends in `AttestationVerifier._isVerified`, which compares `expirationTime` with `block.timestamp`. ERC-7562 `[OP-011]` bans `TIMESTAMP` in the validation phase of a UserOperation, including nested calls. A paymaster or account calling `isVerified` there passes `eth_call` and `eth_estimateUserOperationGas` and is rejected only at `eth_sendUserOperation`. Source: [giwa-io/dojang#37](https://github.com/giwa-io/dojang/issues/37). `scripts/opcode-audit.ts` reproduces it: the trace of `isVerified` contains `TIMESTAMP`.

## The pattern

Resolve the attestation with storage reads only and hand time to the EntryPoint:

1. `schemaUid = DojangScroll._schemaBook().getSchemaUid(keccak256("dojang.dojangschemaids.address"))`
2. `attester = DojangScroll._dojangAttesterBook().getAttester(attesterId)`
3. `uid = DojangScroll._indexer().getAttestationUid(schemaUid, attester, account)`
4. `attestation = EAS.getAttestation(uid)` (EAS predeploy `0x4200000000000000000000000000000000000021`)
5. Reject when `uid` is zero, `revocationTime != 0`, or recipient/schema/attester do not match.
6. Return `expirationTime` as `validUntil` in `validationData`. The EntryPoint then refuses the operation after expiry, which is stricter than a snapshot taken during validation.

`DojangAddressVerifier` implements this and additionally requires the payload to be ABI-encoded `true`.

## What GIWA's infrastructure actually requires

- **EntryPoint version.** The bundler (`https://sepolia-bundler.giwa.io`, a Rundler: `rundler_maxPriorityFeePerGas` answers) reports only `0x433709009B8330FDa32311DF1C2AFA402eD8D009` from `eth_supportedEntryPoints`. That is the canonical **v0.9** address; issue #37 calls it v0.8. v0.8 (`0x4337084D…F108`) also has code on GIWA but is not served by the bundler.
- **validUntil and bit 47.** In EntryPoint v0.9 a `validUntil`/`validAfter` with the highest bit set is a block number. A timestamp must therefore be capped below `2^47`.
- **Stake.** Reading storage of non-entity contracts during validation is `[STO-033]` and needs a staked entity. The bundler's error for an under-staked paymaster states `minimumStake = 0xde0b6b3a7640000` (1 ETH) and `minimumUnstakeDelay = 0x15180` (1 day). Several paymasters on GIWA have locked only 0.001 ETH (EntryPoint `StakeLocked` logs); inference: those do not read external storage in validation.
- **Gas.** Live validation through the proxied Dojang contracts used 135.9k gas in a `debug_traceCall` (21k of it intrinsic). Budget `paymasterVerificationGasLimit` accordingly.
- **postOp accounting.** `actualGasCost` passed to `postOp` excludes the cost of `postOp` itself. In a local run the deposit paid 0.0001909 ETH while `actualGasCost` was 0.0001666 ETH. A paymaster that enforces budgets should add an allowance.
- **EIP-7702.** Type-4 transactions work and a delegated EOA can send UserOps through the bundler. Simple7702Account was not deployed on GIWA at the canonical addresses; this project deployed both the v0.8 and v0.9 versions by replaying the original CREATE2 input. A UserOp carrying the authorization in viem 2.56.9's format (`factory: "0x7702"`) was rejected with `data did not match any variant of untagged enum RpcUserOperationOptionalGas`; not investigated further.
- **RPC.** `https://sepolia-rpc.giwa.io` is load-balanced: a read right after a receipt can miss the new state. `eth_getLogs` is limited to 10,000 blocks; `debug_traceCall` is available.

## Not verified

- That a paymaster with 1 ETH stake passes the bundler's full simulation. The opcode audit covers banned opcodes in the paymaster frame, not every ERC-7562 storage rule.
- Behaviour on GIWA mainnet.
