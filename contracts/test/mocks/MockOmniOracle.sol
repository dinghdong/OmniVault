// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockOmniOracle
/// @notice Drop-in replacement for OmniOracle that skips Chainlink Functions.
///         Used for demos and testnet deployments where Chainlink ToS hasn't been accepted.
///
/// Demo flow:
///   1. InvestmentManager.submitProject() → calls MockOmniOracle.requestAudit()
///   2. Owner calls fulfillAuditMock(projectId, score, contentHash) to simulate DON callback
///   3. InvestmentManager.settleAudit(projectId) reads fulfilledScore → normal flow continues
contract MockOmniOracle is Ownable {

    // ─── Events ────────────────────────────────────────────────────────────────
    event AuditRequested(
        uint256 indexed projectId,
        bytes32 indexed requestId,
        string  sourceCodeHash
    );
    event AuditFulfilled(
        uint256 indexed projectId,
        bytes32 indexed requestId,
        uint256 score,
        bytes32 contentHash
    );

    // ─── State ─────────────────────────────────────────────────────────────────
    address public investmentManager;

    /// @notice Returns score+1 after fulfillAuditMock() is called.
    ///         0 = not yet fulfilled; type(uint256).max = failed; else score+1 (range 1-101)
    mapping(uint256 => uint256) public fulfilledScore;

    /// @notice Returns the content hash set by fulfillAuditMock()
    mapping(uint256 => bytes32) public fulfilledHash;

    /// @notice Monotonically increasing nonce for generating mock requestIds
    uint256 private _nonce;

    // ─── Constructor ────────────────────────────────────────────────────────────
    constructor() Ownable(msg.sender) {}

    // ─── Admin ──────────────────────────────────────────────────────────────────

    function setInvestmentManager(address _im) external onlyOwner {
        investmentManager = _im;
    }

    // ─── IOmniOracle interface ──────────────────────────────────────────────────

    /// @notice Called by InvestmentManager.submitProject(). Returns a mock requestId.
    function requestAudit(
        uint256 projectId,
        string  calldata sourceCodeHash,
        string  calldata /*bizApi*/
    ) external returns (bytes32 requestId) {
        require(msg.sender == investmentManager, "MockOmniOracle: not IM");

        // Generate a deterministic mock requestId
        requestId = keccak256(abi.encodePacked(projectId, ++_nonce, block.timestamp));

        emit AuditRequested(projectId, requestId, sourceCodeHash);
    }

    // ─── Demo helpers ───────────────────────────────────────────────────────────

    /// @notice Simulate the Chainlink DON callback. Call this after submitProject() to
    ///         move a project from Auditing → PendingExecution/Rejected.
    /// @param projectId   The project ID to settle
    /// @param score       Audit score 0-100
    /// @param contentHash Optional audit report hash (use bytes32(0) for demo)
    function fulfillAuditMock(
        uint256 projectId,
        uint8   score,
        bytes32 contentHash
    ) external onlyOwner {
        require(score <= 100, "MockOmniOracle: score out of range");

        bytes32 requestId = keccak256(abi.encodePacked(projectId, _nonce, block.timestamp));

        fulfilledScore[projectId] = uint256(score) + 1; // +1: score=0 ≠ unfulfilled=0
        fulfilledHash[projectId]  = contentHash;

        emit AuditFulfilled(projectId, requestId, score, contentHash);
    }

    /// @notice Convenience: auto-approve a project with score=85 (above typical 60 threshold)
    function autoApprove(uint256 projectId) external onlyOwner {
        this.fulfillAuditMock(projectId, 85, bytes32(uint256(projectId)));
    }

    /// @notice Convenience: auto-reject a project with score=30 (below any threshold)
    function autoReject(uint256 projectId) external onlyOwner {
        this.fulfillAuditMock(projectId, 30, bytes32(uint256(projectId)));
    }
}
