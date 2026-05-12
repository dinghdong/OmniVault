// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IWETH } from "../interfaces/IWETH.sol";
import { IFundVault } from "../interfaces/IFundVault.sol";

/// @title InvestmentManager — Project application, audit, investment, and payout
/// @notice v1: ETH asset, WETH vault. LPs deposit ETH/WETH, vault supplies WETH to AAVE.
///
/// Governance model (Timelock + Veto):
///   1. AI oracle calls fulfillAudit() → status = PendingExecution + 72h countdown
///   2. RISK_AGENT holders have 72h to call veto() if they spot a bad decision
///   3. After 72h with no veto, oracle calls executeInvestment() → funds flow
contract InvestmentManager is AccessControl {
    // ─── Roles ───────────────────────────────────────────────────────────────
    bytes32 public constant AI_ORACLE_ROLE  = keccak256("AI_ORACLE_ROLE");
    bytes32 public constant RISK_AGENT_ROLE = keccak256("RISK_AGENT_ROLE");

    // ─── Project Status ──────────────────────────────────────────────────────
    enum ProjectStatus {
        None,              // 0
        Pending,           // 1
        Auditing,          // 2
        PendingExecution,  // 3  AI approved; waiting for 72h timelock to expire
        Rejected,          // 4  AI score < threshold, or audit failure
        Active,            // 5  investment executed
        CircuitBroken,     // 6  emergency halt by RISK_AGENT
        Exited,            // 7  project returned capital
        WriteOff,          // 8  total loss
        Vetoed             // 9  blocked by RISK_AGENT during timelock window
    }

    // ─── Project Data ────────────────────────────────────────────────────────
    struct Project {
        address applicant;
        bytes32 commitHash;
        address contractAddr;
        string bizApi;
        ProjectStatus status;
        uint256 auditScore;
        uint256 auditScoreLow;
        uint256 auditScoreHigh;
        bytes32 auditReportHash;
        uint256 investmentAmount;
        uint256 releasedAmount;
        uint256 submittedAt;
        uint256 auditedAt;
        uint256 executionUnlocksAt;  // timelock expiry: auditedAt + EXECUTION_DELAY
        uint256 exitedAt;
        uint256 exitProceeds;
    }

    // ─── Storage ────────────────────────────────────────────────────────────
    mapping(uint256 => Project) public projects;
    uint256 public projectCount;
    mapping(uint256 => bytes) public vestingSchedules;

    IFundVault public immutable fundVault;
    IWETH public immutable WETH;

    // ─── Parameters ─────────────────────────────────────────────────────────
    uint256 public constant SCORE_THRESHOLD = 8000;  // 80.00% in basis points
    uint256 public constant MAX_SCORE_DIFF  = 2000;  // 20-point spread threshold
    uint256 public constant EXECUTION_DELAY = 72 hours;

    // ─── Events ─────────────────────────────────────────────────────────────
    event ProjectSubmitted(
        uint256 indexed projectId,
        address indexed applicant,
        bytes32 commitHash,
        address contractAddr
    );
    event AuditCompleted(
        uint256 indexed projectId,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reportHash
    );
    event AuditFailed(uint256 indexed projectId, uint256 reason);
    // Emitted when AI score >= threshold; starts the 72h veto window
    event ExecutionQueued(
        uint256 indexed projectId,
        uint256 unlocksAt,
        uint256 score
    );
    // Emitted when a RISK_AGENT exercises veto before timelock expires
    event ExecutionVetoed(
        uint256 indexed projectId,
        address indexed vetoer,
        uint256 reason
    );
    event InvestmentExecuted(uint256 indexed projectId, uint256 amount);
    event PayoutClaimed(uint256 indexed projectId, uint256 amount);
    event CircuitBroken(uint256 indexed projectId, uint256 reason);
    event ProjectExited(uint256 indexed projectId, uint256 proceeds, bool isProfit);
    event ProjectWriteOff(uint256 indexed projectId, uint256 originalAmount);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error InvalidStatus();
    error ZeroAmount();
    error Unauthorized();
    error InvalidProject();
    error TransferFailed();
    error TimelockActive();   // execution attempted before delay expires
    error TimelockExpired();  // veto attempted after delay has passed

    // ─── Constructor ────────────────────────────────────────────────────────
    constructor(address _fundVault, address _weth) {
        fundVault = IFundVault(_fundVault);
        WETH = IWETH(_weth);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── ETH Reception ─────────────────────────────────────────────────────
    receive() external payable {}

    // ─── Project Application ────────────────────────────────────────────────
    function submitProject(
        bytes32 commitHash,
        address contractAddr,
        string calldata bizApi
    ) external returns (uint256 projectId) {
        if (commitHash == bytes32(0) || contractAddr == address(0))
            revert ZeroAmount();

        projectId = ++projectCount;
        Project storage p = projects[projectId];

        p.applicant    = msg.sender;
        p.commitHash   = commitHash;
        p.contractAddr = contractAddr;
        p.bizApi       = bizApi;
        p.status       = ProjectStatus.Pending;
        p.submittedAt  = block.timestamp;

        emit ProjectSubmitted(projectId, msg.sender, commitHash, contractAddr);

        _requestAudit(projectId);
    }

    // ─── AI Oracle Callback ──────────────────────────────────────────────────
    function fulfillAudit(
        uint256 projectId,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reportHash,
        bytes[] calldata /* nodeSignatures */
    ) external onlyRole(AI_ORACLE_ROLE) {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Auditing) revert InvalidStatus();

        p.auditScore      = score;
        p.auditScoreLow   = scoreLow;
        p.auditScoreHigh  = scoreHigh;
        p.auditReportHash = reportHash;
        p.auditedAt       = block.timestamp;

        emit AuditCompleted(projectId, score, scoreLow, scoreHigh, reportHash);

        if (score >= SCORE_THRESHOLD) {
            p.status              = ProjectStatus.PendingExecution;
            p.executionUnlocksAt  = block.timestamp + EXECUTION_DELAY;
            emit ExecutionQueued(projectId, p.executionUnlocksAt, score);
        } else {
            p.status = ProjectStatus.Rejected;
        }
    }

    function fulfillAuditFailure(uint256 projectId, uint256 reason)
        external
        onlyRole(AI_ORACLE_ROLE)
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Auditing) revert InvalidStatus();

        p.status = ProjectStatus.Rejected;
        emit AuditFailed(projectId, reason);
    }

    // ─── Veto (human override during timelock window) ────────────────────────
    /// @notice RISK_AGENT blocks investment before timelock expires.
    /// @param reason Numeric reason code (1=prompt-injection, 2=policy, 3=manual-review, …)
    function veto(uint256 projectId, uint256 reason)
        external
        onlyRole(RISK_AGENT_ROLE)
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.PendingExecution) revert InvalidStatus();
        if (block.timestamp >= p.executionUnlocksAt)    revert TimelockExpired();

        p.status = ProjectStatus.Vetoed;
        emit ExecutionVetoed(projectId, msg.sender, reason);
    }

    // ─── Execute Investment ──────────────────────────────────────────────────
    /// @notice Permissionless: anyone can execute after the 72 h timelock expires.
    ///         On-chain status + timelock checks make role enforcement redundant.
    function executeInvestment(
        uint256 projectId,
        uint256 amount,
        bytes calldata vestingSchedule
    ) external {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.PendingExecution) revert InvalidStatus();
        if (block.timestamp < p.executionUnlocksAt)     revert TimelockActive();
        if (amount == 0) revert ZeroAmount();

        // Withdraw WETH from vault → unwrap → send ETH to applicant
        fundVault.divestForInvestment(amount);
        WETH.withdraw(amount);

        (bool success, ) = p.applicant.call{value: amount}("");
        if (!success) revert TransferFailed();

        p.investmentAmount     = amount;
        p.status               = ProjectStatus.Active;
        vestingSchedules[projectId] = vestingSchedule;

        emit InvestmentExecuted(projectId, amount);
    }

    // ─── Payout (Vesting) ───────────────────────────────────────────────────
    function claimPayout(uint256 projectId) external {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();

        uint256 claimable = getClaimableAmount(projectId);
        if (claimable == 0) revert ZeroAmount();

        p.releasedAmount += claimable;

        (bool success, ) = p.applicant.call{value: claimable}("");
        if (!success) revert TransferFailed();

        emit PayoutClaimed(projectId, claimable);
    }

    /// @dev 20% upfront, 80% linearly over 52 weeks
    function getClaimableAmount(uint256 projectId)
        public
        view
        returns (uint256)
    {
        Project memory p = projects[projectId];
        if (p.status != ProjectStatus.Active) return 0;

        uint256 total        = p.investmentAmount;
        uint256 firstRelease = total * 2000 / 10000;
        uint256 linearPart   = total - firstRelease;

        uint256 vestingDuration = 52 weeks;
        uint256 elapsed = block.timestamp > p.auditedAt
            ? block.timestamp - p.auditedAt
            : 0;

        if (elapsed >= vestingDuration) {
            return total - p.releasedAmount;
        }

        uint256 linearVested = linearPart * elapsed / vestingDuration;
        uint256 totalVested  = firstRelease + linearVested;

        return totalVested > p.releasedAmount
            ? totalVested - p.releasedAmount
            : 0;
    }

    // ─── Circuit Break ───────────────────────────────────────────────────────
    function triggerCircuitBreak(uint256 projectId, uint256 reason)
        external
        onlyRole(RISK_AGENT_ROLE)
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.Auditing)
            revert InvalidStatus();

        p.status = ProjectStatus.CircuitBroken;
        emit CircuitBroken(projectId, reason);
    }

    // ─── Exit & Write-Off ───────────────────────────────────────────────────
    function markExit(uint256 projectId, uint256 exitProceeds) external payable {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();

        p.status      = ProjectStatus.Exited;
        p.exitedAt    = block.timestamp;
        p.exitProceeds = exitProceeds;

        bool isProfit = exitProceeds >= p.investmentAmount;
        if (isProfit) {
            if (msg.value > 0) {
                WETH.deposit{value: msg.value}();
                WETH.transfer(address(fundVault), msg.value);
            }
            fundVault.addRealizedGains(msg.value, p.investmentAmount);
        } else {
            fundVault.addRealizedLoss(exitProceeds, p.investmentAmount);
        }

        emit ProjectExited(projectId, exitProceeds, isProfit);
    }

    function markWriteOff(uint256 projectId) external onlyRole(RISK_AGENT_ROLE) {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();

        p.status   = ProjectStatus.WriteOff;
        p.exitedAt = block.timestamp;

        fundVault.addRealizedLoss(0, p.investmentAmount);

        emit ProjectWriteOff(projectId, p.investmentAmount);
    }

    // ─── Private ─────────────────────────────────────────────────────────────
    function _requestAudit(uint256 projectId) internal {
        Project storage p = projects[projectId];
        p.status = ProjectStatus.Auditing;
        // Chainlink Functions request would be triggered here in production
    }
}
