// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IFundVault } from "../../interfaces/IFundVault.sol";

/// @title MockFundVault — Minimal mock for InvestmentManager tests
contract MockFundVault is IFundVault {
    address public immutable FUND_TOKEN;
    uint256 private _fakeBalance;

    constructor(address _fundToken) {
        FUND_TOKEN = _fundToken;
    }

    receive() external payable {}

    function setFakeBalance(uint256 amount) external { _fakeBalance = amount; }

    function fundToken() external view returns (address) { return FUND_TOKEN; }
    function vaultBalance() external view returns (uint256) { return address(this).balance; }

    function deposit() external payable returns (uint256 shares) { return msg.value; }
    function redeem(uint256 shares) external pure returns (uint256 assets) { return shares; }
    function balanceOf(address) external view returns (uint256) { return _fakeBalance; }

    function divestForInvestment(uint256 amount) external {
        // Send ETH to caller (simulates vault paying out)
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "MockFundVault: transfer failed");
    }

    function addRealizedGains(uint256, uint256) external payable {}
    function addRealizedLoss(uint256, uint256) external payable {}
}
