// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Minimal views of the deployed Dojang and EAS contracts on GIWA Sepolia. Signatures and the struct
// layout are copied from giwa-io/dojang@3a4d507 (src/DojangScroll.sol, SchemaBook.sol,
// DojangAttesterBook.sol, AttestationIndexer.sol) and ethereum-attestation-service/eas-contracts
// (contracts/Common.sol) so that this kit does not depend on their full sources.

/// @dev EAS attestation record, identical field order to eas-contracts `Attestation`.
struct Attestation {
    bytes32 uid;
    bytes32 schema;
    uint64 time;
    uint64 expirationTime;
    uint64 revocationTime;
    bytes32 refUID;
    address recipient;
    address attester;
    bool revocable;
    bytes data;
}

interface IEAS {
    function getAttestation(bytes32 uid) external view returns (Attestation memory);
}

interface ISchemaBook {
    function getSchemaUid(bytes32 schemaId) external view returns (bytes32);
}

interface IDojangAttesterBook {
    /// @dev Dojang types the id as `DojangAttesterId` (a bytes32 user-defined value type); ABI-identical.
    function getAttester(bytes32 attesterId) external view returns (address);
}

interface IAttestationIndexer {
    function getAttestationUid(bytes32 schemaUid, address attester, address recipient) external view returns (bytes32);
}

/// @dev Only the public configuration getters are used; `isVerified` is deliberately avoided because it
/// reads `block.timestamp`, which ERC-7562 forbids during ERC-4337 validation (giwa-io/dojang#37).
interface IDojangScroll {
    function _schemaBook() external view returns (ISchemaBook);
    function _dojangAttesterBook() external view returns (IDojangAttesterBook);
    function _indexer() external view returns (IAttestationIndexer);
}
