// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PromptRegistry
/// @notice Stores prompt commitments (SHA-256 hashes) on-chain.
///         Full prompt text is stored off-chain and pushed to DON at audit time.
contract PromptRegistry is Ownable {

    struct PromptEntry {
        bytes32 commitment;   // SHA-256 hash of the full prompt text
        string name;          // Human-readable name (e.g. "audit-v2.3")
        uint256 version;      // Version number for this prompt ID
        uint256 activeFrom;   // Timestamp when activated
        bool isActive;       // Currently active version
    }

    mapping(bytes32 => PromptEntry) public prompts;
    bytes32 public activePromptId;

    event PromptRegistered(bytes32 indexed promptId, string name, bytes32 commitment);
    event PromptActivated(bytes32 indexed promptId);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Register a new prompt version (owner only)
    function registerPrompt(
        bytes32 promptId,
        bytes32 commitment,
        string calldata name
    ) external onlyOwner {
        prompts[promptId] = PromptEntry({
            commitment: commitment,
            name: name,
            version: prompts[promptId].version + 1,
            activeFrom: block.timestamp,
            isActive: false
        });
        emit PromptRegistered(promptId, name, commitment);
    }

    /// @notice Activate a registered prompt version (owner only)
    function activatePrompt(bytes32 promptId) external onlyOwner {
        if (activePromptId != bytes32(0)) {
            prompts[activePromptId].isActive = false;
        }
        prompts[promptId].isActive = true;
        activePromptId = promptId;
        emit PromptActivated(promptId);
    }

    /// @notice Verify off-chain prompt content against on-chain commitment
    function verifyPrompt(bytes32 promptId, string calldata promptContent)
        external
        view
        returns (bool)
    {
        return prompts[promptId].commitment ==
            sha256(abi.encodePacked(promptContent));
    }
}
