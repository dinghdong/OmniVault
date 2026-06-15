// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { INonFungibleAgent } from "../interfaces/INonFungibleAgent.sol";

/**
 * @title  NonFungibleAgent (NFA)
 * @notice On-chain identity token for AI agents in the OmniVault A2A ecosystem.
 *
 *   Each NFA token represents a unique, transferable AI agent identity.
 *   The agent's W3C DID is auto-derived on-chain:
 *       did:nfa:{chainId}:{contractAddress}:{tokenId}
 *
 *   Any wallet may mint an agent identity. Transferring the token transfers
 *   control of the agent identity to the new owner.
 *
 * @dev    ERC-721 with on-chain metadata (no tokenURI / IPFS required).
 */
contract NonFungibleAgent is ERC721, INonFungibleAgent {
    // ── Structs ───────────────────────────────────────────────────────────────

    // ── State ─────────────────────────────────────────────────────────────────

    mapping(uint256 => INonFungibleAgent.AgentMeta) private _agents;
    uint256 private _nextId;

    // ── Events ────────────────────────────────────────────────────────────────

    event AgentMinted(
        uint256 indexed tokenId,
        address indexed owner,
        string  did,
        string  repo,
        string  model,
        bytes32 teeMrenclave
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() ERC721("NonFungibleAgent", "NFA") {}

    // ── External ──────────────────────────────────────────────────────────────

    /**
     * @notice Mint a new agent identity NFT to the caller.
     * @param  repo          Source code repository URL (stored on-chain)
     * @param  apiEndpoint   REST/gRPC endpoint for A2A calls
     * @param  model         AI model identifier string
     * @param  teeMrenclave  Expected TEE enclave measurement hash
     * @param  teePublicKey  Public key whose private key lives in the TEE
     * @return tokenId       Newly minted token ID (starts at 1)
     */
    function mint(
        string calldata repo,
        string calldata apiEndpoint,
        string calldata model,
        bytes32 teeMrenclave,
        bytes   calldata teePublicKey
    ) external returns (uint256 tokenId) {
        tokenId = ++_nextId;
        _safeMint(msg.sender, tokenId);
        _agents[tokenId] = AgentMeta({
            repo:         repo,
            apiEndpoint:  apiEndpoint,
            model:        model,
            teeMrenclave: teeMrenclave,
            teePublicKey: teePublicKey,
            mintedAt:     block.timestamp
        });
        emit AgentMinted(tokenId, msg.sender, getDid(tokenId), repo, model, teeMrenclave);
    }

    /**
     * @notice Return the stored metadata for `tokenId`.
     * @dev    Reverts if token does not exist.
     */
    function getAgent(uint256 tokenId)
        external
        view
        override
        returns (INonFungibleAgent.AgentMeta memory)
    {
        _requireOwned(tokenId);
        return _agents[tokenId];
    }

    /// @notice ERC-721 ownerOf exposed through the INonFungibleAgent interface.
    function ownerOf(uint256 tokenId)
        public
        view
        override(ERC721, INonFungibleAgent)
        returns (address)
    {
        return super.ownerOf(tokenId);
    }

    /**
     * @notice Derive the W3C-style DID for `tokenId`.
     *         Format: did:nfa:{chainId}:{contractAddress}:{tokenId}
     */
    function getDid(uint256 tokenId) public view returns (string memory) {
        _requireOwned(tokenId);
        return string(abi.encodePacked(
            "did:nfa:",
            _uintToString(block.chainid),
            ":",
            _addressToHex(address(this)),
            ":",
            _uintToString(tokenId)
        ));
    }

    /**
     * @notice Total number of agents minted (including burned, if any).
     */
    function totalSupply() external view returns (uint256) {
        return _nextId;
    }

    /**
     * @notice Convenience: returns all token IDs owned by `owner` (O(n), UI-only).
     */
    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        uint256 count = balanceOf(owner);
        uint256[] memory ids = new uint256[](count);
        uint256 found;
        for (uint256 i = 1; i <= _nextId && found < count; i++) {
            if (_ownerOf(i) == owner) {
                ids[found++] = i;
            }
        }
        return ids;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _uintToString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v;
        uint256 len;
        while (tmp != 0) { len++; tmp /= 10; }
        bytes memory buf = new bytes(len);
        while (v != 0) {
            buf[--len] = bytes1(uint8(48 + v % 10));
            v /= 10;
        }
        return string(buf);
    }

    function _addressToHex(address a) internal pure returns (string memory) {
        bytes memory raw = abi.encodePacked(a);
        bytes memory hex_ = new bytes(42);
        hex_[0] = '0';
        hex_[1] = 'x';
        for (uint256 i = 0; i < 20; i++) {
            hex_[2 + i * 2]     = _hexChar(uint8(raw[i]) >> 4);
            hex_[2 + i * 2 + 1] = _hexChar(uint8(raw[i]) & 0x0f);
        }
        return string(hex_);
    }

    function _hexChar(uint8 v) internal pure returns (bytes1) {
        return v < 10 ? bytes1(v + 48) : bytes1(v + 87);
    }
}
