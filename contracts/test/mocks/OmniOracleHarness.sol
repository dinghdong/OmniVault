// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../oracle/OmniOracle.sol";

/// @title OmniOracleHarness — Test-only wrapper that exposes internal _fulfillRequest
/// @dev   Allows Hardhat tests to simulate Chainlink DON callbacks without a real
///        router. The constructor accepts any address as the router (no validation
///        in FunctionsClient's constructor beyond storing the address).
contract OmniOracleHarness is OmniOracle {
    constructor(
        address functionsRouter,
        uint64  subscriptionId,
        bytes32 donId
    ) OmniOracle(functionsRouter, subscriptionId, donId) {}

    /// @notice Directly invoke _fulfillRequest, bypassing the router msg.sender guard.
    ///         Use this to simulate Chainlink DON callbacks in tests.
    function exposed_fulfillRequest(
        bytes32      requestId,
        bytes memory response,
        bytes memory err
    ) external {
        _fulfillRequest(requestId, response, err);
    }

    /// @notice Plant a fake pending request (projectId → requestId mapping).
    ///         Mirrors what _sendRequest() would normally do.
    function exposed_setRequest(bytes32 requestId, uint256 projectId) external {
        s_requestToProject[requestId] = projectId;
        s_pendingRequest[projectId]   = requestId;
    }
}
