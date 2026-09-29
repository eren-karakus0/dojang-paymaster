# 0001. Toolchain: Foundry for contracts, TypeScript + viem for anything that signs

- Status: accepted
- Date: 2026-09-29

## Context

A few security-critical contracts need unit, fuzz and GIWA Sepolia fork tests, gas measurements and Blockscout verification. Deployments and end-to-end runs sign with a wallet whose key is stored with Windows DPAPI; project rules forbid passing keys through argv, environment variables or plaintext files, which rules out `forge script --private-key`/`PRIVATE_KEY`.

## Decision drivers (weights fixed before scoring)

| Driver | Weight |
|---|---|
| Key handling without argv/env exposure | 5 |
| Test, fuzz and fork capability | 4 |
| Fit with Dojang, EAS and eth-infinitism code (all Foundry-friendly Solidity) | 4 |
| Existing experience (viem, TypeScript) | 3 |
| Verification and deployment ergonomics | 2 |

## Options and scores

| Driver | Weight | Foundry + TS/viem | Hardhat 3 | Ape (Python) |
|---|---|---|---|---|
| Key handling | 5 | 5 | 5 | 3 |
| Tests/fuzz/fork | 4 | 5 | 4 | 3 |
| Ecosystem fit | 4 | 5 | 3 | 2 |
| Experience | 3 | 4 | 4 | 2 |
| Verification | 2 | 4 | 4 | 3 |
| **Total** | | **83** | 71 | 48 |

## Decision

Foundry compiles and tests the contracts; TypeScript scripts using viem perform every chain write, decrypting the key in-process only while signing. Hardhat 3 matches on key handling but has weaker fuzzing and diverges from the reference code's tooling. Ape would require re-implementing the DPAPI signer in Python.

### Consequences

- Good: fast fuzz/fork tests, no key on the command line, the same signer pattern as the owner's other GIWA code.
- Bad: two toolchains (forge and node); deployments cannot use `forge script` broadcasts, so deployment records are written by our scripts to `deployments/91342.json`.

### Validation

CI builds and tests contracts and scripts on Linux and Windows; the repository secret scan finds no key material.
