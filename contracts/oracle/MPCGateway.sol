// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MPCGateway — Manages secrets and API keys for AI audit services
/// @notice Stores encrypted service endpoints and provides access-controlled
///         secret retrieval for Chainlink Functions calls.
/// @dev In production, MPC would involve threshold cryptography across
///      distributed key shares. Here we implement the on-chain gateway
///      that manages secrets references and access policies.
contract MPCGateway is Ownable, AccessControl {
    // ─── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant AUDIT_SERVICE_ADMIN_ROLE =
        keccak256("AUDIT_SERVICE_ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    // ─── Service Configuration ─────────────────────────────────────────────────
    struct ServiceConfig {
        string endpoint;       // Base URL for the service
        bytes32 secretRef;     // Reference hash to off-chain encrypted secret
        bool isActive;
        uint256 rateLimit;     // Max requests per hour
        uint256 usedThisHour;  // Counter for rate limiting
    }

    // ─── State ─────────────────────────────────────────────────────────────────
    // serviceId -> ServiceConfig
    mapping(bytes32 => ServiceConfig) public services;

    // authorized caller -> whether they can request secrets
    mapping(address => bool) public authorizedCallers;

    // Project-based rate limiting: projectId -> requestsThisHour
    mapping(uint256 => uint256) public projectRateLimit;
    mapping(uint256 => uint256) public projectRateLimitReset;

    // ─── Events ────────────────────────────────────────────────────────────────
    event ServiceConfigUpdated(
        bytes32 indexed serviceId,
        string endpoint,
        bytes32 secretRef,
        bool isActive
    );
    event CallerAuthorized(address indexed caller, bool authorized);
    event SecretRequested(
        address indexed caller,
        bytes32 indexed serviceId,
        uint256 indexed projectId
    );
    event RateLimitExceeded(
        uint256 indexed projectId,
        uint256 currentCount,
        uint256 limit
    );

    // ─── Errors ─────────────────────────────────────────────────────────────────
    error ServiceNotFound(bytes32 serviceId);
    error ServiceInactive(bytes32 serviceId);
    error CallerNotAuthorized(address caller);
    error RateLimitExceededError(uint256 projectId);

    /// @notice Constructor
    /// @param initialOwner The initial owner/admin
    constructor(address initialOwner) Ownable(initialOwner) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
    }

    // ─── Service Configuration ─────────────────────────────────────────────────

    /// @notice Register or update a service configuration
    /// @param serviceId Unique identifier for the service (e.g., keccak256("openai"))
    /// @param endpoint The API endpoint URL
    /// @param secretRef Off-chain reference to the encrypted API key
    /// @param rateLimit Max requests per hour
    function setServiceConfig(
        bytes32 serviceId,
        string calldata endpoint,
        bytes32 secretRef,
        uint256 rateLimit
    ) external onlyOwner {
        services[serviceId] = ServiceConfig({
            endpoint: endpoint,
            secretRef: secretRef,
            isActive: true,
            rateLimit: rateLimit,
            usedThisHour: 0
        });

        emit ServiceConfigUpdated(serviceId, endpoint, secretRef, true);
    }

    /// @notice Deactivate a service (without removing config)
    function deactivateService(bytes32 serviceId) external onlyOwner {
        if (services[serviceId].rateLimit == 0) revert ServiceNotFound(serviceId);
        services[serviceId].isActive = false;
        emit ServiceConfigUpdated(serviceId, services[serviceId].endpoint, services[serviceId].secretRef, false);
    }

    /// @notice Activate a previously deactivated service
    function activateService(bytes32 serviceId) external onlyOwner {
        if (services[serviceId].rateLimit == 0) revert ServiceNotFound(serviceId);
        services[serviceId].isActive = true;
        emit ServiceConfigUpdated(serviceId, services[serviceId].endpoint, services[serviceId].secretRef, true);
    }

    // ─── Access Control ─────────────────────────────────────────────────────────

    /// @notice Authorize or deauthorize a caller to request secrets
    function setCallerAuthorization(address caller, bool authorized)
        external
        onlyOwner
    {
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    /// @notice Grant ORACLE_ROLE to OmniOracle contract
    function grantOracleRole(address oracleContract) external onlyOwner {
        _grantRole(ORACLE_ROLE, oracleContract);
    }

    // ─── Secret Retrieval (for Chainlink Functions) ──────────────────────────────

    /// @notice Get service configuration for a given service ID
    /// @dev Only authorized callers (OmniOracle) can retrieve secrets
    function getServiceConfig(bytes32 serviceId)
        external
        view
        returns (
            string memory endpoint,
            bytes32 secretRef,
            bool isActive
        )
    {
        if (services[serviceId].rateLimit == 0) revert ServiceNotFound(serviceId);
        if (!authorizedCallers[msg.sender] && !hasRole(ORACLE_ROLE, msg.sender))
            revert CallerNotAuthorized(msg.sender);

        ServiceConfig memory config = services[serviceId];
        return (config.endpoint, config.secretRef, config.isActive);
    }

    /// @notice Get CBOR-encoded secrets for Chainlink Functions
    /// @dev Returns the secretRef formatted for Chainlink's secrets mechanism
    function getSecretsForService(bytes32 serviceId, uint256 projectId)
        external
        returns (bytes memory secretsCBOR)
    {
        if (services[serviceId].rateLimit == 0) revert ServiceNotFound(serviceId);
        if (!services[serviceId].isActive) revert ServiceInactive(serviceId);
        if (!authorizedCallers[msg.sender] && !hasRole(ORACLE_ROLE, msg.sender))
            revert CallerNotAuthorized(msg.sender);

        // Check rate limit
        _checkRateLimit(projectId, services[serviceId].rateLimit);

        // In production, this would return the actual encrypted secret from off-chain storage
        // For now, we return a reference that Chainlink Functions would use to fetch
        bytes32 secretRef = services[serviceId].secretRef;

        // Encode as CBOR for Chainlink Functions
        // Format: { "secretRef": <bytes32>, "serviceId": <bytes32> }
        secretsCBOR = abi.encode(secretRef, serviceId);

        emit SecretRequested(msg.sender, serviceId, projectId);
    }

    // ─── Rate Limiting ───────────────────────────────────────────────────────────

    /// @notice Check and enforce rate limits per project
    function _checkRateLimit(uint256 projectId, uint256 limit) internal {
        uint256 currentHour = block.timestamp / 3600;

        // Reset counter if hour changed
        if (projectRateLimitReset[projectId] != currentHour) {
            projectRateLimit[projectId] = 0;
            projectRateLimitReset[projectId] = currentHour;
        }

        if (projectRateLimit[projectId] >= limit) {
            emit RateLimitExceeded(projectId, projectRateLimit[projectId], limit);
            revert RateLimitExceededError(projectId);
        }

        projectRateLimit[projectId]++;
    }

    /// @notice Get remaining rate limit for a project
    function getRemainingRateLimit(uint256 projectId, bytes32 serviceId)
        external
        view
        returns (uint256 remaining)
    {
        uint256 currentHour = block.timestamp / 3600;
        uint256 used = projectRateLimit[projectId];
        if (projectRateLimitReset[projectId] != currentHour) {
            used = 0;
        }
        uint256 limit = services[serviceId].rateLimit;
        return used >= limit ? 0 : limit - used;
    }

    // ─── Utility ────────────────────────────────────────────────────────────────

    /// @notice Get all registered service IDs
    /// @dev View function - in production, would use an array or events for enumeration
    function isServiceActive(bytes32 serviceId) external view returns (bool) {
        return services[serviceId].isActive;
    }

    /// @notice Batch authorize multiple callers
    function batchSetCallerAuthorization(address[] calldata callers, bool authorized)
        external
        onlyOwner
    {
        for (uint256 i = 0; i < callers.length; i++) {
            authorizedCallers[callers[i]] = authorized;
            emit CallerAuthorized(callers[i], authorized);
        }
    }
}