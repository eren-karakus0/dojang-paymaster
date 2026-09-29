// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Attestation, IAttestationIndexer, IDojangAttesterBook, IDojangScroll, IEAS} from "../interfaces/IDojang.sol";

/// @title DojangAddressVerifier
/// @notice Resolves a Dojang "Verified Address" attestation without reading the clock, so it can run
/// inside ERC-4337 validation. Expiry is returned as `validUntil` for the EntryPoint to enforce instead
/// of being evaluated here (the pattern described in giwa-io/dojang#37).
/// @dev Every read is a plain storage access on Dojang/EAS contracts. Under ERC-7562 [STO-033] the calling
/// paymaster or account must be staked. Differences from `DojangScroll.isVerified`:
/// - expiry is not checked here; callers must pass `validUntil` on (EntryPoint does the check);
/// - the attestation payload must be exactly ABI-encoded `true` (DojangScroll ignores the payload);
/// - recipient, schema and attester of the returned record are re-checked.
library DojangAddressVerifier {
    /// @dev `DojangSchemaIds.ADDRESS_DOJANG` in giwa-io/dojang src/libraries/Types.sol.
    bytes32 internal constant ADDRESS_DOJANG_SCHEMA_ID = keccak256("dojang.dojangschemaids.address");
    /// @dev EAS predeploy on OP Stack chains, the address DojangScroll itself uses.
    IEAS internal constant EAS = IEAS(0x4200000000000000000000000000000000000021);
    /// @dev EntryPoint v0.9 treats validUntil/validAfter with bit 47 set as block numbers, so a timestamp
    /// must stay below 2^47.
    uint48 internal constant MAX_TIMESTAMP = (uint48(1) << 47) - 1;

    struct Verdict {
        bool verified;
        /// @dev 0 means the attestation never expires.
        uint48 validUntil;
        bytes32 attesterId;
        bytes32 uid;
    }

    /// @notice Returns the first valid attestation of `account` among `attesterIds`, in list order.
    /// @dev Never reverts on missing or invalid data; it returns `verified == false`. Reverts only if a
    /// Dojang contract call itself reverts.
    function check(IDojangScroll scroll, address account, bytes32[] memory attesterIds)
        internal
        view
        returns (Verdict memory verdict)
    {
        if (attesterIds.length == 0) return verdict;
        bytes32 schemaUid = scroll._schemaBook().getSchemaUid(ADDRESS_DOJANG_SCHEMA_ID);
        if (schemaUid == bytes32(0)) return verdict;
        IDojangAttesterBook attesterBook = scroll._dojangAttesterBook();
        IAttestationIndexer indexer = scroll._indexer();

        for (uint256 i; i < attesterIds.length; ++i) {
            verdict = _checkAttester(attesterBook, indexer, schemaUid, account, attesterIds[i]);
            if (verdict.verified) return verdict;
        }
        return Verdict(false, 0, bytes32(0), bytes32(0));
    }

    /// @dev Uses the attester currently registered for the id, like DojangScroll, so attester rotations
    /// are followed and attestations of a replaced attester stop counting.
    function _checkAttester(
        IDojangAttesterBook attesterBook,
        IAttestationIndexer indexer,
        bytes32 schemaUid,
        address account,
        bytes32 attesterId
    ) private view returns (Verdict memory verdict) {
        address attester = attesterBook.getAttester(attesterId);
        if (attester == address(0)) return verdict;
        bytes32 uid = indexer.getAttestationUid(schemaUid, attester, account);
        if (uid == bytes32(0)) return verdict;

        Attestation memory attestation = EAS.getAttestation(uid);
        if (!_isValidRecord(attestation, uid, schemaUid, attester, account)) return verdict;
        return Verdict(true, _validUntil(attestation.expirationTime), attesterId, uid);
    }

    function _isValidRecord(
        Attestation memory attestation,
        bytes32 uid,
        bytes32 schemaUid,
        address attester,
        address account
    ) private pure returns (bool) {
        return attestation.uid == uid && attestation.revocationTime == 0 && attestation.recipient == account
            && attestation.schema == schemaUid && attestation.attester == attester && _isTrue(attestation.data);
    }

    /// @dev Schema content is `bool isVerified`; anything but a single word equal to 1 is rejected.
    function _isTrue(bytes memory data) private pure returns (bool) {
        return data.length == 32 && uint256(bytes32(data)) == 1;
    }

    function _validUntil(uint64 expirationTime) private pure returns (uint48) {
        if (expirationTime > MAX_TIMESTAMP) return MAX_TIMESTAMP;
        return uint48(expirationTime);
    }
}
