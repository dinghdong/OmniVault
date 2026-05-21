// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IWETH } from "../interfaces/IWETH.sol";
import { IFundVault } from "../interfaces/IFundVault.sol";

/// @dev Minimal interface to OmniOracle (Chainlink Functions client)
interface IOmniOracle {
    function requestAudit(
        uint256 projectId,
        string  calldata sourceCodeHash,
        string  calldata bizApi
    ) external returns (bytes32 requestId);

    /// @notice Returns score+1 after Chainlink callback completes.
    ///         0 = not yet fulfilled; type(uint256).max = callback failed; else score+1 (0-101)
    function fulfilledScore(uint256 projectId) external view returns (uint256);

    /// @notice Returns the SHA-256 content hash stored by the Chainlink callback.
    function fulfilledHash(uint256 projectId) external view returns (bytes32);
}

/// @title InvestmentManager — Project application, AI audit via Chainlink Functions, and payout
/// @notice v2: Chainlink Functions triggers 0G Compute AI audit — no separate AI service required.
///
/// Audit flow:
///   1. submitProject() → sets status Auditing → calls OmniOracle.requestAudit()
///   2. Chainlink DON executes audit-source.js (calls 0G Compute × 3 rounds)
///   3. fulfillAudit() callback → if score ≥ threshold → PendingExecution (timelock)
///   4. After timelock, anyone calls executeInvestment() → funds flow with vesting
///
/// Veto window: RISK_AGENT role can veto during the 72h timelock.
/// Vesting model: 20% upfront at execution, 80% linear over 52 weeks.
contract InvestmentManager is AccessControl {
    // ─── Roles ───────────────────────────────────────────────────────────────
    bytes32 public constant AI_ORACLE_ROLE  = keccak256("AI_ORACLE_ROLE");
    bytes32 public constant RISK_AGENT_ROLE = keccak256("RISK_AGENT_ROLE");

    // ─── Project Status ──────────────────────────────────────────────────────
    enum ProjectStatus {
        None,              // 0
        Pending,           // 1
        Auditing,          // 2  waiting for Chainlink DON / 0G Compute
        PendingExecution,  // 3  AI approved; waiting for timelock
        Rejected,          // 4  score below threshold or audit failed
        Active,            // 5  investment executed
        CircuitBroken,     // 6  emergency halt
        Exited,            // 7  project returned capital
        WriteOff,          // 8  total loss
        Vetoed             // 9  blocked during timelock window
    }

    // ─── Project Data ────────────────────────────────────────────────────────
    //
    // Storage layout (slots relative to mapping base for a given projectId):
    //   slot 0 : applicant (address, 20 bytes)
    //   slot 1 : commitHash (bytes32)
    //   slot 2 : contractAddr (address, 20 bytes)
    //   slot 3 : bizApi (string length; data at keccak256(slot3))
    //   slot 4 : status(uint8) | auditScore(uint8) | submittedAt(uint40)
    //            | auditedAt(uint40) | investedAt(uint40)
    //            | executionUnlocksAt(uint40) | exitedAt(uint40)  [27 bytes total, 1 SSTORE]
    //   slot 5 : requestedAmount (uint256)
    //   slot 6 : auditContentHash (bytes32)
    //   slot 7 : investmentAmount (uint256)
    //   slot 8 : releasedAmount (uint256)
    //   slot 9 : exitProceeds (uint256)
    //
    // Packing slot 4 means fulfillAudit() writes status+auditScore+auditedAt+executionUnlocksAt
    // all into ONE already-warm slot → only ~12k gas vs ~66k gas for four cold SSTOREs.
    struct Project {
        // ── identity (slots 0-3) ───────────────────────────────────────────
        address applicant;
        bytes32 commitHash;
        address contractAddr;
        string  bizApi;
        // ── packed slot 4 (27 / 32 bytes) ─────────────────────────────────
        ProjectStatus status;           // uint8  — 1 byte
        uint8         auditScore;       // 0-100  — 1 byte
        uint40        submittedAt;      // unix timestamp — 5 bytes
        uint40        auditedAt;        // unix timestamp — 5 bytes
        uint40        investedAt;       // unix timestamp — 5 bytes
        uint40        executionUnlocksAt; // unix timestamp — 5 bytes
        uint40        exitedAt;         // unix timestamp — 5 bytes
        // ── large value slots (5-9) ────────────────────────────────────────
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

    IFundVault   public immutable fundVault;
    IWETH        public immutable WETH;
    IOmniOracle  public oracle;            // Chainlink Functions oracle (settable post-deploy)

    // ─── Parameters ─────────────────────────────────────────────────────────
    uint256 public scoreThreshold;
    uint256 public constant EXECUTION_DELAY  = 3 minutes;  // demo: 3 min; prod: 72h
    uint256 public constant UPFRONT_BPS      = 2000;        // 20% upfront
    uint256 public constant VESTING_DURATION = 52 weeks;

    // ─── Events ─────────────────────────────────────────────────────────────
    event ProjectSubmitted(
        uint256 indexed projectId,
        address indexed applicant,
        bytes32 commitHash,
        address contractAddr,
        uint256 requestedAmount
    );
    event AuditRequested(
        uint256 indexed projectId,
        bytes32 chainlinkRequestId
    );
    event AuditCompleted(
        uint256 indexed projectId,
        uint256 score,
        bytes32 contentHash
    );
    event AuditFailed(uint256 indexed projectId);
    event ExecutionQueued(uint256 indexed projectId, uint256 unlocksAt, uint256 score);
    event ExecutionVetoed(uint256 indexed projectId, address indexed vetoer);
    event InvestmentExecuted(uint256 indexed projectId, uint256 amount, uint256 upfront);
    event PayoutClaimed(uint256 indexed projectId, uint256 amount);
    event CircuitBroken(uint256 indexed projectId);
    event ProjectExited(uint256 indexed projectId, uint256 proceeds, bool isProfit);
    event ProjectWriteOff(uint256 indexed projectId, uint256 originalAmount);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error InvalidStatus();
    error ZeroAmount();
    error TransferFailed();
    error TimelockActive();
    error TimelockExpired();
    error OracleNotSet();
    error InvalidThreshold();
    error NotLP();          // caller holds no FundVault shares

    // ─── Constructor ────────────────────────────────────────────────────────
    constructor(address _fundVault, address _weth, uint256 _scoreThreshold) {
        fundVault       = IFundVault(_fundVault);
        WETH            = IWETH(_weth);
        scoreThreshold  = _scoreThreshold == 0 ? 60 : _scoreThreshold;  // default 60 (out of 100)
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Admin ──────────────────────────────────────────────────────────────
    event ScoreThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    function setOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        oracle = IOmniOracle(_oracle);
    }

    function setScoreThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newThreshold > 100) revert InvalidThreshold();
        emit ScoreThresholdUpdated(scoreThreshold, newThreshold);
        scoreThreshold = newThreshold;
    }

    // ─── ETH Reception ─────────────────────────────────────────────────────
    receive() external payable {}

    // ─── Project Submission ─────────────────────────────────────────────────
    /// @notice Submit a project for AI audit.
    ///         Immediately triggers a Chainlink Functions request to 0G Compute.
    /// @param commitHash      keccak256 of the pitch deck / source code
    /// @param contractAddr    project's contract or wallet address
    /// @param bizApi          business context URL or description for AI prompt
    /// @param requestedAmount ETH (in wei) requested for investment
    function submitProject(
        bytes32 commitHash,
        address contractAddr,
        string  calldata bizApi,
        uint256 requestedAmount
    ) external returns (uint256 projectId) {
        if (commitHash == bytes32(0) || contractAddr == address(0)) revert ZeroAmount();
        if (address(oracle) == address(0)) revert OracleNotSet();

        projectId = ++projectCount;
        Project storage p = projects[projectId];
        p.applicant       = msg.sender;
        p.commitHash      = commitHash;
        p.contractAddr    = contractAddr;
        p.bizApi          = bizApi;
        p.requestedAmount = requestedAmount;
        p.status          = ProjectStatus.Auditing;
        p.submittedAt     = uint40(block.timestamp);

        emit ProjectSubmitted(projectId, msg.sender, commitHash, contractAddr, requestedAmount);

        // Request AI audit from Chainlink Functions → 0G Compute
        bytes32 clRequestId = oracle.requestAudit(
            projectId,
            _bytes32ToHex(commitHash),
            bizApi
        );
        emit AuditRequested(projectId, clRequestId);
    }

    // ─── Settle Audit (two-transaction pattern) ─────────────────────────────

    /// @notice Permissionless finalizer — reads oracle's stored result and
    ///         transitions the project from Auditing → PendingExecution / Rejected.
    ///
    ///         The Chainlink callback no longer calls IM directly (eliminates the
    ///         63/64 sub-call gas risk). Anyone can call this once the oracle has
    ///         stored the result (fulfilledScore[projectId] != 0).
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

        uint256 score     = raw - 1; // undo the +1 sentinel
        bytes32 hash      = oracle.fulfilledHash(projectId);

        p.auditScore       = uint8(score > 100 ? 100 : score);
        p.auditContentHash = hash;
        p.auditedAt        = uint40(block.timestamp);

        emit AuditCompleted(projectId, score, hash);

        if (score >= scoreThreshold) {
            p.status             = ProjectStatus.PendingExecution;
            p.executionUnlocksAt = uint40(block.timestamp + EXECUTION_DELAY);
            emit ExecutionQueued(projectId, uint256(p.executionUnlocksAt), score);
        } else {
            p.status = ProjectStatus.Rejected;
        }
    }

    // ─── Veto (during timelock window) ──────────────────────────────────────
    /// @notice Any LP (FundVault depositor) may veto during the execution timelock.
    ///         Replaces the old RISK_AGENT_ROLE gate — LP governance > admin gate.
    function veto(uint256 projectId) external {
        if (fundVault.balanceOf(msg.sender) == 0) revert NotLP();
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.PendingExecution)  revert InvalidStatus();
        if (block.timestamp >= uint256(p.executionUnlocksAt)) revert TimelockExpired();
        p.status = ProjectStatus.Vetoed;
        emit ExecutionVetoed(projectId, msg.sender);
    }

    // ─── Execute Investment ──────────────────────────────────────────────────
    /// @notice Permissionless after timelock. Sends 20% upfront; 80% vests linearly.
    function executeInvestment(
        uint256 projectId,
        uint256 amount,
        bytes   calldata vestingSchedule
    ) external {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.PendingExecution) revert InvalidStatus();
        if (block.timestamp < uint256(p.executionUnlocksAt)) revert TimelockActive();
        if (amount == 0) revert ZeroAmount();

        fundVault.divestForInvestment(amount);
        WETH.withdraw(amount);

        uint256 upfront = amount * UPFRONT_BPS / 10_000;
        (bool ok, ) = p.applicant.call{value: upfront}("");
        if (!ok) revert TransferFailed();

        p.investmentAmount = amount;
        p.releasedAmount   = upfront;
        p.investedAt       = uint40(block.timestamp);
        p.status           = ProjectStatus.Active;
        vestingSchedules[projectId] = vestingSchedule;

        emit InvestmentExecuted(projectId, amount, upfront);
    }

    // ─── Vesting Payout ─────────────────────────────────────────────────────
    function claimPayout(uint256 projectId) external {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();

        uint256 claimable = getClaimableAmount(projectId);
        if (claimable == 0) revert ZeroAmount();

        p.releasedAmount += claimable;
        (bool ok, ) = p.applicant.call{value: claimable}("");
        if (!ok) revert TransferFailed();

        emit PayoutClaimed(projectId, claimable);
    }

    function getClaimableAmount(uint256 projectId) public view returns (uint256) {
        Project memory p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken) return 0;
        if (p.investedAt == 0) return 0;

        uint256 total      = p.investmentAmount;
        uint256 upfront    = total * UPFRONT_BPS / 10_000;
        uint256 linearPart = total - upfront;
        uint256 elapsed    = block.timestamp - p.investedAt;
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

    // ─── Exit & Write-Off ───────────────────────────────────────────────────
    function markExit(uint256 projectId, uint256 exitProceeds)
        external payable onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();
        p.status       = ProjectStatus.Exited;
        p.exitedAt     = uint40(block.timestamp);
        p.exitProceeds = exitProceeds;
        bool isProfit  = exitProceeds >= p.investmentAmount;
        if (isProfit && msg.value > 0) {
            WETH.deposit{value: msg.value}();
            WETH.transfer(address(fundVault), msg.value);
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
        bool isProfit  = proceeds >= invested;
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
        uint256 elapsed    = block.timestamp - p.investedAt;
        uint256 elapsedBps = elapsed >= VESTING_DURATION ? 10_000 : elapsed * 10_000 / VESTING_DURATION;
        vestedBps = UPFRONT_BPS + (10_000 - UPFRONT_BPS) * elapsedBps / 10_000;
    }

    // ─── Private Helpers ─────────────────────────────────────────────────────

    /// @dev Converts bytes32 to its 0x-prefixed lowercase hex string representation.
    ///      Used to pass the commit hash as a readable string to the Chainlink JS source.
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
