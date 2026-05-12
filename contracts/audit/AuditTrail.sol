// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AuditTrail
/// @notice Records every AI audit decision on-chain as an immutable hash chain.
contract AuditTrail is AccessControl {

    bytes32 public constant AI_ORACLE_ROLE = keccak256("AI_ORACLE_ROLE");

    struct AuditRecord {
        uint256 projectId;
        uint256 timestamp;
        bytes32 inputHash;   // hash of (code + prompt hash + timestamp)
        bytes32 outputHash; // hash of (score + reportHash + nodeSignatures)
        bytes32 nodeSetHash; // hash of participating DON node addresses
        uint256 nodeCount;
    }

    mapping(uint256 => AuditRecord[]) public auditRecords;
    mapping(uint256 => uint256) public auditCount;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    event AuditRecorded(
        uint256 indexed projectId,
        bytes32 inputHash,
        bytes32 outputHash,
        bytes32 nodeSetHash,
        uint256 nodeCount
    );

    /// @notice Record a single audit decision (called by AI_ORACLE_ROLE)
    function recordAudit(
        uint256 projectId,
        bytes32 inputHash,
        bytes32 outputHash,
        bytes32 nodeSetHash,
        uint256 nodeCount
    ) external onlyRole(AI_ORACLE_ROLE) {
        auditRecords[projectId].push(AuditRecord({
            projectId: projectId,
            timestamp: block.timestamp,
            inputHash: inputHash,
            outputHash: outputHash,
            nodeSetHash: nodeSetHash,
            nodeCount: nodeCount
        }));
        auditCount[projectId]++;
        emit AuditRecorded(projectId, inputHash, outputHash, nodeSetHash, nodeCount);
    }

    /// @notice Verify the integrity of a past audit record
    function verifyAuditRecord(
        uint256 projectId,
        uint256 index,
        bytes32 inputHash,
        bytes32 outputHash
    ) external view returns (bool) {
        AuditRecord memory record = auditRecords[projectId][index];
        return record.inputHash == inputHash && record.outputHash == outputHash;
    }
}
