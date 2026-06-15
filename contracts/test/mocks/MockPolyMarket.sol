// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockPolyMarket — simulated prediction market for World Cup demo
contract MockPolyMarket {
    enum MatchStatus { Open, Resolved, Cancelled }

    struct Match {
        string home;
        string away;
        uint256 homeOdds;     // 18-decimal odds, e.g. 2.5e18
        uint256 drawOdds;
        uint256 awayOdds;
        uint256 expiration;   // unix timestamp
        uint256 totalPool;
        int8    outcome;      // -1 = unresolved, 0 = home, 1 = draw, 2 = away
        MatchStatus status;
    }

    struct Bet {
        uint256 amount;
        uint256 outcomeIndex;
        bool redeemed;
    }

    mapping(uint256 => Match) public matches;
    mapping(uint256 => mapping(address => Bet)) public bets;
    uint256 public matchCount;

    address public admin;

    event MatchCreated(
        uint256 indexed matchId,
        string home,
        string away,
        uint256 homeOdds,
        uint256 drawOdds,
        uint256 awayOdds,
        uint256 expiration
    );
    event BetPlaced(uint256 indexed matchId, address indexed bettor, uint256 outcomeIndex, uint256 amount);
    event MatchResolved(uint256 indexed matchId, uint256 outcomeIndex);
    event Redeemed(uint256 indexed matchId, address indexed bettor, uint256 payout);

    error InvalidMatch();
    error MatchExpired();
    error MatchNotResolved();
    error AlreadyRedeemed();
    error InvalidOutcome();
    error NotAdmin();

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function createMatch(
        string calldata home,
        string calldata away,
        uint256 homeOdds,
        uint256 drawOdds,
        uint256 awayOdds,
        uint256 expiration
    ) external onlyAdmin returns (uint256 matchId) {
        matchId = ++matchCount;
        matches[matchId] = Match({
            home: home,
            away: away,
            homeOdds: homeOdds,
            drawOdds: drawOdds,
            awayOdds: awayOdds,
            expiration: expiration,
            totalPool: 0,
            outcome: -1,
            status: MatchStatus.Open
        });
        emit MatchCreated(matchId, home, away, homeOdds, drawOdds, awayOdds, expiration);
    }

    function placeBet(uint256 matchId, uint256 outcomeIndex) external payable {
        Match storage m = matches[matchId];
        if (m.status != MatchStatus.Open) revert InvalidMatch();
        if (block.timestamp > m.expiration) revert MatchExpired();
        if (outcomeIndex > 2) revert InvalidOutcome();
        if (msg.value == 0) revert InvalidMatch();

        bets[matchId][msg.sender] = Bet({
            amount: msg.value,
            outcomeIndex: outcomeIndex,
            redeemed: false
        });
        m.totalPool += msg.value;

        emit BetPlaced(matchId, msg.sender, outcomeIndex, msg.value);
    }

    function resolveMatch(uint256 matchId, uint256 outcomeIndex) external onlyAdmin {
        Match storage m = matches[matchId];
        if (m.status != MatchStatus.Open) revert InvalidMatch();
        if (outcomeIndex > 2) revert InvalidOutcome();

        m.outcome = int8(uint8(outcomeIndex));
        m.status = MatchStatus.Resolved;
        emit MatchResolved(matchId, outcomeIndex);
    }

    function getOdds(uint256 matchId, uint256 outcomeIndex) public view returns (uint256) {
        Match storage m = matches[matchId];
        if (outcomeIndex == 0) return m.homeOdds;
        if (outcomeIndex == 1) return m.drawOdds;
        if (outcomeIndex == 2) return m.awayOdds;
        revert InvalidOutcome();
    }

    function pendingPayout(uint256 matchId, address bettor) public view returns (uint256) {
        Match storage m = matches[matchId];
        Bet storage b = bets[matchId][bettor];
        if (b.amount == 0 || b.redeemed) return 0;
        if (m.status != MatchStatus.Resolved) return 0;
        if (uint8(m.outcome) != b.outcomeIndex) return 0;

        uint256 odds = getOdds(matchId, b.outcomeIndex);
        return (b.amount * odds) / 1e18;
    }

    function redeem(uint256 matchId) external returns (uint256 payout) {
        Match storage m = matches[matchId];
        if (m.status != MatchStatus.Resolved) revert MatchNotResolved();

        Bet storage b = bets[matchId][msg.sender];
        if (b.amount == 0) revert InvalidMatch();
        if (b.redeemed) revert AlreadyRedeemed();

        payout = pendingPayout(matchId, msg.sender);
        b.redeemed = true;

        if (payout > 0) {
            (bool ok, ) = msg.sender.call{value: payout}("");
            require(ok, "payout failed");
        }

        emit Redeemed(matchId, msg.sender, payout);
    }

    receive() external payable {}
}
