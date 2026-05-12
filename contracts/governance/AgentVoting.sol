// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AgentRegistry } from "./AgentRegistry.sol";
import { IInvestmentManager } from "../interfaces/IInvestmentManager.sol";

/// @title AgentVoting — On-chain unanimous voting + LP community veto window.
///
/// Flow per project:
///   1. Each registered AI agent independently calls agentVote().
///      • Any reject → immediately fails the project (fulfillAuditFailure).
///      • All N agents approve → QuorumReached, 48 h community window opens.
///   2. LP holders with ≥1 % FundToken supply can communityVeto() within 48 h.
///   3. After 48 h with no veto, anyone calls triggerExecution() → fulfillAudit()
///      is forwarded to InvestmentManager with averaged scores.
///
/// InvestmentManager must grant AI_ORACLE_ROLE to this contract.
contract AgentVoting {
    // ─── Structs ─────────────────────────────────────────────────────────────

    struct AgentVote {
        bool voted;
        bool approved;
        uint256 score;
        uint256 scoreLow;
        uint256 scoreHigh;
        bytes32 reasoningHash; // keccak256 of off-chain reasoning text / IPFS CID
    }

    struct ProjectVoting {
        bool quorumReached;     // all agents voted + all approved
        bool communityVetoed;
        bool executed;          // fulfillAudit/fulfillAuditFailure already called
        uint256 approvalCount;
        uint256 totalAgentCount; // snapshot at first vote (prevents registry-swap attacks)
        uint256 communityWindowEnd; // 0 until quorum reached
        // Running sums — averaged into final scores after quorum
        uint256 scoreSum;
        uint256 scoreLowSum;
        uint256 scoreHighSum;
        bytes32 reportHash;     // XOR of all agent reasoningHashes
    }

    // ─── State ───────────────────────────────────────────────────────────────

    AgentRegistry public immutable registry;
    IInvestmentManager public immutable investmentManager;
    IERC20 public immutable fundToken;

    uint256 public constant COMMUNITY_WINDOW  = 48 hours;
    uint256 public constant VETO_THRESHOLD_BPS = 100; // 1 % = 100 bps of 10 000

    mapping(uint256 => ProjectVoting)              public projectVotings;
    mapping(uint256 => mapping(address => AgentVote)) public agentVotes;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AgentVoted(
        uint256 indexed projectId,
        address indexed agent,
        bool    approved,
        uint256 score,
        bytes32 reasoningHash
    );
    event QuorumReached(
        uint256 indexed projectId,
        uint256 communityWindowEnd,
        uint256 avgScore
    );
    event CommunityVetoed(uint256 indexed projectId, address indexed vetoer);
    event VotingExecuted(uint256 indexed projectId, uint256 avgScore);
    event ProjectRejected(uint256 indexed projectId, address indexed rejector);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotRegisteredAgent();
    error AlreadyVoted();
    error AlreadyExecuted();
    error QuorumNotReached();
    error CommunityWindowOpen();
    error CommunityWindowClosed();
    error InsufficientVotingPower();
    error EmptyRegistry();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _registry,
        address _investmentManager,
        address _fundToken
    ) {
        registry          = AgentRegistry(_registry);
        investmentManager = IInvestmentManager(_investmentManager);
        fundToken         = IERC20(_fundToken);
    }

    // ─── Agent Voting ────────────────────────────────────────────────────────

    /// @notice Called by each registered AI agent after independent analysis.
    /// @param projectId    On-chain project ID.
    /// @param approved     true = approve investment, false = reject.
    /// @param score        Audit score (basis points, 0–10 000).
    /// @param scoreLow     Lower confidence bound.
    /// @param scoreHigh    Upper confidence bound.
    /// @param reasoningHash keccak256 of off-chain reasoning / IPFS CID.
    function agentVote(
        uint256 projectId,
        bool    approved,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reasoningHash
    ) external {
        if (!registry.isRegistered(msg.sender)) revert NotRegisteredAgent();

        ProjectVoting storage pv = projectVotings[projectId];
        AgentVote     storage av = agentVotes[projectId][msg.sender];

        if (av.voted)    revert AlreadyVoted();
        if (pv.executed) revert AlreadyExecuted();

        av.voted         = true;
        av.approved      = approved;
        av.score         = score;
        av.scoreLow      = scoreLow;
        av.scoreHigh     = scoreHigh;
        av.reasoningHash = reasoningHash;

        emit AgentVoted(projectId, msg.sender, approved, score, reasoningHash);

        // Any single rejection immediately fails the project.
        if (!approved) {
            pv.executed = true;
            emit ProjectRejected(projectId, msg.sender);
            investmentManager.fulfillAuditFailure(projectId, 1);
            return;
        }

        // Snapshot agent count on the first recorded vote.
        if (pv.totalAgentCount == 0) {
            uint256 n = registry.agentCount();
            if (n == 0) revert EmptyRegistry();
            pv.totalAgentCount = n;
        }

        pv.approvalCount  += 1;
        pv.scoreSum       += score;
        pv.scoreLowSum    += scoreLow;
        pv.scoreHighSum   += scoreHigh;
        pv.reportHash      = pv.reportHash ^ reasoningHash; // XOR accumulator

        // Unanimous quorum: all registered agents approved.
        if (pv.approvalCount == pv.totalAgentCount && !pv.quorumReached) {
            pv.quorumReached       = true;
            pv.communityWindowEnd  = block.timestamp + COMMUNITY_WINDOW;

            uint256 avgScore = pv.scoreSum / pv.totalAgentCount;
            emit QuorumReached(projectId, pv.communityWindowEnd, avgScore);
        }
    }

    // ─── LP Community Veto ───────────────────────────────────────────────────

    /// @notice LP holders with ≥ 1 % FundToken supply can veto during 48 h window.
    function communityVeto(uint256 projectId) external {
        ProjectVoting storage pv = projectVotings[projectId];

        if (!pv.quorumReached)                        revert QuorumNotReached();
        if (pv.executed)                              revert AlreadyExecuted();
        if (block.timestamp >= pv.communityWindowEnd) revert CommunityWindowClosed();

        uint256 total   = fundToken.totalSupply();
        uint256 balance = fundToken.balanceOf(msg.sender);
        // Must hold tokens AND hold >= 1% of supply
        if (balance == 0 || balance * 10_000 < total * VETO_THRESHOLD_BPS)
            revert InsufficientVotingPower();

        pv.communityVetoed = true;
        pv.executed        = true;

        emit CommunityVetoed(projectId, msg.sender);
        investmentManager.fulfillAuditFailure(projectId, 2); // reason 2 = community veto
    }

    // ─── Trigger Execution ───────────────────────────────────────────────────

    /// @notice Permissionless: anyone calls after 48 h window closes with no veto.
    ///         Forwards averaged scores to InvestmentManager.fulfillAudit().
    function triggerExecution(uint256 projectId) external {
        ProjectVoting storage pv = projectVotings[projectId];

        if (!pv.quorumReached)                        revert QuorumNotReached();
        if (pv.executed)                              revert AlreadyExecuted();
        if (block.timestamp < pv.communityWindowEnd)  revert CommunityWindowOpen();

        pv.executed = true;

        uint256 n        = pv.totalAgentCount;
        uint256 avgScore = pv.scoreSum      / n;
        uint256 avgLow   = pv.scoreLowSum   / n;
        uint256 avgHigh  = pv.scoreHighSum  / n;

        emit VotingExecuted(projectId, avgScore);

        bytes[] memory emptySigs;
        investmentManager.fulfillAudit(
            projectId,
            avgScore,
            avgLow,
            avgHigh,
            pv.reportHash,
            emptySigs
        );
    }

    // ─── View Helpers ────────────────────────────────────────────────────────

    /// @notice Returns true if all agents approved and 48 h window is open.
    function isCommunityWindowOpen(uint256 projectId) external view returns (bool) {
        ProjectVoting storage pv = projectVotings[projectId];
        return pv.quorumReached
            && !pv.executed
            && block.timestamp < pv.communityWindowEnd;
    }

    /// @notice Returns true if execution has been triggered (approved or rejected).
    function isFinalized(uint256 projectId) external view returns (bool) {
        return projectVotings[projectId].executed;
    }
}
