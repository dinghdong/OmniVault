// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IInvestmentManager {
    /// @notice Write off an Active/CircuitBroken project as a total loss.
    ///         Caller must hold RISK_AGENT_ROLE on the InvestmentManager.
    function markWriteOff(uint256 projectId) external;
}
