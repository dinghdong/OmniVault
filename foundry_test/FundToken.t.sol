// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../contracts/vault/FundToken.sol";

contract FundTokenTest is Test {
    FundToken public fundToken;
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    function setUp() public {
        fundToken = new FundToken();

        // Grant MINTER/BURNER to this test contract for setup
        fundToken.grantRole(fundToken.MINTER_ROLE(), address(this));
        fundToken.grantRole(fundToken.BURNER_ROLE(), address(this));
    }

    // ─── Mint / Shares ───────────────────────────────────────────────────────
    function test_mint_mintsShares() public {
        fundToken.mint(alice, 1000e18);

        assertEq(fundToken.shares(alice), 1000e18);
        assertEq(fundToken.totalSupply(), 1000e18);
        assertEq(fundToken.balanceOf(alice), 1000e18); // factor = 1e18 at start
    }

    function test_balanceOf_reflectsAccrualFactor() public {
        fundToken.mint(alice, 1000e18);

        // Simulate 5% yield: applyYield
        // totalAssets = 1000 * 1e18 = 1000e18
        // yield = 50e18
        fundToken.applyYield(50e18, 1000e18);

        // factor = 1e18 * (1000 + 50) / 1000 = 1.05e18
        // balanceOf = 1000 * 1.05 = 1050e18
        assertEq(fundToken.balanceOf(alice), 1050e18);
        assertEq(fundToken.cumulativeYield(), 1.05e18);
    }

    function test_applyLoss_shrinksBalance() public {
        fundToken.mint(alice, 1000e18);

        // Simulate 20% loss: applyLoss
        // totalAssets = 1000e18
        // loss = 200e18
        fundToken.applyLoss(200e18, 1000e18);

        // factor = 1e18 * (1000 - 200) / 1000 = 0.8e18
        // balanceOf = 1000 * 0.8 = 800e18
        assertEq(fundToken.balanceOf(alice), 800e18);
    }

    function test_applyLoss_fullLoss_closesToZero() public {
        fundToken.mint(alice, 1000e18);

        // Lose everything
        fundToken.applyLoss(1000e18, 1000e18);

        assertEq(fundToken.balanceOf(alice), 0);
    }

    function test_burn_reducesShares() public {
        fundToken.mint(alice, 1000e18);
        fundToken.burn(alice, 400e18);

        assertEq(fundToken.shares(alice), 600e18);
        assertEq(fundToken.totalSupply(), 600e18);
    }

    function test_transfer_convertsBalanceToShares() public {
        fundToken.mint(alice, 1000e18);
        fundToken.applyYield(100e18, 1000e18); // factor = 1.1e18

        // alice transfers 110e18 (balance) to bob
        // sharesToTransfer = 110e18 * 1e18 / 1.1e18 = 100e18
        vm.prank(alice);
        fundToken.transfer(bob, 110e18);

        // bob should have received 100 shares
        // bob balance = 100 * 1.1 = 110e18
        assertEq(fundToken.shares(bob), 100e18);
        assertEq(fundToken.balanceOf(bob), 110e18);

        // alice's balance deducted
        assertEq(fundToken.balanceOf(alice), 990e18); // 1000 - 110 = 890? 
        // Wait: alice balance was 1000 * 1.1 = 1100e18
        // She transferred 110e18 balance = 100 shares
        // Remaining shares: 900
        // Remaining balance: 900 * 1.1 = 990e18 ✓
    }

    // ─── Access Control ──────────────────────────────────────────────────────
    function test_onlyMinter_canMint() public {
        vm.prank(alice);
        vm.expectRevert("Not minter");
        fundToken.mint(alice, 1000e18);
    }

    function test_onlyBurner_canBurn() public {
        fundToken.mint(alice, 1000e18);

        vm.prank(alice);
        vm.expectRevert("Not burner");
        fundToken.burn(alice, 100e18);
    }

    // ─── Edge Cases ─────────────────────────────────────────────────────────
    function test_applyYield_zeroTotalShares() public {
        fundToken.applyYield(100e18, 0); // should not revert
        assertEq(fundToken.accrualFactor(), 1e18); // unchanged
    }

    function test_applyLoss_zeroLoss() public {
        fundToken.applyLoss(0, 1000e18); // should not revert
        assertEq(fundToken.accrualFactor(), 1e18); // unchanged
    }
}
