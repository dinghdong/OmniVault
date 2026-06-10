// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { FundToken } from "./FundToken.sol";

/// @title FundVault — ETH Vault for AI-Agent-Driven VC Fund
/// @notice LPs deposit ETH directly (no AAVE yield).
///         Returns come from AI-audited project investments managed by InvestmentManager.
///         FundToken tracks LP ownership via shares (rebasing model).
contract FundVault is AccessControl {
    // ─── Roles ───────────────────────────────────────────────────────────────
    bytes32 public constant INVESTOR_ROLE = keccak256("INVESTOR_ROLE"); // InvestmentManager

    // ─── Immutable References ─────────────────────────────────────────────────
    FundToken public immutable fundToken;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Deposited(address indexed lp, uint256 assets, uint256 shares);
    event Redeemed(address indexed lp, uint256 shares, uint256 assets);
    event Invested(address indexed project, uint256 amount);
    event GainRecorded(uint256 netGain);
    event LossRecorded(uint256 netLoss);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ZeroAmount();
    error InsufficientVaultBalance();
    error ETHTransferFailed();

    constructor(address _fundToken) {
        fundToken = FundToken(_fundToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── ETH Reception ──────────────────────────────────────────────────────
    receive() external payable {}

    // ─── LP Deposit ──────────────────────────────────────────────────────────
    /// @notice LP deposits ETH → mint FundToken shares
    /// @return shares Minted to LP (adjusted for current accrualFactor)
    function deposit() external payable returns (uint256 shares) {
        uint256 assets = msg.value;
        if (assets == 0) revert ZeroAmount();

        // shares = assets / nav  (nav = accrualFactor in 1e18 units)
        shares = assets * 1e18 / fundToken.accrualFactor();

        fundToken.mint(msg.sender, shares);
        emit Deposited(msg.sender, assets, shares);
    }

    // ─── LP Redeem ───────────────────────────────────────────────────────────
    /// @notice LP burns shares → receive proportional ETH from vault
    /// @param shares Shares to burn (18dp units — use getShares() not balanceOf())
    /// @return assets ETH returned to LP
    function redeem(uint256 shares) external returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();

        // Cap to total supply to prevent arithmetic issues
        uint256 total = fundToken.totalSupply();
        if (shares > total) shares = total;

        // assets = shares × accrualFactor / 1e18
        assets = shares * fundToken.accrualFactor() / 1e18;

        if (address(this).balance < assets) revert InsufficientVaultBalance();

        fundToken.burn(msg.sender, shares);

        (bool ok, ) = msg.sender.call{value: assets}("");
        if (!ok) revert ETHTransferFailed();

        emit Redeemed(msg.sender, shares, assets);
    }

    // ─── View Helpers ─────────────────────────────────────────────────────────
    /// @notice LP's current ETH-denominated balance
    function balanceOf(address lp) external view returns (uint256) {
        return fundToken.balanceOf(lp);
    }

    /// @notice ETH held in the vault
    function vaultBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─── Investment Operations (InvestmentManager only) ───────────────────────
    /// @notice Send ETH to InvestmentManager for project funding
    function divestForInvestment(uint256 amount) external onlyRole(INVESTOR_ROLE) {
        if (address(this).balance < amount) revert InsufficientVaultBalance();

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();

        emit Invested(msg.sender, amount);
    }

    /// @notice Record investment gain → compounds accrualFactor, raising all LP balances
    /// @param netGain Gain in ETH (returned with proceeds)
    function addRealizedGains(uint256 netGain, uint256 /* originalAmount */ )
        external
        payable
        onlyRole(INVESTOR_ROLE)
    {
        uint256 currentShares = fundToken.totalSupply();
        if (netGain > 0 && currentShares > 0) {
            fundToken.applyYield(netGain, currentShares);
        }
        emit GainRecorded(netGain);
    }

    /// @notice Record investment loss → shrinks accrualFactor, reducing all LP balances
    /// @param recoveredAmount ETH recovered (returned with call)
    /// @param originalAmount Original ETH invested
    function addRealizedLoss(uint256 recoveredAmount, uint256 originalAmount)
        external
        payable
        onlyRole(INVESTOR_ROLE)
    {
        uint256 netLoss = originalAmount > recoveredAmount
            ? originalAmount - recoveredAmount
            : 0;

        uint256 currentShares = fundToken.totalSupply();
        if (netLoss > 0 && currentShares > 0) {
            fundToken.applyLoss(netLoss, currentShares);
        }
        emit LossRecorded(netLoss);
    }
}
