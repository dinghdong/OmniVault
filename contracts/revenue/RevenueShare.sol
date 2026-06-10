// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RevenueShare — AI Agent Revenue Distribution
/// @notice Distributes ETH revenue from successful AI-audited investments to
///         the AI agents that contributed to the decision pipeline.
///
/// Revenue model:
///   - REVENUE_ADMIN_ROLE deposits ETH revenue (from project exits with profit)
///   - Each AI agent is registered with a weight (basis points, sum = 10 000)
///   - Any registered agent can claim their accrued share at any time
///
/// Gas model: O(1) per claim — no iteration. Uses "running total" pattern
///   (same as Sushi MasterChef / ERC-4626 reward accounting).
contract RevenueShare is AccessControl, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant REVENUE_ADMIN_ROLE = keccak256("REVENUE_ADMIN_ROLE");

    uint256 public constant WEIGHT_DENOM = 10_000;

    // ─── Agent Record ─────────────────────────────────────────────────────────
    struct Agent {
        string  agentDid;
        string  agentName;
        uint256 weightBps;
        address payable wallet;
        uint256 debtOffset;  // revenuePerWeight snapshot at last claim/register
        uint256 claimed;     // lifetime ETH claimed
    }

    // ─── Storage ──────────────────────────────────────────────────────────────
    mapping(uint256 => Agent) public agents;
    uint256 public agentCount;

    uint256 public revenuePerWeight;  // scaled by PRECISION
    uint256 public constant PRECISION = 1e18;

    uint256 public totalWeight;
    uint256 public totalDeposited;
    uint256 public totalClaimed;

    // ─── Events ──────────────────────────────────────────────────────────────
    event AgentRegistered(uint256 indexed agentId, string agentDid, uint256 weightBps, address wallet);
    event AgentWeightUpdated(uint256 indexed agentId, uint256 oldWeight, uint256 newWeight);
    event RevenueDeposited(uint256 amount, uint256 newRevenuePerWeight);
    event RevenueClaimed(uint256 indexed agentId, address indexed wallet, uint256 amount);

    // ─── Errors ──────────────────────────────────────────────────────────────
    error ZeroAmount();
    error InvalidWeight();
    error WeightExceedsMax();
    error AgentNotFound();
    error NothingToClaim();
    error TransferFailed();
    error ZeroAddress();

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REVENUE_ADMIN_ROLE, msg.sender);
    }

    // ─── Agent Management ─────────────────────────────────────────────────────
    function registerAgent(
        string  calldata agentDid,
        string  calldata agentName,
        uint256 weightBps,
        address payable wallet
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 agentId) {
        if (weightBps == 0) revert InvalidWeight();
        if (wallet == address(0)) revert ZeroAddress();
        if (totalWeight + weightBps > WEIGHT_DENOM) revert WeightExceedsMax();

        agentId = ++agentCount;
        agents[agentId] = Agent({
            agentDid:   agentDid,
            agentName:  agentName,
            weightBps:  weightBps,
            wallet:     wallet,
            debtOffset: revenuePerWeight,
            claimed:    0
        });
        totalWeight += weightBps;
        emit AgentRegistered(agentId, agentDid, weightBps, wallet);
    }

    function updateWeight(uint256 agentId, uint256 newWeightBps)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Agent storage a = agents[agentId];
        if (a.wallet == address(0)) revert AgentNotFound();
        if (newWeightBps == 0) revert InvalidWeight();

        uint256 oldWeight = a.weightBps;
        totalWeight = totalWeight - oldWeight + newWeightBps;
        if (totalWeight > WEIGHT_DENOM) revert WeightExceedsMax();

        // Snapshot pending before weight change
        a.debtOffset  = revenuePerWeight;
        a.weightBps   = newWeightBps;
        emit AgentWeightUpdated(agentId, oldWeight, newWeightBps);
    }

    // ─── Revenue Deposit ──────────────────────────────────────────────────────
    function depositRevenue() external payable {
        uint256 amount = msg.value;
        if (amount == 0) revert ZeroAmount();
        if (totalWeight == 0) revert InvalidWeight();

        uint256 increment = (amount * PRECISION) / totalWeight;
        revenuePerWeight += increment;
        totalDeposited   += amount;

        emit RevenueDeposited(amount, revenuePerWeight);
    }

    // ─── Claim ────────────────────────────────────────────────────────────────
    function claim(uint256 agentId) external nonReentrant {
        Agent storage a = agents[agentId];
        if (a.wallet == address(0)) revert AgentNotFound();

        uint256 pending = _pendingFor(a);
        if (pending == 0) revert NothingToClaim();

        a.debtOffset = revenuePerWeight;
        a.claimed   += pending;
        totalClaimed += pending;

        (bool ok, ) = a.wallet.call{value: pending}("");
        if (!ok) revert TransferFailed();

        emit RevenueClaimed(agentId, a.wallet, pending);
    }

    // ─── View Helpers ─────────────────────────────────────────────────────────
    function pendingRevenue(uint256 agentId) external view returns (uint256) {
        Agent storage a = agents[agentId];
        if (a.wallet == address(0)) return 0;
        return _pendingFor(a);
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────
    function _pendingFor(Agent storage a) internal view returns (uint256) {
        if (revenuePerWeight <= a.debtOffset) return 0;
        uint256 delta = revenuePerWeight - a.debtOffset;
        return (delta * a.weightBps) / PRECISION;
    }

    receive() external payable {}
}
