// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockOmniOracleV2 — Test stub with 3D scores for A2A flow
contract MockOmniOracleV2 {
    struct AuditResult {
        uint256 finalScore;   // 0 = not fulfilled; MAX = failed; else score+1
        uint8   reliability;
        uint8   quality;
        uint8   marketFit;
        bytes32 contentHash;
    }

    mapping(uint256 => AuditResult) private _results;
    uint256 public lastRequestedProjectId;
    bytes32 public constant MOCK_REQUEST_ID = keccak256("mock-request");

    event AuditRequested(uint256 indexed projectId);

    function requestAudit(uint256 projectId) external returns (bytes32) {
        lastRequestedProjectId = projectId;
        emit AuditRequested(projectId);
        return MOCK_REQUEST_ID;
    }

    // Test helper: set result for a project
    function setResult(
        uint256 projectId,
        uint256 finalScore,
        uint8   reliability,
        uint8   quality,
        uint8   marketFit,
        bytes32 contentHash
    ) external {
        _results[projectId] = AuditResult(finalScore, reliability, quality, marketFit, contentHash);
    }

    function fulfilledScore(uint256 projectId) external view returns (uint256) {
        return _results[projectId].finalScore;
    }

    function fulfilledScores(uint256 projectId)
        external view
        returns (uint8 reliability, uint8 quality, uint8 marketFit)
    {
        AuditResult memory r = _results[projectId];
        return (r.reliability, r.quality, r.marketFit);
    }

    function fulfilledHash(uint256 projectId) external view returns (bytes32) {
        return _results[projectId].contentHash;
    }
}
