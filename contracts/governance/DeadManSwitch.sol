// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IInvestmentManager } from "../interfaces/IInvestmentManager.sol";

/// @title DeadManSwitch — A6: Automatic rug-pull protection via activity proof
///
/// Each Active project must submit a "proof of life" ping at most every PING_WINDOW days.
/// A ping contains a bytes32 commitHash (e.g. latest GitHub commit hash) that proves
/// the team is still working.
///
/// If a project misses PING_WINDOW + GRACE_PERIOD without a ping, anyone can call
/// triggerDeadSwitch() which marks the project as a write-off (via InvestmentManager).
///
/// Projects register themselves (or are registered by admin) with an expected ping interval.
contract DeadManSwitch is AccessControl {
    // ─── Roles ───────────────────────────────────────────────────────────────
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    // ─── Config ──────────────────────────────────────────────────────────────
    uint256 public constant PING_WINDOW  = 30 days;
    uint256 public constant GRACE_PERIOD = 30 days; // extra grace after missed deadline

    // ─── Storage ─────────────────────────────────────────────────────────────
    struct ProjectWatch {
        bool    active;
        uint256 lastPingAt;
        bytes32 lastCommitHash;
        uint256 pingCount;
        address pingBy;       // who submitted the last ping
    }

    mapping(uint256 => ProjectWatch) public watches;

    /// @notice InvestmentManager that receives the write-off call when a switch fires.
    ///         This contract must hold RISK_AGENT_ROLE on it. Zero = standalone mode
    ///         (trigger only emits the event, no on-chain write-off).
    IInvestmentManager public investmentManager;

    // ─── Events ──────────────────────────────────────────────────────────────
    event ProjectRegistered(uint256 indexed projectId, uint256 deadline);
    event PingReceived(uint256 indexed projectId, bytes32 commitHash, address pinger, uint256 pingCount);
    event DeadSwitchTriggered(uint256 indexed projectId, address indexed triggerer, uint256 daysSilent);
    event WatchDeactivated(uint256 indexed projectId);

    // ─── Errors ──────────────────────────────────────────────────────────────
    error AlreadyRegistered();
    error NotRegistered();
    error StillAlive();       // project pinged within window + grace — cannot trigger
    error AlreadyTriggered(); // watch was already deactivated

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
    }

    // ─── Admin wiring ────────────────────────────────────────────────────────
    /// @notice Link the InvestmentManager so triggerDeadSwitch() can write off
    ///         the project on-chain. Grant this contract RISK_AGENT_ROLE there.
    function setInvestmentManager(address _im) external onlyRole(DEFAULT_ADMIN_ROLE) {
        investmentManager = IInvestmentManager(_im);
    }

    // ─── Registration ─────────────────────────────────────────────────────────
    /// @notice Admin registers a project for dead-man monitoring after investment executes.
    function registerProject(uint256 projectId) external onlyRole(REGISTRAR_ROLE) {
        ProjectWatch storage w = watches[projectId];
        if (w.active) revert AlreadyRegistered();

        w.active      = true;
        w.lastPingAt  = block.timestamp;
        w.pingCount   = 0;

        emit ProjectRegistered(projectId, block.timestamp + PING_WINDOW);
    }

    // ─── Proof-of-life ping ─────────────────────────────────────────────────
    /// @notice Project team (or anyone) submits a ping with the latest commit hash.
    /// @param projectId   On-chain project ID.
    /// @param commitHash  keccak256 of latest GitHub commit SHA or any unique activity proof.
    function ping(uint256 projectId, bytes32 commitHash) external {
        ProjectWatch storage w = watches[projectId];
        if (!w.active) revert NotRegistered();

        w.lastPingAt    = block.timestamp;
        w.lastCommitHash = commitHash;
        w.pingCount     += 1;
        w.pingBy         = msg.sender;

        emit PingReceived(projectId, commitHash, msg.sender, w.pingCount);
    }

    // ─── Dead-man trigger ───────────────────────────────────────────────────
    /// @notice Anyone can call this if the project has been silent for > PING_WINDOW + GRACE_PERIOD.
    ///         Deactivates the watch so it can only be triggered once, then writes the
    ///         project off in the InvestmentManager (socializing the loss to LPs).
    function triggerDeadSwitch(uint256 projectId) external {
        ProjectWatch storage w = watches[projectId];
        if (!w.active) revert AlreadyTriggered();

        uint256 deadline = w.lastPingAt + PING_WINDOW + GRACE_PERIOD;
        if (block.timestamp < deadline) revert StillAlive();

        w.active = false;

        if (address(investmentManager) != address(0)) {
            investmentManager.markWriteOff(projectId);
        }

        uint256 daysSilent = (block.timestamp - w.lastPingAt) / 1 days;
        emit DeadSwitchTriggered(projectId, msg.sender, daysSilent);
    }

    // ─── Admin deactivation ─────────────────────────────────────────────────
    /// @notice Admin can deactivate a watch (e.g. project exited cleanly).
    function deactivate(uint256 projectId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        watches[projectId].active = false;
        emit WatchDeactivated(projectId);
    }

    // ─── View helpers ────────────────────────────────────────────────────────
    /// @notice Seconds until the dead-man deadline. 0 = already past deadline.
    function secondsUntilDeadline(uint256 projectId) external view returns (uint256) {
        ProjectWatch memory w = watches[projectId];
        if (!w.active) return 0;
        uint256 deadline = w.lastPingAt + PING_WINDOW + GRACE_PERIOD;
        return deadline > block.timestamp ? deadline - block.timestamp : 0;
    }

    /// @notice True if the project can currently be triggered.
    function isTriggerable(uint256 projectId) external view returns (bool) {
        ProjectWatch memory w = watches[projectId];
        if (!w.active) return false;
        return block.timestamp >= w.lastPingAt + PING_WINDOW + GRACE_PERIOD;
    }
}
