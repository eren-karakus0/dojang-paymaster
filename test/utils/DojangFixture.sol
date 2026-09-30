// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Attestation} from "../../src/interfaces/IDojang.sol";
import {DojangAddressVerifier} from "../../src/libraries/DojangAddressVerifier.sol";
import {MockAttesterBook, MockDojangScroll, MockEAS, MockIndexer, MockSchemaBook} from "../mocks/MockDojang.sol";

/// @dev Deploys a mock Dojang stack with the EAS mock at the real predeploy address, and issues
/// attestations the way the Dojang resolver indexes them.
abstract contract DojangFixture is Test {
    bytes32 internal constant SCHEMA_UID = keccak256("test.address-schema-uid");
    bytes32 internal constant ID_A = keccak256("test.attester-a");
    bytes32 internal constant ID_B = keccak256("test.attester-b");

    MockEAS internal eas;
    MockSchemaBook internal schemaBook;
    MockAttesterBook internal attesterBook;
    MockIndexer internal indexer;
    MockDojangScroll internal scroll;
    address internal attesterA = makeAddr("attesterA");
    address internal attesterB = makeAddr("attesterB");
    uint256 private _nonce;

    function _deployDojang() internal {
        vm.etch(address(DojangAddressVerifier.EAS), address(new MockEAS()).code);
        eas = MockEAS(address(DojangAddressVerifier.EAS));
        schemaBook = new MockSchemaBook();
        attesterBook = new MockAttesterBook();
        indexer = new MockIndexer();
        scroll = new MockDojangScroll(schemaBook, attesterBook, indexer);
        schemaBook.set(DojangAddressVerifier.ADDRESS_DOJANG_SCHEMA_ID, SCHEMA_UID);
        attesterBook.set(ID_A, attesterA);
        attesterBook.set(ID_B, attesterB);
    }

    function _record(address attester, address recipient, uint64 expirationTime)
        internal
        returns (Attestation memory a)
    {
        a.uid = keccak256(abi.encode("uid", ++_nonce));
        a.schema = SCHEMA_UID;
        a.time = uint64(block.timestamp);
        a.expirationTime = expirationTime;
        a.recipient = recipient;
        a.attester = attester;
        a.revocable = true;
        a.data = abi.encode(true);
    }

    /// @dev Stores the attestation in EAS and indexes it under its own attester/recipient.
    function _issue(Attestation memory a) internal returns (bytes32) {
        eas.put(a);
        indexer.set(SCHEMA_UID, a.attester, a.recipient, a.uid);
        return a.uid;
    }

    function _ids(bytes32 first) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](1);
        ids[0] = first;
    }

    function _ids(bytes32 first, bytes32 second) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](2);
        ids[0] = first;
        ids[1] = second;
    }
}
