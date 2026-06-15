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
///   • Result (160 bytes, ABI-encoded):
///       word 0 (0–31):   finalScore   uint256   composite score [0,100]
///       word 1 (32–63):  reliability  uint256   [0,100]
///       word 2 (64–95):  quality      uint256   [0,100]
///       word 3 (96–127): marketFit    uint256   [0,100]
///       word 4 (128–159): contentHash bytes32   SHA-256 of full audit log
///   • Older 64-byte responses (finalScore + contentHash) are still decoded gracefully.
contract OmniOracle is FunctionsClient, ConfirmedOwner {
    using FunctionsRequest for FunctionsRequest.Request;

    // ─── Errors ────────────────────────────────────────────────────────────────
    error EmptyDonId();
    error EmptySource();
    error RequestNotFound(bytes32 requestId);
    error AuditAlreadyPending(uint256 projectId);
    error NotAuthorized();

    // ─── Structs ───────────────────────────────────────────────────────────────
    /// @notice 3-dimensional AI audit breakdown stored per project.
    struct AuditScores {
        uint8 reliability;   // agent reliability score [0,100]
        uint8 quality;       // code/product quality    [0,100]
        uint8 marketFit;     // market fit / traction   [0,100]
    }

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
        uint8   reliability,
        uint8   quality,
        uint8   marketFit,
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

    /// Maps projectId → 3-dimensional audit breakdown (reliability/quality/marketFit)
    mapping(uint256 => AuditScores) private s_auditScores;

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

    /// @notice Returns the 3-dimensional audit breakdown for a fulfilled project.
    ///         All values are 0 if the audit hasn't been fulfilled yet, or if
    ///         the response used the legacy 64-byte format.
    function fulfilledScores(uint256 projectId)
        external
        view
        returns (uint8 reliability, uint8 quality, uint8 marketFit)
    {
        AuditScores storage s = s_auditScores[projectId];
        return (s.reliability, s.quality, s.marketFit);
    }

    // ─── Request Audit ──────────────────────────────────────────────────────────

    /// @notice Request an AI audit for a project via Chainlink Functions.
    ///         Callable only by the linked InvestmentManager.
    /// @param projectId Project ID in InvestmentManager
    /// @return requestId Chainlink Functions request ID
    function requestAudit(uint256 projectId) external returns (bytes32 requestId) {
        if (msg.sender != investmentManager) revert NotAuthorized();
        if (bytes(s_auditSource).length == 0) revert EmptySource();
        if (s_pendingRequest[projectId] != bytes32(0)) revert AuditAlreadyPending(projectId);

        // Build the Chainlink Functions request
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(s_auditSource);

        // Pass only projectId; JS source reads agentId and NFA metadata from InvestmentManager.
        string[] memory fArgs = new string[](1);
        fArgs[0] = _uint256ToString(projectId);
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

        emit AuditRequested(projectId, requestId, "");
    }

    // ─── Chainlink Callback ─────────────────────────────────────────────────────

    /// @notice Called by Chainlink DON after JS execution completes.
    ///         Stores score + 3D breakdown + contentHash; NO external call to InvestmentManager.
    ///         InvestmentManager.settleAudit(projectId) is called separately (permissionless).
    ///
    ///         Expected response format (160 bytes, ABI-encoded uint256×4 + bytes32):
    ///           word 0 ( 0– 31): finalScore   uint256  [0,100]
    ///           word 1 (32– 63): reliability  uint256  [0,100]
    ///           word 2 (64– 95): quality      uint256  [0,100]
    ///           word 3 (96–127): marketFit    uint256  [0,100]
    ///           word 4 (128–159): contentHash bytes32
    ///
    ///         Older 64-byte responses (finalScore + contentHash) are decoded gracefully;
    ///         3D scores default to 0 in that case.
    ///
    ///         Gas budget (300 000 callback):
    ///           ~90 000 used here (3 cold SSTOREs: score, auditScores struct, hash + events)
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
        // Read finalScore from word 0
        uint256 score;
        assembly { score := mload(add(response, 32)) }
        if (score > 100) score = 100;

        fulfilledScore[projectId] = score + 1; // +1: score=0 ≠ unfulfilled=0

        // Read 3D breakdown from words 1-3 (if response is >= 128 bytes)
        uint8 reliability;
        uint8 quality;
        uint8 marketFit;
        if (response.length >= 128) {
            uint256 r; uint256 q; uint256 m;
            assembly {
                r := mload(add(response, 64))
                q := mload(add(response, 96))
                m := mload(add(response, 128))
            }
            if (r > 100) r = 100;
            if (q > 100) q = 100;
            if (m > 100) m = 100;
            reliability = uint8(r);
            quality     = uint8(q);
            marketFit   = uint8(m);
            s_auditScores[projectId] = AuditScores(reliability, quality, marketFit);
        }

        // Read contentHash from word 4 (bytes 128-159) or fallback to old word 1 (bytes 32-63)
        bytes32 contentHash;
        if (response.length >= 160) {
            assembly { contentHash := mload(add(response, 160)) }
        } else if (response.length >= 64) {
            // Backward-compatible: old 64-byte format (finalScore + contentHash)
            assembly { contentHash := mload(add(response, 64)) }
        }
        if (contentHash != bytes32(0)) {
            fulfilledHash[projectId] = contentHash;
        }

        emit AuditFulfilled(projectId, requestId, score, reliability, quality, marketFit, contentHash);
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
