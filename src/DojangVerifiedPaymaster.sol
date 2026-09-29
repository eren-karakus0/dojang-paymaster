// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {_packValidationData} from "account-abstraction/core/Helpers.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IDojangScroll} from "./interfaces/IDojang.sol";
import {DojangAddressVerifier} from "./libraries/DojangAddressVerifier.sol";

/// @title DojangVerifiedPaymaster
/// @notice Sponsors gas for UserOperations whose sender holds a valid Dojang "Verified Address"
/// attestation, within per-operation and per-account budgets. Intended for EIP-7702 accounts, where the
/// sender is the user's own (attested) EOA.
/// @dev ERC-7562 notes: validation reads this contract's storage and external Dojang/EAS storage, so the
/// paymaster must be staked [STO-031, STO-033]. Validation neither writes storage nor reads the clock;
/// attestation expiry is enforced by the EntryPoint through `validUntil`. Spending is recorded in
/// `_postOp`, so the per-account check uses spending from already-completed operations only.
/// Reference implementation; not audited.
contract DojangVerifiedPaymaster is BasePaymaster {
    uint256 public constant MAX_ATTESTER_IDS = 8;
    /// @notice Gas added to each charge for this contract's own postOp, which the EntryPoint bills after
    /// `actualGasCost` is computed. Measured at ~24.3k (first write to a fresh spent slot); rounded up so
    /// budgets err towards over-counting.
    uint256 public constant POST_OP_OVERHEAD_GAS = 25_000;

    IDojangScroll public immutable dojangScroll;
    uint256 public maxCostPerOp;
    uint256 public maxCostPerAccount;
    /// @notice Budget period. Advancing it gives every account a fresh `maxCostPerAccount`.
    uint256 public epoch;
    mapping(uint256 epoch => mapping(address account => uint256 spentWei)) public spent;
    bytes32[] private _attesterIds;

    event AttesterIdsSet(bytes32[] attesterIds);
    event LimitsSet(uint256 maxCostPerOp, uint256 maxCostPerAccount);
    event EpochAdvanced(uint256 epoch);
    event Sponsored(address indexed account, uint256 indexed epoch, uint256 actualGasCost);

    error ZeroAddress();
    error TooManyAttesterIds(uint256 count);
    error SenderNotVerified(address sender);
    error MaxCostPerOpExceeded(uint256 maxCost, uint256 limit);
    error AccountBudgetExceeded(address account, uint256 spentWei, uint256 maxCost, uint256 limit);

    constructor(
        IEntryPoint entryPoint_,
        address owner_,
        IDojangScroll dojangScroll_,
        bytes32[] memory attesterIds_,
        uint256 maxCostPerOp_,
        uint256 maxCostPerAccount_
    ) BasePaymaster(entryPoint_, owner_) {
        if (address(dojangScroll_) == address(0)) revert ZeroAddress();
        dojangScroll = dojangScroll_;
        _setAttesterIds(attesterIds_);
        _setLimits(maxCostPerOp_, maxCostPerAccount_);
    }

    function attesterIds() external view returns (bytes32[] memory) {
        return _attesterIds;
    }

    /// @notice Remaining sponsorship for `account` in the current epoch.
    function remainingBudget(address account) external view returns (uint256) {
        uint256 used = spent[epoch][account];
        return used >= maxCostPerAccount ? 0 : maxCostPerAccount - used;
    }

    function setAttesterIds(bytes32[] calldata ids) external onlyOwner {
        _setAttesterIds(ids);
    }

    function setLimits(uint256 maxCostPerOp_, uint256 maxCostPerAccount_) external onlyOwner {
        _setLimits(maxCostPerOp_, maxCostPerAccount_);
    }

    function advanceEpoch() external onlyOwner {
        emit EpochAdvanced(++epoch);
    }

    /// @dev Extra `paymasterData` (and a v0.9 paymaster signature) is ignored: sponsorship depends only on
    /// the sender's attestation and the budgets.
    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        if (maxCost > maxCostPerOp) revert MaxCostPerOpExceeded(maxCost, maxCostPerOp);
        address sender = userOp.sender;
        uint256 currentEpoch = epoch;
        uint256 used = spent[currentEpoch][sender];
        if (used + maxCost > maxCostPerAccount) revert AccountBudgetExceeded(sender, used, maxCost, maxCostPerAccount);

        DojangAddressVerifier.Verdict memory verdict = DojangAddressVerifier.check(dojangScroll, sender, _attesterIds);
        if (!verdict.verified) revert SenderNotVerified(sender);
        // The epoch travels in the context so an owner reset between validation and postOp cannot move
        // this charge into the new period.
        return (abi.encode(sender, currentEpoch), _packValidationData(false, verdict.validUntil, 0));
    }

    /// @dev Only arithmetic and an event: a revert here would undo the user's operation.
    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas)
        internal
        override
    {
        (address sender, uint256 chargedEpoch) = abi.decode(context, (address, uint256));
        uint256 charge = actualGasCost + POST_OP_OVERHEAD_GAS * actualUserOpFeePerGas;
        spent[chargedEpoch][sender] += charge;
        emit Sponsored(sender, chargedEpoch, charge);
    }

    function _setAttesterIds(bytes32[] memory ids) private {
        if (ids.length > MAX_ATTESTER_IDS) revert TooManyAttesterIds(ids.length);
        _attesterIds = ids;
        emit AttesterIdsSet(ids);
    }

    function _setLimits(uint256 maxCostPerOp_, uint256 maxCostPerAccount_) private {
        maxCostPerOp = maxCostPerOp_;
        maxCostPerAccount = maxCostPerAccount_;
        emit LimitsSet(maxCostPerOp_, maxCostPerAccount_);
    }
}
