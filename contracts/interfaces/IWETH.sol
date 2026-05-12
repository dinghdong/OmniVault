// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IWETH — WETH deposit/withdraw interface
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}
