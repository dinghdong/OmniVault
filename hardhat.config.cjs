require("dotenv/config");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-ethers");
const { HardhatUserConfig } = require("hardhat/types");

/** @type import('hardhat/types').HardhatUserConfig */
const config = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // 0G Galileo Testnet (actual chainId: 16602)
    zeroGTestnet: {
      url: "https://evmrpc-testnet.0g.ai",
      chainId: 16602,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
      gasPrice: "auto",
    },
  },
};

module.exports = config;
