// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title FundToken — Rebasing LP Share Token
/// @notice Similar to AAVE aToken, balanceOf() auto-compounds via accrualFactor.
///         shares[user] is fixed at deposit, accrualFactor grows with realized gains.
contract FundToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @notice 18-digit internal precision
    uint8 public constant DECIMALS = 18;

    /// @dev Global yield accumulator. Initial = 1e18 (1 share = 1 USDC at launch).
    uint256 public accrualFactor = 1e18;

    /// @dev User share ledger — fixed at deposit, only changes on mint/burn
    mapping(address => uint256) public shares;

    /// @dev Historical accrualFactor snapshots for off-chain indexing
    uint256[] public accrualFactorHistory;

    // ─── Events ───────────────────────────────────────────────────────────────
    event AccrualFactorUpdated(
        uint256 indexed newFactor,
        uint256 totalShares,
        uint256 totalAssets
    );

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor() ERC20("OmniVault Fund Token", "OVFT") {
        accrualFactorHistory.push(accrualFactor);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyMinter() {
        require(hasRole(MINTER_ROLE, msg.sender), "Not minter");
        _;
    }

    modifier onlyBurner() {
        require(hasRole(BURNER_ROLE, msg.sender), "Not burner");
        _;
    }

    // ─── Core: Rebasing Balance ──────────────────────────────────────────────
    /// @notice Real-time balance = shares × accrualFactor
    /// @dev Auto-compounds — no manual claim needed
    function balanceOf(address account) public view override returns (uint256) {
        return shares[account] * accrualFactor / 1e18;
    }

    /// @notice Raw shares (fixed at deposit, not accounting for yield)
    function getShares(address account) external view returns (uint256) {
        return shares[account];
    }

    /// @notice Cumulative yield multiplier (for UI display)
    /// @return factor / 1e18, e.g. 1.05 = 5% total return
    function cumulativeYield() external view returns (uint256) {
        return accrualFactor;
    }

    // ─── Mint / Burn ─────────────────────────────────────────────────────────
    /// @notice Mint new shares to a recipient (called by FundVault on deposit)
    function mint(address to, uint256 sharesAmount) external onlyMinter {
        shares[to] += sharesAmount;
        _mint(to, sharesAmount);
        emit Transfer(address(0), to, sharesAmount);
    }

    /// @notice Burn shares from a holder (called by FundVault on redeem)
    function burn(address from, uint256 sharesAmount) external onlyBurner {
        shares[from] -= sharesAmount;
        _burn(from, sharesAmount);
        emit Transfer(from, address(0), sharesAmount);
    }

    // ─── ERC20 Transfer (rebasing-aware) ─────────────────────────────────────
    /// @dev Transfer amount expressed in "balance units" (after compounding).
    ///      Internally converts to shares for the ERC20 ledger.
    function transfer(address to, uint256 amount)
        public override returns (bool)
    {
        uint256 sharesToTransfer = amount * 1e18 / accrualFactor;
        return super.transfer(to, sharesToTransfer);
    }

    function transferFrom(address from, address to, uint256 amount)
        public override returns (bool)
    {
        uint256 sharesToTransfer = amount * 1e18 / accrualFactor;
        return super.transferFrom(from, to, sharesToTransfer);
    }

    // ─── Yield / Loss Application ─────────────────────────────────────────────
    /// @notice Apply realized profit → factor grows → all balances auto-increase
    /// @param yield  Net profit in 18-decimal units
    /// @param totalShares  Current total shares outstanding
    /// @dev newFactor = oldFactor × (assets + yield) / assets
    function applyYield(uint256 yield, uint256 totalShares) external onlyMinter {
        if (totalShares == 0 || yield == 0) return;

        uint256 oldFactor = accrualFactor;
        uint256 totalAssets = oldFactor * totalShares / 1e18;
        uint256 newFactor = oldFactor * (totalAssets + yield) / totalAssets;

        accrualFactor = newFactor;
        accrualFactorHistory.push(newFactor);

        emit AccrualFactorUpdated(newFactor, totalShares, totalAssets + yield);
    }

    /// @notice Apply realized loss → factor shrinks → all balances auto-decrease
    /// @param loss  Net loss in 18-decimal units
    /// @param totalShares  Current total shares outstanding
    /// @dev newFactor = oldFactor × max(assets - loss, 0) / assets
    function applyLoss(uint256 loss, uint256 totalShares) external onlyMinter {
        if (totalShares == 0 || loss == 0) return;

        uint256 oldFactor = accrualFactor;
        uint256 totalAssets = oldFactor * totalShares / 1e18;

        uint256 newAssets = totalAssets > loss ? totalAssets - loss : 0;
        uint256 newFactor = oldFactor * newAssets / totalAssets;

        accrualFactor = newFactor;
        accrualFactorHistory.push(newFactor);

        emit AccrualFactorUpdated(newFactor, totalShares, newAssets);
    }
}
