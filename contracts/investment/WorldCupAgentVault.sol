// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { INonFungibleAgent } from "../interfaces/INonFungibleAgent.sol";
import { MockPolyMarket } from "../test/mocks/MockPolyMarket.sol";

/// @title WorldCupAgentVault — domain-specific vault for AI sports betting agents
/// @notice Receives approved ETH from InvestmentManager, executes agent-signed
///         bets on MockPolyMarket, and distributes returns between OmniVault
///         and the agent after settlement.
contract WorldCupAgentVault is Ownable, ReentrancyGuard {
    enum BetOrderStatus { None, Funded, Executed, Settled, Cancelled }

    struct BetOrder {
        uint256 projectId;
        uint256 agentId;
        address agentOwner;
        address market;         // MockPolyMarket match address is referenced by matchId
        uint256 matchId;
        uint256 outcomeIndex;
        uint256 betAmount;
        uint256 minOdds;
        uint256 fundedAmount;
        uint256 returnAmount;
        uint256 agentShareBps;  // e.g. 3000 = 30%
        uint256 deadline;
        uint256 nonce;
        uint40 createdAt;
        uint40 executedAt;
        uint40 settledAt;
        BetOrderStatus status;
    }

    struct BetRequest {
        uint256 matchId;
        uint256 outcomeIndex;
        uint256 betAmount;
        uint256 minOdds;
        uint256 deadline;
        uint256 nonce;
    }

    address public investmentManager;
    INonFungibleAgent public nfa;
    MockPolyMarket public polyMarket;

    mapping(uint256 => BetOrder) public betOrders; // keyed by projectId

    uint256 public constant AGENT_MAX_SHARE_BPS = 5000; // 50%

    event BetOrderCreated(
        uint256 indexed projectId,
        uint256 indexed agentId,
        uint256 matchId,
        uint256 outcomeIndex,
        uint256 betAmount
    );
    event BetExecuted(uint256 indexed projectId, uint256 matchId, uint256 outcomeIndex, uint256 amount);
    event BetSettled(uint256 indexed projectId, uint256 returnAmount, uint256 agentShare, uint256 vaultShare);

    error Unauthorized();
    error InvalidStatus();
    error InvalidOutcome();
    error OddsTooLow();
    error BetExpired();
    error InvalidSignature();
    error AlreadySettled();
    error ShareTooHigh();

    constructor(address _investmentManager, address _nfa, address payable _polyMarket) Ownable(msg.sender) {
        investmentManager = _investmentManager;
        nfa = INonFungibleAgent(_nfa);
        polyMarket = MockPolyMarket(_polyMarket);
    }

    modifier onlyInvestmentManager() {
        if (msg.sender != investmentManager) revert Unauthorized();
        _;
    }

    /// @notice Called by InvestmentManager after project approval. Creates a BetOrder.
    function createBetOrder(
        uint256 projectId,
        uint256 agentId,
        uint256 fundedAmount,
        bytes calldata initData
    ) external onlyInvestmentManager {
        if (betOrders[projectId].status != BetOrderStatus.None) revert InvalidStatus();

        BetRequest memory req = abi.decode(initData, (BetRequest));
        if (req.outcomeIndex > 2) revert InvalidOutcome();
        if (req.betAmount > fundedAmount) revert InvalidStatus();

        address agentOwner = nfa.ownerOf(agentId);

        betOrders[projectId] = BetOrder({
            projectId: projectId,
            agentId: agentId,
            agentOwner: agentOwner,
            market: address(polyMarket),
            matchId: req.matchId,
            outcomeIndex: req.outcomeIndex,
            betAmount: req.betAmount,
            minOdds: req.minOdds,
            fundedAmount: fundedAmount,
            returnAmount: 0,
            agentShareBps: 3000, // default 30% to agent
            deadline: req.deadline,
            nonce: req.nonce,
            createdAt: uint40(block.timestamp),
            executedAt: 0,
            settledAt: 0,
            status: BetOrderStatus.Funded
        });

        emit BetOrderCreated(projectId, agentId, req.matchId, req.outcomeIndex, req.betAmount);
    }

    /// @notice Agent (or keeper) executes the bet with an EIP-712-style signature.
    function executeBetOrder(uint256 projectId, bytes calldata signature) external nonReentrant {
        BetOrder storage b = betOrders[projectId];
        if (b.status != BetOrderStatus.Funded) revert InvalidStatus();
        if (block.timestamp > b.deadline) revert BetExpired();

        // Verify signature over the bet request
        bytes32 payloadHash = keccak256(abi.encode(
            b.matchId,
            b.outcomeIndex,
            b.betAmount,
            b.minOdds,
            b.deadline,
            b.nonce
        ));
        if (!_verifySignature(b.agentOwner, payloadHash, signature)) revert InvalidSignature();

        // Check odds on market
        uint256 actualOdds = polyMarket.getOdds(b.matchId, b.outcomeIndex);
        if (actualOdds < b.minOdds) revert OddsTooLow();

        b.status = BetOrderStatus.Executed;
        b.executedAt = uint40(block.timestamp);

        polyMarket.placeBet{value: b.betAmount}(b.matchId, b.outcomeIndex);

        emit BetExecuted(projectId, b.matchId, b.outcomeIndex, b.betAmount);
    }

    /// @notice Redeem from PolyMarket and split returns between OmniVault and agent.
    function settleBetOrder(uint256 projectId) external nonReentrant {
        BetOrder storage b = betOrders[projectId];
        if (b.status != BetOrderStatus.Executed) revert InvalidStatus();

        uint256 payout = polyMarket.redeem(b.matchId);
        uint256 funded = b.fundedAmount;
        uint256 agentShare = 0;
        uint256 vaultShare = payout > funded ? ((payout - funded) * b.agentShareBps) / 10_000 : 0;

        if (payout > funded) {
            agentShare = vaultShare;
            vaultShare = payout - agentShare;
        } else {
            vaultShare = payout;
        }

        b.returnAmount = payout;
        b.status = BetOrderStatus.Settled;
        b.settledAt = uint40(block.timestamp);

        // Send agent share
        if (agentShare > 0) {
            (bool ok2, ) = b.agentOwner.call{value: agentShare}("");
            require(ok2, "agent share transfer failed");
        }

        // Return principal + OmniVault profit to InvestmentManager, which forwards to FundVault
        (bool ok1, ) = investmentManager.call{value: vaultShare}(
            abi.encodeWithSignature("reportSettlement(uint256,uint256)", projectId, vaultShare)
        );
        require(ok1, "vault share transfer failed");

        emit BetSettled(projectId, payout, agentShare, vaultShare);
    }

    function setAgentShare(uint256 projectId, uint256 shareBps) external onlyOwner {
        if (shareBps > AGENT_MAX_SHARE_BPS) revert ShareTooHigh();
        BetOrder storage b = betOrders[projectId];
        if (b.status != BetOrderStatus.None && b.status != BetOrderStatus.Funded)
            revert InvalidStatus();
        b.agentShareBps = shareBps;
    }

    function _verifySignature(address signer, bytes32 payloadHash, bytes memory signature)
        internal pure
        returns (bool)
    {
        if (signature.length != 65) return false;
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash));
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        address recovered = ecrecover(ethSignedHash, v, r, s);
        return recovered != address(0) && recovered == signer;
    }

    receive() external payable {}
}
