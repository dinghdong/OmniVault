// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { FundToken } from "./FundToken.sol";

/// @title FundVault — ETH Vault with AAVE yield
/// @notice LP deposits ETH → wraps to WETH → supplies to AAVE V3.
///         FundToken uses rebasing model to track aWETH yield.
contract FundVault is AccessControl {
    using SafeERC20 for IERC20;

    // ─── Roles ───────────────────────────────────────────────────────────────
    bytes32 public constant INVESTOR_ROLE = keccak256("INVESTOR_ROLE"); // InvestmentManager

    // ─── Immutable References ─────────────────────────────────────────────────
    IERC20 public immutable WETH;
    FundToken public immutable fundToken;
    address public immutable AAVE_POOL;
    IERC20 public immutable aWETH;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Deposited(address indexed LP, uint256 assets, uint256 shares);
    event Redeemed(address indexed LP, uint256 shares, uint256 assets);
    event Invested(uint256 amount);
    event Divested(uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ZeroAmount();
    error AaveSupplyFailed();
    error AaveWithdrawFailed();
    error InsufficientBalance();

    constructor(
        address _weth,
        address _aavePool,
        address _aWeth,
        address _fundToken
    ) {
        WETH = IERC20(_weth);
        AAVE_POOL = _aavePool;
        aWETH = IERC20(_aWeth);
        fundToken = FundToken(_fundToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── ETH Reception ──────────────────────────────────────────────────────
    receive() external payable {
        // Convert incoming ETH to WETH
        IWETH(address(WETH)).deposit{value: msg.value}();
    }

    // ─── LP Deposit ──────────────────────────────────────────────────────────
    /// @notice LP deposits ETH → wraps to WETH → supplies to AAVE → mint FundToken shares
    /// @return shares minted to LP (scaled by current accrualFactor)
    function deposit() external payable returns (uint256 shares) {
        uint256 assets = msg.value;
        if (assets == 0) revert ZeroAmount();

        // 1. Wrap ETH to WETH
        IWETH(address(WETH)).deposit{value: assets}();

        // 2. Approve & supply to AAVE
        _approveAndSupply(assets);

        // 3. Compute shares: assets / nav (nav = accrualFactor, both 18dp)
        shares = assets * 1e18 / fundToken.accrualFactor();

        // 4. Mint shares
        fundToken.mint(msg.sender, shares);

        emit Deposited(msg.sender, assets, shares);
    }

    // ─── LP Redeem ───────────────────────────────────────────────────────────
    /// @notice LP burns shares → withdraw from AAVE → unwrap WETH → send ETH
    /// @param shares Shares to burn (18dp units)
    /// @return assets ETH returned
    function redeem(uint256 shares) external returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();

        // 1. Cap shares at totalSupply to prevent overflow
        uint256 total = fundToken.totalSupply();
        if (shares > total) shares = total;

        // 2. Compute assets at current accrualFactor
        assets = shares * fundToken.accrualFactor() / 1e18;

        // 3. Withdraw from AAVE (receives WETH)
        _withdrawFromAave(assets);

        // 4. Unwrap WETH to ETH
        IWETH(address(WETH)).withdraw(assets);

        // 5. Burn shares
        fundToken.burn(msg.sender, shares);

        // 6. Send ETH to LP
        (bool success, ) = msg.sender.call{value: assets}("");
        require(success, "ETH transfer failed");

        emit Redeemed(msg.sender, shares, assets);
    }

    // ─── Read Balance ────────────────────────────────────────────────────────
    /// @notice LP's real-time balance in ETH (after compounding)
    function balanceOf(address lp) external view returns (uint256) {
        return fundToken.balanceOf(lp);
    }

    // ─── Investment Operations ───────────────────────────────────────────────
    /// @notice Withdraw from AAVE and lock for project investment (sends WETH)
    function divestForInvestment(uint256 amount) external onlyRole(INVESTOR_ROLE) {
        _withdrawFromAave(amount);
        // Send WETH to InvestmentManager (caller handles unwrap)
        WETH.safeTransfer(msg.sender, amount);
        emit Invested(amount);
    }

    /// @notice Realized profit returned → compounds to accrualFactor
    /// @param proceeds Net gain in WETH terms (18dp)
    function addRealizedGains(uint256 proceeds, uint256 /* originalAmount */ )
        external
        onlyRole(INVESTOR_ROLE)
    {
        uint256 netGain = proceeds;

        uint256 currentShares = fundToken.totalSupply();
        if (netGain > 0 && currentShares > 0) {
            fundToken.applyYield(netGain, currentShares);
        }
    }

    /// @notice Realized loss → factor shrinks, all LP balances decrease
    /// @param recoveredAmount WETH recovered after loss
    /// @param originalAmount Original investment amount in WETH
    function addRealizedLoss(uint256 recoveredAmount, uint256 originalAmount)
        external
        onlyRole(INVESTOR_ROLE)
    {
        uint256 netLoss = originalAmount > recoveredAmount
            ? originalAmount - recoveredAmount
            : 0;

        uint256 currentShares = fundToken.totalSupply();
        if (netLoss > 0 && currentShares > 0) {
            fundToken.applyLoss(netLoss, currentShares);
        }
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────
    function _approveAndSupply(uint256 amount) internal {
        WETH.forceApprove(AAVE_POOL, amount);
        (bool success, ) = AAVE_POOL.call(
            abi.encodeWithSignature(
                "supply(address,uint256,address,uint16)",
                address(WETH),
                amount,
                address(this),
                0
            )
        );
        if (!success) revert AaveSupplyFailed();
    }

    function _withdrawFromAave(uint256 amount) internal {
        uint256 aaveBalance = aWETH.balanceOf(address(this));
        uint256 toWithdraw = amount <= aaveBalance ? amount : aaveBalance;
        if (toWithdraw == 0) revert InsufficientBalance();

        (bool success, ) = AAVE_POOL.call(
            abi.encodeWithSignature(
                "withdraw(address,uint256,address)",
                address(WETH),
                toWithdraw,
                address(this)
            )
        );
        if (!success) revert AaveWithdrawFailed();
    }
}

/// @title IWETH — WETH interface for deposit/withdraw
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
}
