// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IFundVault } from "../interfaces/IFundVault.sol";
import { INonFungibleAgent } from "../interfaces/INonFungibleAgent.sol";

/// @dev OmniOracle interface — stores 3-dimensional AI audit scores
interface IOmniOracle {
    function requestAudit(uint256 projectId) external returns (bytes32 requestId);

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

/// @dev Agent vault interface — receives approved funds and executes agent intents
interface IAgentVault {
    function createBetOrder(
        uint256 projectId,
        uint256 agentId,
        uint256 fundedAmount,
        bytes calldata initData
    ) external;
}

/// @title InvestmentManager — A2A funding gateway for AI agents
/// @notice AI agents autonomously submit funding requests. After AI audit and
///         a timelock, approved capital is transferred to a domain-specific
///         agent vault (e.g. WorldCupAgentVault) for execution.
contract InvestmentManager is AccessControl, ReentrancyGuard {
    bytes32 public constant RISK_AGENT_ROLE = keccak256("RISK_AGENT_ROLE");

    enum ProjectStatus {
        None,              // 0
        Auditing,          // 1  waiting for oracle
        PendingExecution,  // 2  AI approved; waiting for timelock
        Rejected,          // 3  score below threshold or audit failed
        Active,            // 4  funds transferred to vault; bet/order live
        Settled,           // 5  vault reported final return
        Vetoed,            // 6  blocked during timelock
        CircuitBroken      // 7  emergency halt
    }

    struct Project {
        address applicant;       // AI agent wallet (must own agentId NFA)
        address contractAddr;    // domain-specific agent vault
        uint256 requestedAmount; // capital requested by the agent
        uint256 fundedAmount;    // capital actually sent to the vault
        uint256 agentId;         // NFA tokenId of the submitting agent
        bytes   initData;        // opaque vault-specific initialization data
        ProjectStatus status;
        uint8  auditScore;       // final weighted score 0-100
        uint8  reliabilityScore; // dimension 1
        uint8  qualityScore;     // dimension 2
        uint8  marketFitScore;   // dimension 3
        uint40 submittedAt;
        uint40 auditedAt;
        uint40 executionUnlocksAt;
        uint40 investedAt;
        uint40 settledAt;
        bytes32 auditContentHash;
        uint256 returnedAmount;  // amount returned by the vault after settlement
    }

    mapping(uint256 => Project) public projects;
    uint256 public projectCount;

    IFundVault public immutable fundVault;
    INonFungibleAgent public immutable nfa;
    IOmniOracle public oracle;

    uint256 public scoreThreshold;
    uint256 public constant EXECUTION_DELAY = 3 minutes; // demo; prod = longer

    event ProjectSubmitted(
        uint256 indexed projectId,
        address indexed applicant,
        uint256 indexed agentId,
        address contractAddr,
        uint256 requestedAmount
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
    event InvestmentExecuted(uint256 indexed projectId, address indexed vault, uint256 amount);
    event ProjectSettled(uint256 indexed projectId, uint256 returnedAmount);
    event ExecutionVetoed(uint256 indexed projectId, address indexed vetoer);
    event CircuitBroken(uint256 indexed projectId);
    event ScoreThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    error InvalidStatus();
    error ZeroAmount();
    error TransferFailed();
    error TimelockActive();
    error TimelockExpired();
    error OracleNotSet();
    error InvalidThreshold();
    error NotAgentOwner();
    error InvalidVault();

    constructor(address _fundVault, address _nfa, uint256 _scoreThreshold) {
        fundVault = IFundVault(_fundVault);
        nfa       = INonFungibleAgent(_nfa);
        scoreThreshold = _scoreThreshold == 0 ? 60 : _scoreThreshold;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        oracle = IOmniOracle(_oracle);
    }

    function setScoreThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newThreshold > 100) revert InvalidThreshold();
        emit ScoreThresholdUpdated(scoreThreshold, newThreshold);
        scoreThreshold = newThreshold;
    }

    receive() external payable {}

    /// @notice AI agent submits a funding request for a domain-specific vault.
    /// @param contractAddr    Agent vault that will receive funds (e.g. WorldCupAgentVault)
    /// @param requestedAmount ETH (wei) requested
    /// @param agentId         NFA tokenId of the submitting agent
    /// @param initData        Opaque data interpreted by the agent vault
    function submitProject(
        address contractAddr,
        uint256 requestedAmount,
        uint256 agentId,
        bytes   calldata initData
    ) external returns (uint256 projectId) {
        if (contractAddr == address(0)) revert InvalidVault();
        if (requestedAmount == 0) revert ZeroAmount();
        if (address(oracle) == address(0)) revert OracleNotSet();
        if (nfa.ownerOf(agentId) != msg.sender) revert NotAgentOwner();

        projectId = ++projectCount;
        Project storage p = projects[projectId];
        p.applicant       = msg.sender;
        p.contractAddr    = contractAddr;
        p.requestedAmount = requestedAmount;
        p.agentId         = agentId;
        p.initData        = initData;
        p.status          = ProjectStatus.Auditing;
        p.submittedAt     = uint40(block.timestamp);

        emit ProjectSubmitted(
            projectId, msg.sender, agentId, contractAddr, requestedAmount
        );

        bytes32 clRequestId = oracle.requestAudit(projectId);
        emit AuditRequested(projectId, clRequestId);
    }

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

        uint256 finalScore = raw - 1;
        bytes32 hash       = oracle.fulfilledHash(projectId);
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

    /// @notice Any LP may veto within the execution timelock window.
    function veto(uint256 projectId) external {
        if (fundVault.balanceOf(msg.sender) == 0) revert("Not LP");
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.PendingExecution) revert InvalidStatus();
        if (block.timestamp >= uint256(p.executionUnlocksAt)) revert TimelockExpired();
        p.status = ProjectStatus.Vetoed;
        emit ExecutionVetoed(projectId, msg.sender);
    }

    /// @notice Permissionless after timelock. Sends approved ETH to the agent vault
    ///         and instructs it to create the corresponding bet/order.
    function executeProject(uint256 projectId) external nonReentrant {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.PendingExecution) revert InvalidStatus();
        if (block.timestamp < uint256(p.executionUnlocksAt)) revert TimelockActive();

        uint256 amount = p.requestedAmount;
        p.fundedAmount = amount;
        p.investedAt   = uint40(block.timestamp);
        p.status       = ProjectStatus.Active;

        fundVault.divestForInvestment(amount);

        (bool sent, ) = p.contractAddr.call{value: amount}("");
        if (!sent) revert TransferFailed();

        IAgentVault(p.contractAddr).createBetOrder(
            projectId,
            p.agentId,
            amount,
            p.initData
        );

        emit InvestmentExecuted(projectId, p.contractAddr, amount);
    }

    /// @notice Vault reports settlement and returns the vault's share of proceeds.
    /// @param projectId     Project being settled
    /// @param vaultShare    ETH amount being returned to InvestmentManager/FundVault
    function reportSettlement(uint256 projectId, uint256 vaultShare)
        external
        payable
        nonReentrant
    {
        Project storage p = projects[projectId];
        if (msg.sender != p.contractAddr) revert InvalidVault();
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.CircuitBroken)
            revert InvalidStatus();
        if (msg.value != vaultShare) revert InvalidStatus();

        p.returnedAmount = vaultShare;
        p.settledAt      = uint40(block.timestamp);
        p.status         = ProjectStatus.Settled;

        if (vaultShare > p.fundedAmount) {
            fundVault.addRealizedGains{value: vaultShare}(vaultShare - p.fundedAmount, p.fundedAmount);
        } else {
            fundVault.addRealizedLoss{value: vaultShare}(vaultShare, p.fundedAmount);
        }

        emit ProjectSettled(projectId, vaultShare);
    }

    function triggerCircuitBreak(uint256 projectId) external onlyRole(RISK_AGENT_ROLE) {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Active && p.status != ProjectStatus.Auditing)
            revert InvalidStatus();
        p.status = ProjectStatus.CircuitBroken;
        emit CircuitBroken(projectId);
    }

    function getAuditScores(uint256 projectId)
        external view
        returns (uint8 finalScore, uint8 reliability, uint8 quality, uint8 marketFit)
    {
        Project memory p = projects[projectId];
        return (p.auditScore, p.reliabilityScore, p.qualityScore, p.marketFitScore);
    }
}
