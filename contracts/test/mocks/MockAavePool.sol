// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MockWETH} from "./MockWETH.sol";

/// @title MockAavePool — Simplified AAVE V3 Pool for local testing
/// @notice Tracks deposits and mints aToken 1:1. No interest accrual for simplicity.
contract MockAavePool {
    // aToken per underlying asset
    mapping(address => address) public aTokens;

    // depositor -> amount
    mapping(address => mapping(address => uint256)) public deposits;

    function setAToken(address asset, address aToken) external {
        aTokens[asset] = aToken;
    }

    /// @notice Supply assets, receive aToken 1:1
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /* referralCode */
    ) external {
        require(aTokens[asset] != address(0), "aToken not set");

        ERC20(asset).transferFrom(msg.sender, address(this), amount);
        MockAToken(aTokens[asset]).mint(onBehalfOf, amount);
        deposits[asset][onBehalfOf] += amount;
    }

    /// @notice Withdraw assets, burn aToken 1:1
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        require(aTokens[asset] != address(0), "aToken not set");
        MockAToken(aTokens[asset]).burn(msg.sender, amount);
        ERC20(asset).transfer(to, amount);
        return amount;
    }
}

/// @title MockAToken — Simplified aToken (no yield accrual for local testing)
contract MockAToken is ERC20 {
    address public immutable pool;
    address public immutable underlying;

    constructor(address _pool, address _underlying) ERC20("Aave WETH", "aWETH") {
        pool = _pool;
        underlying = _underlying;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == pool, "only pool");
        _mint(to, amount);
    }

    /// @notice Test-only: mint without pool check
    function mintForTest(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == pool, "only pool");
        _burn(from, amount);
    }
}
