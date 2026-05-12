// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFundVault
interface IFundVault {
    function WETH() external view returns (address);
    function fundToken() external view returns (address);
    function deposit() external payable returns (uint256 shares);
    function redeem(uint256 shares) external returns (uint256 assets);
    function divestForInvestment(uint256 amount) external;
    function addRealizedGains(uint256 proceeds, uint256 originalAmount) external;
    function addRealizedLoss(uint256 recoveredAmount, uint256 originalAmount) external;
    function balanceOf(address lp) external view returns (uint256);
}
