// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/vault/FundToken.sol";
import "../contracts/vault/FundVault.sol";
import "../contracts/investment/InvestmentManager.sol";
import "../contracts/registry/PromptRegistry.sol";
import "../contracts/audit/AuditTrail.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // ─── Arbitrum Mainnet Addresses ───────────────────────────────────
        address usdc = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
        address aavePool = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
        address aUsdc = 0x625E7708f30cA75bfd92586e17077590C60eb4cD;

        // ─── Deploy Core Contracts ─────────────────────────────────────────
        FundToken fundToken = new FundToken();
        console.log("FundToken deployed at:", address(fundToken));

        FundVault fundVault = new FundVault(usdc, aavePool, aUsdc, address(fundToken));
        console.log("FundVault deployed at:", address(fundVault));

        InvestmentManager investmentManager = new InvestmentManager(address(fundVault));
        console.log("InvestmentManager deployed at:", address(investmentManager));

        // ─── Configure Roles ──────────────────────────────────────────────
        FundToken.MINTER_ROLE();
        FundToken.BURNER_ROLE();

        fundToken.grantRole(fundToken.MINTER_ROLE(), address(fundVault));
        fundToken.grantRole(fundToken.BURNER_ROLE(), address(fundVault));
        console.log("FundVault granted MINTER and BURNER roles on FundToken");

        FundVault.INVESTOR_ROLE();
        fundVault.grantRole(fundVault.INVESTOR_ROLE(), address(investmentManager));
        console.log("InvestmentManager granted INVESTOR_ROLE on FundVault");

        vm.stopBroadcast();
    }
}
