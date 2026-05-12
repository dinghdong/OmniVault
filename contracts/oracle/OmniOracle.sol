// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_3_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title OmniOracle — Chainlink Functions client for AI-powered project audits
/// @notice Receives audit requests, queries AI agents via Chainlink Functions,
///         and stores the returned audit scores for InvestmentManager to consume.
contract OmniOracle is FunctionsClient, ConfirmedOwner, AccessControl {
    using FunctionsRequest for FunctionsRequest.Request;

    // ─── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant AUDIT_EXECUTOR_ROLE = keccak256("AUDIT_EXECUTOR_ROLE");

    // ─── Events ────────────────────────────────────────────────────────────────
    event AuditRequestSent(
        uint256 indexed projectId,
        bytes32 indexed requestId,
        string sourceCodeHash,
        string bizApiEndpoint
    );
    event AuditResultReceived(
        uint256 indexed projectId,
        bytes32 indexed requestId,
        uint256 score,
        uint256 scoreLow,
        uint256 scoreHigh,
        bytes32 reportHash
    );
    event AuditFailed(
        uint256 indexed projectId,
        bytes32 indexed requestId,
        string reason
    );

    // ─── State ─────────────────────────────────────────────────────────────────
    // Subscription ID for Chainlink Functions
    uint64 public s_subscriptionId;

    // Map requestId → projectId
    mapping(bytes32 => uint256) public s_requestToProject;

    // Map projectId → latest audit result
    mapping(uint256 => AuditResult) public s_auditResults;

    // ─── Audit Result Struct ────────────────────────────────────────────────────
    struct AuditResult {
        uint256 score;
        uint256 scoreLow;
        uint256 scoreHigh;
        bytes32 reportHash;
        bool exists;
    }

    // ─── Errors ─────────────────────────────────────────────────────────────────
    error EmptySourceCodeHash();
    error EmptyBizApi();
    error RequestNotFound(bytes32 requestId);
    error AuditAlreadyExists(uint256 projectId);
    error EmptyDonId();

    /// @notice Constructor
    /// @param functionsRouter Chainlink Functions Router address
    /// @param subscriptionId Chainlink subscription ID for billing
    /// @param donId DON identifier for the executable
    constructor(
        address functionsRouter,
        uint64 subscriptionId,
        bytes32 donId
    )
        ConfirmedOwner(msg.sender)
        FunctionsClient(functionsRouter)
    {
        if (donId == bytes32(0)) revert EmptyDonId();
        s_subscriptionId = subscriptionId;
        s_donId = donId;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    bytes32 internal s_donId;

    // ─── External Functions ─────────────────────────────────────────────────────

    /// @notice Update the subscription ID
    function setSubscriptionId(uint64 newSubscriptionId) external onlyOwner {
        s_subscriptionId = newSubscriptionId;
    }

    /// @notice Get current DON ID
    function getDonId() external view returns (bytes32) {
        return s_donId;
    }

    /// @notice Request a new AI audit for a project
    /// @param projectId Project ID in InvestmentManager
    /// @param sourceCodeHash IPFS/CID hash of the source code to audit
    /// @param bizApi Business API endpoint URL for additional data
    /// @return requestId The Chainlink request ID
    function requestAudit(
        uint256 projectId,
        string calldata sourceCodeHash,
        string calldata bizApi
    ) external onlyRole(AUDIT_EXECUTOR_ROLE) returns (bytes32 requestId) {
        if (bytes(sourceCodeHash).length == 0) revert EmptySourceCodeHash();
        if (bytes(bizApi).length == 0) revert EmptyBizApi();
        if (s_auditResults[projectId].exists) revert AuditAlreadyExists(projectId);

        // Build the JavaScript source for the audit
        string memory javaScriptSource = _buildAuditScript();

        // Initialize the request
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(javaScriptSource);

        // Set args
        string[] memory args = new string[](3);
        args[0] = sourceCodeHash;
        args[1] = bizApi;
        args[2] = _toString(projectId);
        req.setArgs(args);

        // Send request with subscription billing
        requestId = _sendRequest(
            req.encodeCBOR(),
            s_subscriptionId,
            300000, // callback gas limit
            s_donId
        );

        s_requestToProject[requestId] = projectId;
        emit AuditRequestSent(projectId, requestId, sourceCodeHash, bizApi);
    }

    /// @notice Callback invoked by Chainlink DON with audit results
    function _fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) internal override {
        uint256 projectId = s_requestToProject[requestId];
        if (projectId == 0) revert RequestNotFound(requestId);

        if (err.length > 0) {
            emit AuditFailed(projectId, requestId, string(err));
            return;
        }

        // Parse response: abi.encode(score, scoreLow, scoreHigh, reportHash)
        if (response.length < 128) {
            emit AuditFailed(projectId, requestId, "Response too short");
            return;
        }

        (uint256 score, uint256 scoreLow, uint256 scoreHigh, bytes32 reportHash) =
            abi.decode(response, (uint256, uint256, uint256, bytes32));

        s_auditResults[projectId] = AuditResult({
            score: score,
            scoreLow: scoreLow,
            scoreHigh: scoreHigh,
            reportHash: reportHash,
            exists: true
        });

        emit AuditResultReceived(projectId, requestId, score, scoreLow, scoreHigh, reportHash);
    }

    /// @notice Get the latest audit result for a project
    function getAuditResult(uint256 projectId)
        external
        view
        returns (AuditResult memory result)
    {
        return s_auditResults[projectId];
    }

    /// @notice Update the DON ID (for upgrades)
    function setDonId(bytes32 newDonId) external onlyOwner {
        if (newDonId == bytes32(0)) revert EmptyDonId();
        s_donId = newDonId;
    }

    // ─── Internal Helpers ────────────────────────────────────────────────────────

    /// @dev Builds the inline JavaScript audit script
    function _buildAuditScript() internal pure returns (string memory) {
        return
            "const sourceCodeHash = args[0];"
            "const bizApi = args[1];"
            "const projectId = parseInt(args[2]);"
            ""
            "// Make HTTP request to AI audit service"
            "const auditResponse = await Functions.makeHttpRequest({"
            "  url: `https://api.omnivault.ai/v1/audit/${projectId}`,"
            "  method: 'POST',"
            "  headers: { 'Content-Type': 'application/json' },"
            "  body: JSON.stringify({ sourceCodeHash, bizApi }),"
            "  timeout: 60000"
            "});"
            ""
            "const result = auditResponse.data;"
            "if (!result) throw new Error('No audit data received');"
            ""
            "const responseBytes = Functions.encodeUint256(result.score)"
            "  .concat(Functions.encodeUint256(result.scoreLow))"
            "  .concat(Functions.encodeUint256(result.scoreHigh))"
            "  .concat(Functions.encodeBytes32(result.reportHash || '0x00'));"
            "return Functions.encodeBytes(responseBytes);";
    }

    /// @dev Simple uint256 to string conversion
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}