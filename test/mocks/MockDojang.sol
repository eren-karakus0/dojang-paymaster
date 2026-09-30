// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    Attestation,
    IAttestationIndexer,
    IDojangAttesterBook,
    IDojangScroll,
    IEAS,
    ISchemaBook
} from "../../src/interfaces/IDojang.sol";

contract MockEAS is IEAS {
    mapping(bytes32 uid => Attestation) private _attestations;

    function put(Attestation memory attestation) external {
        _attestations[attestation.uid] = attestation;
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return _attestations[uid];
    }
}

contract MockSchemaBook is ISchemaBook {
    mapping(bytes32 schemaId => bytes32 schemaUid) public schemas;

    function set(bytes32 schemaId, bytes32 schemaUid) external {
        schemas[schemaId] = schemaUid;
    }

    function getSchemaUid(bytes32 schemaId) external view returns (bytes32) {
        return schemas[schemaId];
    }
}

contract MockAttesterBook is IDojangAttesterBook {
    mapping(bytes32 attesterId => address attester) public attesters;

    function set(bytes32 attesterId, address attester) external {
        attesters[attesterId] = attester;
    }

    function getAttester(bytes32 attesterId) external view returns (address) {
        return attesters[attesterId];
    }
}

contract MockIndexer is IAttestationIndexer {
    mapping(bytes32 schemaUid => mapping(address attester => mapping(address recipient => bytes32 uid))) public uids;

    function set(bytes32 schemaUid, address attester, address recipient, bytes32 uid) external {
        uids[schemaUid][attester][recipient] = uid;
    }

    function getAttestationUid(bytes32 schemaUid, address attester, address recipient) external view returns (bytes32) {
        return uids[schemaUid][attester][recipient];
    }
}

contract MockDojangScroll is IDojangScroll {
    ISchemaBook public _schemaBook;
    IDojangAttesterBook public _dojangAttesterBook;
    IAttestationIndexer public _indexer;

    constructor(ISchemaBook schemaBook, IDojangAttesterBook attesterBook, IAttestationIndexer indexer) {
        _schemaBook = schemaBook;
        _dojangAttesterBook = attesterBook;
        _indexer = indexer;
    }

    function setSchemaBook(ISchemaBook schemaBook) external {
        _schemaBook = schemaBook;
    }
}
