// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IInvestmentManager } from "../../interfaces/IInvestmentManager.sol";

/// @title MockAgentVoting — Test stub that bypasses multi-agent voting.
/// @dev Allows unit tests to trigger fulfillAudit / fulfillAuditFailure directly
///      without deploying AgentRegistry or running real agent wallets.
contract MockAgentVoting {
    IInvestmentManager public immutable im;

    constructor(address _im) {
        im = IInvestmentManager(_im);
    }

    /// @notice Simulate all agents approving — forwards to InvestmentManager.
    function simulateApproval(
        uint256 projectId,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reportHash
    ) external {
        bytes[] memory emptySigs;
        im.fulfillAudit(projectId, score, scoreLow, scoreHigh, reportHash, emptySigs);
    }

    /// @notice Simulate a rejection (agent reject or community veto).
    function simulateRejection(uint256 projectId, uint256 reason) external {
        im.fulfillAuditFailure(projectId, reason);
    }
}
