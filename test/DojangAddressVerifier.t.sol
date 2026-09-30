// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Attestation, IDojangScroll} from "../src/interfaces/IDojang.sol";
import {DojangAddressVerifier} from "../src/libraries/DojangAddressVerifier.sol";
import {MockSchemaBook} from "./mocks/MockDojang.sol";
import {DojangFixture} from "./utils/DojangFixture.sol";

contract DojangAddressVerifierTest is DojangFixture {
    address internal user = makeAddr("user");
    uint64 internal expiry;

    function setUp() public {
        vm.warp(1_790_000_000);
        _deployDojang();
        expiry = uint64(block.timestamp + 30 days);
    }

    function _check(address account, bytes32[] memory ids)
        internal
        view
        returns (DojangAddressVerifier.Verdict memory)
    {
        return DojangAddressVerifier.check(IDojangScroll(address(scroll)), account, ids);
    }

    function _assertRejected(Attestation memory a) internal {
        _issue(a);
        assertFalse(_check(user, _ids(ID_A)).verified);
    }

    // FR-1, FR-7: a valid attestation is accepted and its expiry is handed back, not evaluated.
    function test_validAttestation_returnsExpiryAsValidUntil() public {
        bytes32 uid = _issue(_record(attesterA, user, expiry));
        DojangAddressVerifier.Verdict memory verdict = _check(user, _ids(ID_A));
        assertTrue(verdict.verified);
        assertEq(verdict.validUntil, expiry);
        assertEq(verdict.attesterId, ID_A);
        assertEq(verdict.uid, uid);
    }

    // FR-1: the verdict does not depend on the current time; enforcement is left to the EntryPoint.
    function test_expiredAttestation_isStillResolvedWithItsExpiry() public {
        _issue(_record(attesterA, user, expiry));
        vm.warp(expiry + 1);
        DojangAddressVerifier.Verdict memory verdict = _check(user, _ids(ID_A));
        assertTrue(verdict.verified);
        assertEq(verdict.validUntil, expiry);
    }

    // FR-7
    function test_nonExpiringAttestation_returnsZeroValidUntil() public {
        _issue(_record(attesterA, user, 0));
        assertEq(_check(user, _ids(ID_A)).validUntil, 0);
    }

    // FR-7: EntryPoint v0.9 reads bit 47 as "block number mode"; a timestamp must never set it.
    function testFuzz_validUntil_neverEntersBlockNumberMode(uint64 expirationTime) public {
        _issue(_record(attesterA, user, expirationTime));
        uint48 validUntil = _check(user, _ids(ID_A)).validUntil;
        assertEq(validUntil & (uint48(1) << 47), 0);
        assertEq(
            validUntil,
            expirationTime > DojangAddressVerifier.MAX_TIMESTAMP ? DojangAddressVerifier.MAX_TIMESTAMP : expirationTime
        );
    }

    // FR-3
    function test_noAttestation_isRejected() public view {
        assertFalse(_check(user, _ids(ID_A)).verified);
    }

    // FR-3: an id without a registered attester is skipped, not treated as address(0).
    function test_unregisteredAttesterId_isRejected() public {
        _issue(_record(address(0), user, expiry));
        assertFalse(_check(user, _ids(keccak256("unknown"))).verified);
    }

    function test_emptyAttesterIdList_isRejected() public {
        _issue(_record(attesterA, user, expiry));
        assertFalse(_check(user, new bytes32[](0)).verified);
    }

    function test_missingSchemaRegistration_isRejected() public {
        _issue(_record(attesterA, user, expiry));
        scroll.setSchemaBook(new MockSchemaBook());
        assertFalse(_check(user, _ids(ID_A)).verified);
    }

    // FR-4
    function test_revokedAttestation_isRejected() public {
        Attestation memory a = _record(attesterA, user, expiry);
        a.revocationTime = uint64(block.timestamp);
        _assertRejected(a);
    }

    // FR-5: the indexed record must actually belong to this recipient.
    function test_recipientMismatch_isRejected() public {
        Attestation memory a = _record(attesterA, makeAddr("someoneElse"), expiry);
        eas.put(a);
        indexer.set(SCHEMA_UID, attesterA, user, a.uid);
        assertFalse(_check(user, _ids(ID_A)).verified);
    }

    // FR-5
    function test_schemaMismatch_isRejected() public {
        Attestation memory a = _record(attesterA, user, expiry);
        a.schema = keccak256("other-schema");
        _assertRejected(a);
    }

    // FR-5
    function test_attesterMismatch_isRejected() public {
        Attestation memory a = _record(attesterB, user, expiry);
        eas.put(a);
        indexer.set(SCHEMA_UID, attesterA, user, a.uid);
        assertFalse(_check(user, _ids(ID_A)).verified);
    }

    // FR-5: an index pointing at a uid EAS does not know returns an empty record.
    function test_danglingIndexEntry_isRejected() public {
        indexer.set(SCHEMA_UID, attesterA, user, keccak256("missing"));
        assertFalse(_check(user, _ids(ID_A)).verified);
    }

    // FR-6: DojangScroll ignores the payload; this library requires exactly `true`.
    function test_payloadFalse_isRejected() public {
        Attestation memory a = _record(attesterA, user, expiry);
        a.data = abi.encode(false);
        _assertRejected(a);
    }

    // FR-6
    function test_payloadEmpty_isRejected() public {
        Attestation memory a = _record(attesterA, user, expiry);
        a.data = "";
        _assertRejected(a);
    }

    // FR-6
    function test_payloadWithExtraWord_isRejected() public {
        Attestation memory a = _record(attesterA, user, expiry);
        a.data = abi.encode(true, uint256(1));
        _assertRejected(a);
    }

    // FR-6
    function test_payloadNonCanonicalBool_isRejected() public {
        Attestation memory a = _record(attesterA, user, expiry);
        a.data = abi.encode(uint256(2));
        _assertRejected(a);
    }

    // FR-2: after an attester rotation the old attester's attestation no longer counts.
    function test_attesterRotation_followsCurrentAttester() public {
        _issue(_record(attesterA, user, expiry));
        assertTrue(_check(user, _ids(ID_A)).verified);

        address rotated = makeAddr("rotated");
        attesterBook.set(ID_A, rotated);
        assertFalse(_check(user, _ids(ID_A)).verified);

        _issue(_record(rotated, user, expiry));
        assertTrue(_check(user, _ids(ID_A)).verified);
    }

    // FR-2: a new schema book configured on DojangScroll is picked up without redeploying.
    function test_schemaBookChange_isFollowed() public {
        _issue(_record(attesterA, user, expiry));
        MockSchemaBook replacement = new MockSchemaBook();
        replacement.set(DojangAddressVerifier.ADDRESS_DOJANG_SCHEMA_ID, keccak256("new-schema"));
        scroll.setSchemaBook(replacement);
        assertFalse(_check(user, _ids(ID_A)).verified);
    }

    // FR-8: the first valid attester in list order wins.
    function test_multipleIds_firstValidWins() public {
        Attestation memory revoked = _record(attesterA, user, expiry);
        revoked.revocationTime = 1;
        _issue(revoked);
        bytes32 uidB = _issue(_record(attesterB, user, expiry + 1));

        DojangAddressVerifier.Verdict memory verdict = _check(user, _ids(ID_A, ID_B));
        assertTrue(verdict.verified);
        assertEq(verdict.attesterId, ID_B);
        assertEq(verdict.uid, uidB);
        assertEq(verdict.validUntil, expiry + 1);
    }

    // FR-8
    function test_multipleIds_preferListOrder() public {
        _issue(_record(attesterA, user, expiry));
        _issue(_record(attesterB, user, expiry + 1));
        assertEq(_check(user, _ids(ID_B, ID_A)).attesterId, ID_B);
    }
}
