// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IInvestmentManager {
    function fulfillAudit(
        uint256 projectId,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reportHash,
        bytes[] calldata nodeSignatures
    ) external;

    function fulfillAuditFailure(uint256 projectId, uint256 reason) external;
}
