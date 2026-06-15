// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface INonFungibleAgent {
    struct AgentMeta {
        string repo;
        string apiEndpoint;
        string model;
        bytes32 teeMrenclave;
        bytes teePublicKey;
        uint256 mintedAt;
    }

    function mint(
        string calldata repo,
        string calldata apiEndpoint,
        string calldata model,
        bytes32 teeMrenclave,
        bytes calldata teePublicKey
    ) external returns (uint256 tokenId);

    function ownerOf(uint256 tokenId) external view returns (address);
    function getAgent(uint256 tokenId) external view returns (AgentMeta memory);
    function getDid(uint256 tokenId) external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function tokensOfOwner(address owner) external view returns (uint256[] memory);
}
