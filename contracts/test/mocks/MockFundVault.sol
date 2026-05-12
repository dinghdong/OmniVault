// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IFundVault } from "../../interfaces/IFundVault.sol";
import { IWETH } from "../../interfaces/IWETH.sol";

/// @title MockFundVault — Minimal mock for InvestmentManager tests
contract MockFundVault is IFundVault {
    address public immutable FUND_TOKEN;
    address public immutable WETH_ADDR;

    constructor(address _fundToken, address _weth) {
        FUND_TOKEN = _fundToken;
        WETH_ADDR = _weth;
    }

    function WETH() external view returns (address) {
        return WETH_ADDR;
    }

    function fundToken() external view returns (address) {
        return FUND_TOKEN;
    }

    function deposit() external payable returns (uint256 shares) {
        return msg.value;
    }

    function redeem(uint256 shares) external pure returns (uint256 assets) {
        return shares;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function divestForInvestment(uint256 /* amount */ ) external pure {
        // no-op for mock
    }

    function addRealizedGains(uint256 /* proceeds */ , uint256 /* originalAmount */ ) external pure {
        // no-op for mock
    }

    function addRealizedLoss(uint256 /* recoveredAmount */ , uint256 /* originalAmount */ ) external pure {
        // no-op for mock
    }
}
