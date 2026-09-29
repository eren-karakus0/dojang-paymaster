// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {Simple7702Account} from "account-abstraction/accounts/Simple7702Account.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Attestation, IDojangScroll} from "../src/interfaces/IDojang.sol";
import {DojangVerifiedPaymaster} from "../src/DojangVerifiedPaymaster.sol";
import {DojangFixture} from "./utils/DojangFixture.sol";

contract DojangVerifiedPaymasterTest is DojangFixture {
    uint256 internal constant PER_OP = 0.001 ether;
    uint256 internal constant PER_ACCOUNT = 0.003 ether;

    EntryPoint internal entryPoint;
    DojangVerifiedPaymaster internal paymaster;
    address internal owner = makeAddr("owner");
    // EntryPoint v0.9 only accepts handleOps from an EOA (msg.sender == tx.origin).
    address internal constant BUNDLER = address(0xB0B);
    Vm.Wallet internal user;
    Vm.Wallet internal stranger;
    uint64 internal expiry;

    function setUp() public {
        vm.warp(1_790_000_000);
        _deployDojang();
        entryPoint = new EntryPoint();
        paymaster = new DojangVerifiedPaymaster(
            IEntryPoint(address(entryPoint)),
            owner,
            IDojangScroll(address(scroll)),
            _ids(ID_A, ID_B),
            PER_OP,
            PER_ACCOUNT
        );
        user = vm.createWallet("user");
        stranger = vm.createWallet("stranger");
        expiry = uint64(block.timestamp + 30 days);
        _issue(_record(attesterA, user.addr, expiry));
    }

    function _op(address sender) internal pure returns (PackedUserOperation memory op) {
        op.sender = sender;
    }

    function _validate(address sender, uint256 maxCost)
        internal
        returns (bytes memory context, uint256 validationData)
    {
        vm.prank(address(entryPoint));
        return paymaster.validatePaymasterUserOp(_op(sender), bytes32(0), maxCost);
    }

    function _postOp(bytes memory context, uint256 actualGasCost) internal {
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, context, actualGasCost, 1);
    }

    // FR-9, FR-11: sponsored with the attestation expiry packed as validUntil and no validAfter.
    function test_verifiedSender_isSponsoredUntilAttestationExpiry() public {
        (bytes memory context, uint256 validationData) = _validate(user.addr, PER_OP);
        assertEq(address(uint160(validationData)), address(0), "not a signature failure");
        assertEq(uint48(validationData >> 160), expiry, "validUntil");
        assertEq(uint48(validationData >> 208), 0, "validAfter");
        (address sender, uint256 chargedEpoch) = abi.decode(context, (address, uint256));
        assertEq(sender, user.addr);
        assertEq(chargedEpoch, 0);
    }

    // FR-10
    function test_unverifiedSender_isRejected() public {
        vm.expectRevert(abi.encodeWithSelector(DojangVerifiedPaymaster.SenderNotVerified.selector, stranger.addr));
        _validate(stranger.addr, PER_OP);
    }

    // FR-12
    function test_costAbovePerOpLimit_isRejected() public {
        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedPaymaster.MaxCostPerOpExceeded.selector, PER_OP + 1, PER_OP)
        );
        _validate(user.addr, PER_OP + 1);
    }

    // FR-13, FR-14: completed spending plus the new worst case must fit the account budget.
    function test_accountBudget_countsCompletedSpending() public {
        (bytes memory context,) = _validate(user.addr, PER_OP);
        _postOp(context, 0.0025 ether);
        uint256 recorded = 0.0025 ether + paymaster.POST_OP_OVERHEAD_GAS();
        assertEq(paymaster.spent(0, user.addr), recorded);
        assertEq(paymaster.remainingBudget(user.addr), PER_ACCOUNT - recorded);

        _validate(user.addr, PER_ACCOUNT - recorded);
        vm.expectRevert(
            abi.encodeWithSelector(
                DojangVerifiedPaymaster.AccountBudgetExceeded.selector,
                user.addr,
                recorded,
                PER_ACCOUNT - recorded + 1,
                PER_ACCOUNT
            )
        );
        _validate(user.addr, PER_ACCOUNT - recorded + 1);
    }

    // FR-14: a reverted user operation still costs the paymaster and is still charged.
    function test_postOp_chargesRevertedOperations() public {
        (bytes memory context,) = _validate(user.addr, PER_OP);
        vm.prank(address(entryPoint));
        paymaster.postOp(IPaymaster.PostOpMode.opReverted, context, 123, 1);
        assertEq(paymaster.spent(0, user.addr), 123 + paymaster.POST_OP_OVERHEAD_GAS());
    }

    // FR-17: a new epoch resets budgets; a charge validated in the old epoch stays there.
    function test_advanceEpoch_resetsBudgetsWithoutMovingInFlightCharges() public {
        (bytes memory context,) = _validate(user.addr, PER_OP);
        vm.prank(owner);
        paymaster.advanceEpoch();
        _postOp(context, PER_ACCOUNT);
        assertEq(paymaster.spent(0, user.addr), PER_ACCOUNT + paymaster.POST_OP_OVERHEAD_GAS());
        assertEq(paymaster.spent(1, user.addr), 0);
        assertEq(paymaster.remainingBudget(user.addr), PER_ACCOUNT);
    }

    // FR-15
    function test_setAttesterIds_changesAcceptedAttesters() public {
        vm.prank(owner);
        paymaster.setAttesterIds(_ids(ID_B));
        vm.expectRevert(abi.encodeWithSelector(DojangVerifiedPaymaster.SenderNotVerified.selector, user.addr));
        _validate(user.addr, PER_OP);
        assertEq(paymaster.attesterIds().length, 1);
    }

    // FR-15
    function test_setAttesterIds_rejectsMoreThanEight() public {
        bytes32[] memory ids = new bytes32[](9);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DojangVerifiedPaymaster.TooManyAttesterIds.selector, 9));
        paymaster.setAttesterIds(ids);
    }

    // FR-16
    function test_setLimits_appliesNewLimits() public {
        vm.prank(owner);
        paymaster.setLimits(1, 1);
        vm.expectRevert(abi.encodeWithSelector(DojangVerifiedPaymaster.MaxCostPerOpExceeded.selector, 2, 1));
        _validate(user.addr, 2);
    }

    // FR-18
    function test_ownerFunctions_rejectOtherCallers() public {
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger.addr);
        vm.startPrank(stranger.addr);
        vm.expectRevert(unauthorized);
        paymaster.setAttesterIds(_ids(ID_A));
        vm.expectRevert(unauthorized);
        paymaster.setLimits(1, 1);
        vm.expectRevert(unauthorized);
        paymaster.advanceEpoch();
        vm.expectRevert(unauthorized);
        paymaster.withdrawTo(payable(stranger.addr), 1);
        vm.stopPrank();
    }

    function test_validationAndPostOp_onlyFromEntryPoint() public {
        bytes4 notFromEntryPoint = bytes4(keccak256("NotFromEntryPoint(address,address,address)"));
        vm.expectPartialRevert(notFromEntryPoint);
        paymaster.validatePaymasterUserOp(_op(user.addr), bytes32(0), PER_OP);
        vm.expectPartialRevert(notFromEntryPoint);
        paymaster.postOp(IPaymaster.PostOpMode.opSucceeded, abi.encode(user.addr, 0), 1, 1);
    }

    function test_constructor_rejectsZeroScroll() public {
        vm.expectRevert(DojangVerifiedPaymaster.ZeroAddress.selector);
        new DojangVerifiedPaymaster(
            IEntryPoint(address(entryPoint)), owner, IDojangScroll(address(0)), _ids(ID_A), 1, 1
        );
    }

    // NFR-3 / NFR-4: validation gas with one matching id, and the worst case of eight ids none matching.
    function test_gas_validation() public {
        vm.prank(owner);
        paymaster.setAttesterIds(_ids(ID_A));
        vm.prank(address(entryPoint));
        uint256 before = gasleft();
        paymaster.validatePaymasterUserOp(_op(user.addr), bytes32(0), PER_OP);
        uint256 oneId = before - gasleft();

        bytes32[] memory eight = new bytes32[](8);
        for (uint256 i; i < 8; ++i) {
            eight[i] = keccak256(abi.encode("unknown", i));
        }
        // Worst case: every id resolves to a record that is read in full and then rejected (revoked).
        for (uint256 i; i < 8; ++i) {
            address attester = makeAddr(string(abi.encode(i)));
            attesterBook.set(eight[i], attester);
            Attestation memory revoked = _record(attester, user.addr, expiry);
            revoked.revocationTime = 1;
            _issue(revoked);
        }
        vm.prank(owner);
        paymaster.setAttesterIds(eight);
        vm.prank(address(entryPoint));
        before = gasleft();
        try paymaster.validatePaymasterUserOp(_op(user.addr), bytes32(0), PER_OP) {} catch {}
        uint256 eightMisses = before - gasleft();

        emit log_named_uint("validation gas, 1 id, verified", oneId);
        emit log_named_uint("validation gas, 8 ids, none verified", eightMisses);
        assertLe(oneId, 120_000);
        assertLe(eightMisses, 600_000);
    }

    // End to end through the real EntryPoint v0.9: an EIP-7702 delegated, attested EOA is sponsored.
    function test_handleOps_sponsorsDelegatedVerifiedEoa() public {
        _fundPaymaster();
        Simple7702Account implementation = new Simple7702Account(IEntryPoint(address(entryPoint)));
        vm.signAndAttachDelegation(address(implementation), user.privateKey);
        address target = makeAddr("target");
        PackedUserOperation memory op = _signedOp(user, _execute(target));

        uint256 depositBefore = paymaster.getDeposit();
        uint256 userBalanceBefore = user.addr.balance;
        _handle(op);
        assertEq(user.addr.balance, userBalanceBefore, "user paid nothing");
        uint256 charged = depositBefore - paymaster.getDeposit();
        assertGt(charged, 0);
        // The recorded charge must not undercount what the deposit actually paid, and may overcount by at
        // most the postOp allowance.
        uint256 recorded = paymaster.spent(0, user.addr);
        assertGe(recorded, charged, "budget never undercounts");
        assertLe(recorded - charged, paymaster.POST_OP_OVERHEAD_GAS() * 1 gwei, "overcount bounded");
    }

    function test_handleOps_rejectsDelegatedUnverifiedEoa() public {
        _fundPaymaster();
        Simple7702Account implementation = new Simple7702Account(IEntryPoint(address(entryPoint)));
        vm.signAndAttachDelegation(address(implementation), stranger.privateKey);
        PackedUserOperation memory op = _signedOp(stranger, _execute(stranger.addr));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectPartialRevert(IEntryPoint.FailedOpWithRevert.selector);
        vm.prank(BUNDLER, BUNDLER);
        entryPoint.handleOps(ops, payable(makeAddr("beneficiary")));
    }

    function _execute(address target) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("execute(address,uint256,bytes)", target, uint256(0), bytes(""));
    }

    function _fundPaymaster() internal {
        vm.deal(owner, 1 ether);
        vm.startPrank(owner);
        paymaster.addStake{value: 0.001 ether}(1 days);
        paymaster.deposit{value: 0.01 ether}();
        vm.stopPrank();
    }

    function _signedOp(Vm.Wallet memory wallet, bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = wallet.addr;
        op.nonce = entryPoint.getNonce(wallet.addr, 0);
        op.callData = callData;
        op.accountGasLimits = bytes32(uint256(150_000) << 128 | uint256(100_000));
        op.preVerificationGas = 50_000;
        // Worst case (560k gas * 1 gwei) stays under PER_OP.
        op.gasFees = bytes32(uint256(1 gwei) << 128 | uint256(1 gwei));
        op.paymasterAndData = abi.encodePacked(address(paymaster), uint128(200_000), uint128(60_000));
        bytes32 userOpHash = entryPoint.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wallet.privateKey, userOpHash);
        op.signature = abi.encodePacked(r, s, v);
    }

    function _handle(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.fee(1 gwei);
        vm.prank(BUNDLER, BUNDLER);
        entryPoint.handleOps(ops, payable(makeAddr("beneficiary")));
    }
}
