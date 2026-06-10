// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IFundVault } from "../interfaces/IFundVault.sol";

/// @dev OmniOracle interface — stores 3-dimensional AI audit scores
interface IOmniOracle {
    function requestAudit(
        uint256 projectId,
        string  calldata sourceCodeHash,
        string  calldata bizApi
    ) external returns (bytes32 requestId);

    /// @notice Returns raw score sentinel after Chainlink callback.
    ///         0 = not yet fulfilled; type(uint256).max = callback failed; else finalScore+1 (0-101)
    function fulfilledScore(uint256 projectId) external view returns (uint256);

    /// @notice Returns the 3D breakdown scores: reliability, quality, marketFit (0-100 each)
    function fulfilledScores(uint256 projectId)
        external view
        returns (uint8 reliability, uint8 quality, uint8 marketFit);

    /// @notice Returns the SHA-256 content hash stored by the Chainlink callback
    function fulfilledHash(uint256 projectId) external view returns (bytes32);
}

/// @title InvestmentManager — AI-Agent-Driven VC Fund Investment Pipeline
/// @notice AI agents (not human analysts) submit projects for multi-dimensional scoring.
///
/// Audit flow:
///   1. submitProject() — AI agent submits via agentDid + agentRepo
///   2. OmniOracle triggers Chainlink DON → 0G Compute A2A audit
///   3. settleAudit() — reads 3D scores from oracle, queues if approved
///   4. executeInvestment() — permissionless after EXECUTION_DELAY timelock
///
/// 3D Score model (via Stylus ScoringEngine, 40/30/30 weights):
///   reliability 40% — agent uptime, latency, error rate
///   quality     30% — code / output quality
///   marketFit   30% — business / market-fit signal
contract InvestmentManager is AccessControl, ReentrancyGuard {
    // ─── Roles ───────────────────────────────────────────────────────────────
    bytes32 public constant AI_ORACLE_ROLE  = keccak256("AI_ORACLE_ROLE");
    bytes32 public constant RISK_AGENT_ROLE = keccak256("RISK_AGENT_ROLE");

    // ─── Project Status ──────────────────────────────────────────────────────
    enum ProjectStatus {
        None,              // 0
        Pending,           // 1  (unused — submitProject goes straight to Auditing)
        Auditing,          // 2  waiting for oracle
        PendingExecution,  // 3  AI approved; waiting for timelock
        Rejected,          // 4  score below threshold or audit failed
        Active,            // 5  investment executed, vesting live
        CircuitBroken,     // 6  emergency halt
        Exited,            // 7  project returned capital
        WriteOff,          // 8  total loss
        Vetoed             // 9  blocked during timelock
    }

    // ─── Project Data ────────────────────────────────────────────────────────
    struct Project {
        // Identity
        address applicant;       // AI agent's address or project owner
        bytes32 commitHash;      // keccak256 of pitch/source
        address contractAddr;    // project's contract or wallet
        string  bizApi;          // business context for AI prompt
        // AI Agent metadata
        string  agentDid;        // decentralized identifier of the submitting agent
        string  agentRepo;       // git repo / IPFS CID of agent code
        string  agentApiEndpoint; // REST/gRPC endpoint for A2A calls
        // Packed timing + status slot
        ProjectStatus status;
        uint8  auditScore;       // final weighted score 0-100
        uint8  reliabilityScore; // dimension 1: reliability
        uint8  qualityScore;     // dimension 2: code/output quality
        uint8  marketFitScore;   // dimension 3: market fit
        uint40 submittedAt;
        uint40 auditedAt;
        uint40 investedAt;
        uint40 executionUnlocksAt;
        uint40 exitedAt;
        // Values
        uint256 requestedAmount;
        bytes32 auditContentHash;
        uint256 investmentAmount;
        uint256 releasedAmount;
        uint256 exitProceeds;
    }

    // ─── Storage ────────────────────────────────────────────────────────────
    mapping(uint256 => Project) public projects;
    uint256 public projectCount;
    mapping(uint256 => bytes)   public vestingSchedules;

    IFundVault  public immutable fundVault;
    IOmniOracle public oracle;          // settable post-deploy

    // ─── Parameters ─────────────────────────────────────────────────────────
    uint256 public scoreThreshold;
    uint256 public constant EXECUTION_DELAY  = 3 minutes;  // demo; prod = 72h
    uint256 public constant UPFRONT_BPS      = 2000;       // 20% upfront
    uint256 public constant VESTING_DURATION = 52 weeks;

    // ─── Events ─────────────────────────────────────────────────────────────
    event ProjectSubmitted(
        uint256 indexed projectId,
        address indexed applicant,
        bytes32 commitHash,
        address contractAddr,
        uint256 requestedAmount,
        string  agentDid
    );
    event AuditRequested(uint256 indexed projectId, bytes32 chainlinkRequestId);
    event AuditCompleted(
        uint256 indexed projectId,
        uint8 finalScore,
        uint8 reliability,
        uint8 quality,
        uint8 marketFit,
        bytes32 contentHash
    );
    event AuditFailed(uint256 indexed projectId);
    event ExecutionQueued(uint256 indexed projectId, uint256 unlocksAt, uint8 score);
    event ExecutionVetoed(uint256 indexed projectId, address indexed vetoer);
    event InvestmentExecuted(uint256 indexed projectId, uint256 amount, uint256 upfront);
    event PayoutClaimed(uint256 indexed projectId, uint256 amount);
    event CircuitBroken(uint256 indexed projectId);
    event ProjectExited(uint256 indexed projectId, uint256 proceeds, bool isProfit);
    event ProjectWriteOff(uint256 indexed projectId, uint256 originalAmount);
    event ScoreThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error InvalidStatus();
    error ZeroAmount();
    error TransferFailed();
    error TimelockActive();
    error TimelockExpired();
    error OracleNotSet();
    error InvalidThreshold();
    error NotLP();
    error AmountExceedsRequested();

    // ─── Constructor ────────────────────────────────────────────────────────
    constructor(address _fundVault, uint256 _scoreThreshold) {
        fundVault      = IFundVault(_fundVault);
        scoreThreshold = _scoreThreshold == 0 ? 60 : _scoreThreshold;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Admin ──────────────────────────────────────────────────────────────
    function setOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        oracle = IOmniOracle(_oracle);
    }

    function setScoreThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newThreshold > 100) revert InvalidThreshold();
        emit ScoreThresholdUpdated(scoreThreshold, newThreshold);
        scoreThreshold = newThreshold;
    }

    receive() external payable {}

    // ─── Project Submission ─────────────────────────────────────────────────
    /// @notice Submit an AI agent project for audit.
    /// @param commitHash       keccak256 of pitch/source code
    /// @param contractAddr     project's contract or wallet address
    /// @param bizApi           business context URL for AI prompt
    /// @param requestedAmount  ETH (in wei) requested
    /// @param agentDid         decentralized identifier of the AI agent
    /// @param agentRepo        git / IPFS repo of agent code
    /// @param agentApiEndpoint REST/gRPC endpoint exposed by the agent
    function submitProject(
        bytes32 commitHash,
        address contractAddr,
        string  calldata bizApi,
        uint256 requestedAmount,
        string  calldata agentDid,
        string  calldata agentRepo,
        string  calldata agentApiEndpoint
    ) external returns (uint256 projectId) {
        if (commitHash == bytes32(0) || contractAddr == address(0)) revert ZeroAmount();
        if (address(oracle) == address(0)) revert OracleNotSet();

        projectId = ++projectCount;
        Project storage p = projects[projectId];
        p.applicant        = msg.sender;
        p.commitHash       = commitHash;
        p.contractAddr     = contractAddr;
        p.bizApi           = bizApi;
        p.requestedAmount  = requestedAmount;
        p.agentDid         = agentDid;
        p.agentRepo        = agentRepo;
        p.agentApiEndpoint = agentApiEndpoint;
        p.status           = ProjectStatus.Auditing;
        p.submittedAt      = uint40(block.timestamp);

        emit ProjectSubmitted(
            projectId, msg.sender, commitHash, contractAddr, requestedAmount, agentDid
        );

        bytes32 clRequestId = oracle.requestAudit(
            projectId,
            _bytes32ToHex(commitHash),
            bizApi
        );
        emit AuditRequested(projectId, clRequestId);
    }

    // ─── Settle Audit ───────────────────────────────────────────────────────
    /// @notice Permissionless finalizer — reads oracle and transitions status.
    function settleAudit(uint256 projectId) external {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Auditing) revert InvalidStatus();
        if (address(oracle) == address(0)) revert OracleNotSet();

        uint256 raw = oracle.fulfilledScore(projectId);
        if (raw == 0) revert("Audit not yet fulfilled");

        if (raw == type(uint256).max) {
            p.status = ProjectStatus.Rejected;
            emit AuditFailed(projectId);
            return;
        }

        uint256 finalScore = raw - 1; // undo +1 sentinel
        bytes32 hash       = oracle.fulfilledHash(projectId);

        // Read 3D breakdown scores
        (uint8 rel, uint8 qual, uint8 mkt) = oracle.fulfilledScores(projectId);

        p.auditScore       = uint8(finalScore > 100 ? 100 : finalScore);
        p.reliabilityScore = rel;
        p.qualityScore     = qual;
        p.marketFitScore   = mkt;
        p.auditContentHash = hash;
        p.auditedAt        = uint40(block.timestamp);

        emit AuditCompleted(projectId, p.auditScore, rel, qual, mkt, hash);

        if (finalScore >= scoreThreshold) {
            p.status             = ProjectStatus.PendingExecution;
            p.executionUnlocksAt = uint40(block.timestamp + EXECUTION_DELAY);
            emit ExecutionQueued(projectId, uint256(p.executionUnlocksAt), p.auditScore);
        } else {
            p.status = ProjectStatus.Rejected;
        }
    }

    // ─── Veto ───────────────────────────────────────────────────────────────
    /// @notice Any LP may veto within the execution timelock window.
    function veto(uint256 projectId) external {
        if (fundVault.balanceOf(msg.sender) == 0) revert NotLP();
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.PendingExecution) revert InvalidStatus();
        if (block.timestamp >= uint256(p.executionUnlocksAt)) revert TimelockExpired();
        p.status = ProjectStatus.Vetoed;
        emit ExecutionVetoed(projectId, msg.sender);
    }

    // ─── Execute Investment ──────────────────────────────────────────────────
    /// @notice Permissionless after timelock. Vault sends ETH directly (no WETH needed).
    ///         Amount is capped to the project's requestedAmount (audited scope).
    function executeInvestment(
        uint256 projectId,
        uint256 amount,
        bytes   calldata vestingSchedule
    ) external nonReentrant {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.PendingExecution) revert InvalidStatus();
        if (block.timestamp < uint256(p.executionUnlocksAt)) revert TimelockActive();
        if (amount == 0) revert ZeroAmount();
        if (amount > p.requestedAmount) revert AmountExceedsRequested();

        uint256 upfront = amount * UPFRONT_BPS / 10_000;

        // Effects before interactions (CEI): status leaves PendingExecution
        // before any external call, closing the reentrancy window.
        p.investmentAmount = amount;
        p.releasedAmount   = upfront;
        p.investedAt       = uint40(block.timestamp);
        p.status           = ProjectStatus.Active;
        vestingSchedules[projectId] = vestingSchedule;

        // Vault sends ETH directly to InvestmentManager (no WETH unwrap needed)
        fundVault.divestForInvestment(amount);

        (bool ok, ) = p.applicant.call{value: upfront}("");
        if (!ok) revert TransferFailed();

        emit InvestmentExecuted(projectId, amount, upfront);
    }

    // ─── Vesting Payout ─────────────────────────────────────────────────────
    /// @notice Vesting claims are frozen while a project is CircuitBroken —
    ///         funds only leave via admin exit / write-off paths.
    function claimPayout(uint256 projectId) external nonReentrant {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active) revert InvalidStatus();

        uint256 claimable = getClaimableAmount(projectId);
        if (claimable == 0) revert ZeroAmount();

        p.releasedAmount += claimable;
        (bool ok, ) = p.applicant.call{value: claimable}("");
        if (!ok) revert TransferFailed();

        emit PayoutClaimed(projectId, claimable);
    }

    function getClaimableAmount(uint256 projectId) public view returns (uint256) {
        Project memory p = projects[projectId];
        if (p.status != ProjectStatus.Active) return 0;
        if (p.investedAt == 0) return 0;

        uint256 total      = p.investmentAmount;
        uint256 upfront    = total * UPFRONT_BPS / 10_000;
        uint256 linearPart = total - upfront;
        uint256 elapsed    = block.timestamp - uint256(p.investedAt);
        uint256 linearVested = elapsed >= VESTING_DURATION
            ? linearPart
            : linearPart * elapsed / VESTING_DURATION;
        uint256 totalVested = upfront + linearVested;
        return totalVested > p.releasedAmount ? totalVested - p.releasedAmount : 0;
    }

    // ─── Circuit Break ───────────────────────────────────────────────────────
    function triggerCircuitBreak(uint256 projectId) external onlyRole(RISK_AGENT_ROLE) {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.Auditing)
            revert InvalidStatus();
        p.status = ProjectStatus.CircuitBroken;
        emit CircuitBroken(projectId);
    }

    // ─── Exit & Write-Off ────────────────────────────────────────────────────
    function markExit(uint256 projectId, uint256 exitProceeds)
        external payable onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();

        p.status       = ProjectStatus.Exited;
        p.exitedAt     = uint40(block.timestamp);
        p.exitProceeds = exitProceeds;

        bool isProfit = exitProceeds >= p.investmentAmount;
        if (isProfit && msg.value > 0) {
            // Return ETH gains to vault
            (bool ok, ) = address(fundVault).call{value: msg.value}("");
            require(ok, "ETH transfer failed");
            fundVault.addRealizedGains(msg.value, p.investmentAmount);
        } else {
            fundVault.addRealizedLoss(exitProceeds, p.investmentAmount);
        }
        emit ProjectExited(projectId, exitProceeds, isProfit);
    }

    function simulateExit(uint256 projectId, uint256 simulatedReturnBps)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();

        uint256 invested = p.investmentAmount;
        uint256 proceeds = invested * simulatedReturnBps / 10_000;
        p.status       = ProjectStatus.Exited;
        p.exitedAt     = uint40(block.timestamp);
        p.exitProceeds = proceeds;

        bool isProfit = proceeds >= invested;
        if (isProfit) {
            fundVault.addRealizedGains(proceeds - invested, invested);
        } else {
            fundVault.addRealizedLoss(proceeds, invested);
        }
        emit ProjectExited(projectId, proceeds, isProfit);
    }

    function markWriteOff(uint256 projectId) external onlyRole(RISK_AGENT_ROLE) {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();
        p.status   = ProjectStatus.WriteOff;
        p.exitedAt = uint40(block.timestamp);
        fundVault.addRealizedLoss(0, p.investmentAmount);
        emit ProjectWriteOff(projectId, p.investmentAmount);
    }

    // ─── View Helpers ────────────────────────────────────────────────────────
    function vestingProgress(uint256 projectId)
        external view
        returns (uint256 vestedBps, uint256 claimable, uint256 released, uint256 total)
    {
        Project memory p = projects[projectId];
        total     = p.investmentAmount;
        released  = p.releasedAmount;
        claimable = getClaimableAmount(projectId);
        if (total == 0 || p.investedAt == 0) return (0, 0, released, total);
        uint256 elapsed    = block.timestamp - uint256(p.investedAt);
        uint256 elapsedBps = elapsed >= VESTING_DURATION ? 10_000 : elapsed * 10_000 / VESTING_DURATION;
        vestedBps = UPFRONT_BPS + (10_000 - UPFRONT_BPS) * elapsedBps / 10_000;
    }

    /// @notice Get full 3D audit scores for a project
    function getAuditScores(uint256 projectId)
        external view
        returns (uint8 finalScore, uint8 reliability, uint8 quality, uint8 marketFit)
    {
        Project memory p = projects[projectId];
        return (p.auditScore, p.reliabilityScore, p.qualityScore, p.marketFitScore);
    }

    // ─── Private Helpers ─────────────────────────────────────────────────────
    function _bytes32ToHex(bytes32 b) internal pure returns (string memory) {
        bytes memory hex_ = new bytes(66);
        hex_[0] = "0"; hex_[1] = "x";
        bytes memory alphabet = "0123456789abcdef";
        for (uint256 i = 0; i < 32; i++) {
            hex_[2 + i * 2]     = alphabet[uint8(b[i] >> 4)];
            hex_[2 + i * 2 + 1] = alphabet[uint8(b[i] & 0x0f)];
        }
        return string(hex_);
    }
}
