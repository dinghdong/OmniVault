// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AgentRegistry — Manages the set of authorized AI agent wallets.
/// @notice Admin adds/removes agents. AgentVoting reads this to enforce quorum.
///         Designed to be upgradeable: swap agents without redeploying core contracts.
contract AgentRegistry is AccessControl {
    address[] private _agents;
    mapping(address => bool) public isRegistered;

    event AgentAdded(address indexed agent);
    event AgentRemoved(address indexed agent);

    error AlreadyRegistered();
    error NotRegistered();
    error EmptyRegistry();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function addAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (isRegistered[agent]) revert AlreadyRegistered();
        isRegistered[agent] = true;
        _agents.push(agent);
        emit AgentAdded(agent);
    }

    function removeAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isRegistered[agent]) revert NotRegistered();
        isRegistered[agent] = false;
        // Swap-and-pop to remove from array without gaps
        for (uint256 i = 0; i < _agents.length; i++) {
            if (_agents[i] == agent) {
                _agents[i] = _agents[_agents.length - 1];
                _agents.pop();
                break;
            }
        }
        emit AgentRemoved(agent);
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function getAgents() external view returns (address[] memory) {
        return _agents;
    }
}
