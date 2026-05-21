// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_3_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";

/// @title OmniOracle — Chainlink Functions client for AI-powered project audits
/// @notice Requests AI audits via Chainlink DON (which calls 0G Compute Network),
///         then forwards the result to InvestmentManager.
///
/// Trust model:
///   • JS source stored on-chain (updatable by owner), executed by Chainlink DON.
///   • DON uses DON-hosted Secrets for the 0G Compute API key — never exposed on-chain.
///   • 0G Compute runs inference inside a TeeML enclave (Intel TDX) on Mainnet.
///   • Result: (finalScore uint256, contentHash bytes32) encoded as 64 bytes.
contract OmniOracle is FunctionsClient, ConfirmedOwner {
    using FunctionsRequest for FunctionsRequest.Request;

    // ─── Errors ────────────────────────────────────────────────────────────────
    error EmptyDonId();
    error EmptySource();
    error RequestNotFound(bytes32 requestId);
    error AuditAlreadyPending(uint256 projectId);
    error NotAuthorized();

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
    event AuditReport(
        uint256 indexed projectId,
        string  summary          // compact JSON: scores, recommendation, rationale, findings
    );
    event AuditFailed(
        uint256 indexed projectId,
        bytes32 indexed requestId,
        string  reason
    );

    // ─── State ─────────────────────────────────────────────────────────────────
    uint64  public s_subscriptionId;
    bytes32 internal s_donId;
    uint32  public s_callbackGasLimit = 300_000;

    /// @notice The Chainlink Functions JS source (stored on-chain, updatable).
    ///         Set via setAuditSource() after deployment, or in the deploy script.
    string  public s_auditSource;

    /// @notice Secrets version slot (DON-hosted secrets slot ID).
    uint8   public s_secretsSlotId;
    uint64  public s_secretsVersion;

    /// @notice The InvestmentManager contract that can request audits and
    ///         receives fulfillment callbacks.
    address public investmentManager;

    /// Maps Chainlink requestId → projectId
    mapping(bytes32 => uint256) public s_requestToProject;

    /// Maps projectId → pending requestId (zero = no pending request)
    mapping(uint256 => bytes32) public s_pendingRequest;

    /// Maps projectId → fulfilled score+1  (0 = not yet fulfilled, max = failed)
    /// score is stored as score+1 so that a score of 0 is distinguishable from unfulfilled.
    mapping(uint256 => uint256) public fulfilledScore;

    /// Maps projectId → content hash (SHA-256 of full audit log)
    mapping(uint256 => bytes32) public fulfilledHash;

    // ─── Constructor ────────────────────────────────────────────────────────────
    /// @param functionsRouter Chainlink Functions Router address (Sepolia: 0xb83E47C2bC239B3bf370bc41e1459A34b41238D0)
    /// @param subscriptionId  Chainlink subscription ID (created at functions.chain.link)
    /// @param donId           DON identifier bytes32 (Sepolia: formatBytes32String("fun-ethereum-sepolia-1"))
    constructor(
        address functionsRouter,
        uint64  subscriptionId,
        bytes32 donId
    )
        ConfirmedOwner(msg.sender)
        FunctionsClient(functionsRouter)
    {
        if (donId == bytes32(0)) revert EmptyDonId();
        s_subscriptionId = subscriptionId;
        s_donId          = donId;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────────

    function setInvestmentManager(address _im) external onlyOwner {
        investmentManager = _im;
    }

    function setSubscriptionId(uint64 newSubId) external onlyOwner {
        s_subscriptionId = newSubId;
    }

    function setDonId(bytes32 newDonId) external onlyOwner {
        if (newDonId == bytes32(0)) revert EmptyDonId();
        s_donId = newDonId;
    }

    function setCallbackGasLimit(uint32 gasLimit) external onlyOwner {
        s_callbackGasLimit = gasLimit;
    }

    function setSecretsConfig(uint8 slotId, uint64 version) external onlyOwner {
        s_secretsSlotId   = slotId;
        s_secretsVersion  = version;
    }

    /// @notice Upload (or update) the Chainlink Functions JS source on-chain.
    ///         In production, run: npx ts-node scripts/upload-source.ts
    ///         For deploy scripts: call this with fs.readFileSync("chainlink/audit-source.js")
    function setAuditSource(string calldata source) external onlyOwner {
        if (bytes(source).length == 0) revert EmptySource();
        s_auditSource = source;
    }

    function getDonId() external view returns (bytes32) {
        return s_donId;
    }

    // ─── Request Audit ──────────────────────────────────────────────────────────

    /// @notice Request an AI audit for a project via Chainlink Functions.
    ///         Callable only by the linked InvestmentManager.
    /// @param projectId       Project ID in InvestmentManager
    /// @param sourceCodeHash  Hex string of the project's commit hash (keccak256 of pitch/code)
    /// @param bizApi          Business context URL / description passed as prompt context
    /// @return requestId      Chainlink Functions request ID
    function requestAudit(
        uint256 projectId,
        string  calldata sourceCodeHash,
        string  calldata bizApi
    ) external returns (bytes32 requestId) {
        if (msg.sender != investmentManager) revert NotAuthorized();
        if (bytes(s_auditSource).length == 0) revert EmptySource();
        if (s_pendingRequest[projectId] != bytes32(0)) revert AuditAlreadyPending(projectId);

        // Build the Chainlink Functions request
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(s_auditSource);

        // Pass project data as args (available as `args[]` in the JS source)
        string[] memory fArgs = new string[](3);
        fArgs[0] = _uint256ToString(projectId);
        fArgs[1] = sourceCodeHash;
        fArgs[2] = bizApi;
        req.setArgs(fArgs);

        // Attach DON-hosted secrets (ZG_API_KEY + ZG_BASE_URL)
        if (s_secretsVersion > 0) {
            req.addDONHostedSecrets(s_secretsSlotId, s_secretsVersion);
        }

        // Send request — Chainlink bills to the subscription
        requestId = _sendRequest(
            req.encodeCBOR(),
            s_subscriptionId,
            s_callbackGasLimit,
            s_donId
        );

        s_requestToProject[requestId]  = projectId;
        s_pendingRequest[projectId]    = requestId;

        emit AuditRequested(projectId, requestId, sourceCodeHash);
    }

    // ─── Chainlink Callback ─────────────────────────────────────────────────────

    /// @notice Called by Chainlink DON after JS execution completes.
    ///         Stores score+contentHash in mappings; NO external call to InvestmentManager.
    ///         InvestmentManager.settleAudit(projectId) is called separately (permissionless).
    ///
    ///         Gas budget (90 000):
    ///           ~69 000 used here (2 cold SSTOREs + events + summary loop)
    ///           ~21 000 remaining — no 63/64 sub-call risk.
    function _fulfillRequest(
        bytes32 requestId,
        bytes   memory response,
        bytes   memory err
    ) internal override {
        uint256 projectId = s_requestToProject[requestId];
        if (projectId == 0) return; // unknown requestId — silent return, never revert

        delete s_pendingRequest[projectId];

        // ── Error path ──────────────────────────────────────────────────────
        if (err.length > 0 || response.length < 32) {
            fulfilledScore[projectId] = type(uint256).max; // sentinel: failed
            emit AuditFailed(projectId, requestId, err.length > 0 ? string(err) : "short");
            return;
        }

        // ── Success path ─────────────────────────────────────────────────────
        // Read score from first 32 bytes via assembly (no ABI overhead, no bounds check cost)
        uint256 score;
        assembly { score := mload(add(response, 32)) }
        if (score > 100) score = 100;

        fulfilledScore[projectId] = score + 1; // +1: score=0 ≠ unfulfilled=0

        // Store content hash if response is long enough (bytes 32-63)
        if (response.length >= 64) {
            bytes32 contentHash;
            assembly { contentHash := mload(add(response, 64)) }
            fulfilledHash[projectId] = contentHash;
            emit AuditFulfilled(projectId, requestId, score, contentHash);
        }
        // No byte-copy loop, no AuditReport event — keeps callback under 60K gas
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    function _uint256ToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buf = new bytes(digits);
        while (value != 0) {
            digits--;
            buf[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buf);
    }
}
