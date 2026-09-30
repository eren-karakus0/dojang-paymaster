// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IDojangScroll} from "../../src/interfaces/IDojang.sol";
import {DojangAddressVerifier} from "../../src/libraries/DojangAddressVerifier.sol";

interface IDojangScrollIsVerified {
    function isVerified(address addr, bytes32 attesterId) external view returns (bool);
}

/// @notice Runs the library against the live Dojang deployment on GIWA Sepolia.
/// Set DOJANG_FORK_ACCOUNT to an address with a Verified Address attestation; otherwise the test is
/// skipped so that no personal address has to be committed.
contract DojangForkTest is Test {
    address internal constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;

    function _addressAttesterIds() internal pure returns (bytes32[] memory ids) {
        // Address Dojang attester ids registered in giwa-io/dojang broadcast/RegisterAddressDojangAttester.s.sol
        // (checked 2026-09-29).
        ids = new bytes32[](4);
        ids[0] = 0x38d8cb51c229b3d73d4726e3c12bc280371c6eecea81939e3685e1f5b54c702b;
        ids[1] = 0x8c5b37d692bb30f1bf88ddb3478c84d86c7fb5778b789e8f4b79493cf9a7902e;
        ids[2] = 0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678;
        ids[3] = 0xd1d363b0d54eb2b25cea87dce463bdcf40dd33875a10849f4945ed2dabc14246;
    }

    function setUp() public {
        vm.skip(vm.envOr("DOJANG_FORK_ACCOUNT", address(0)) == address(0));
        vm.createSelectFork("giwa_sepolia");
    }

    // FR-2, FR-5: live configuration is followed and the verdict agrees with DojangScroll per id.
    function test_liveVerdict_matchesDojangScrollPerId() public view {
        address account = vm.envAddress("DOJANG_FORK_ACCOUNT");
        bytes32[] memory ids = _addressAttesterIds();
        bool anyVerified;
        for (uint256 i; i < ids.length; ++i) {
            bytes32[] memory single = new bytes32[](1);
            single[0] = ids[i];
            DojangAddressVerifier.Verdict memory verdict =
                DojangAddressVerifier.check(IDojangScroll(DOJANG_SCROLL), account, single);
            bool scroll = IDojangScrollIsVerified(DOJANG_SCROLL).isVerified(account, ids[i]);
            // DojangScroll additionally rejects expired records; the library defers that to validUntil.
            bool unexpired = verdict.validUntil == 0 || verdict.validUntil > block.timestamp;
            assertEq(verdict.verified && unexpired, scroll, "per-id parity with DojangScroll");
            anyVerified = anyVerified || scroll;
        }
        assertTrue(anyVerified, "DOJANG_FORK_ACCOUNT should be verified by at least one attester");
    }

    function test_liveVerdict_rejectsUnattestedAddress() public view {
        address nobody = address(uint160(uint256(keccak256("dojang-paymaster.no-attestation"))));
        assertFalse(DojangAddressVerifier.check(IDojangScroll(DOJANG_SCROLL), nobody, _addressAttesterIds()).verified);
    }
}
