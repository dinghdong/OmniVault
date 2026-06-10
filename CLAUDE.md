# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OmniVault is an AI-agent-driven decentralized VC fund platform. LPs deposit ETH into a vault that generates yield via AAVE V3 (ETH → WETH → aWETH), while multi-agent AI systems continuously audit Web3 projects seeking funding.

**v1 is ETH-only** — no USDC or other tokens. The vault wraps ETH to WETH, supplies to AAVE V3, and issues rebasing FundToken shares.

## Common Commands

```bash
# Frontend (Next.js 14)
cd frontend && npm run dev          # Dev server on port 3000
cd frontend && npm run build        # Production build
npm run lint                        # TypeScript type check (root)

# Smart Contracts (Hardhat)
npx hardhat compile                 # Compile all Solidity contracts
npx hardhat test                    # Run all Hardhat tests

# Local testnet (must be running already)
npx hardhat run scripts/deploy-and-test.ts --network localhost

# Deploy to live networks
npx hardhat run scripts/deploy.ts --network arbitrumSepolia
npx hardhat run scripts/deploy.ts --network arbitrumOne
```

### Running a local Hardhat node for contract testing

A background Hardhat node must be running on port 8545 before running `deploy-and-test.ts`:

```bash
# Terminal 1: start the node
npx hardhat node --port 8545

# Terminal 2: run the E2E test
npx hardhat run scripts/deploy-and-test.ts --network localhost
```

## Architecture

```
Frontend (Next.js/wagmi) ──► Arbitrum L2 ──────────────► Trustless Off-chain
     │                            │                            │
  ConnectKit/wagmi v2      FundVault (ETH-only)         Chainlink Functions DON
  @tanstack/react-query    FundToken (rebasing OVFT)    └─ chainlink/audit-source.js
                           InvestmentManager            0G Compute (TeeML LLM, 3D scores)
                           OmniOracle (CL Functions)    0G Storage (audit logs)
                           ScoringEngine (Stylus/Rust)
                           NFA · DeadManSwitch · RevenueShare
```

### Smart Contracts (`contracts/`)

| Contract | Purpose |
|----------|---------|
| `vault/FundVault.sol` | LP deposits raw ETH (no AAVE/WETH), redeem by shares, `divestForInvestment`, P&L via `addRealizedGains/Loss` |
| `vault/FundToken.sol` | Rebasing ERC-20 (aToken-like). `balanceOf = shares × accrualFactor`. Use `getShares()` for raw share count. |
| `investment/InvestmentManager.sol` | Project lifecycle: submit → settleAudit → timelock + LP veto → execute (20% upfront, 52w vesting) → exit/write-off |
| `oracle/OmniOracle.sol` | Chainlink Functions client; stores 3D scores + contentHash via sentinel encoding (`score+1`) |
| `identity/NonFungibleAgent.sol` | ERC-721 agent identity, on-chain DID: `did:nfa:{chainId}:{contract}:{tokenId}` |
| `governance/DeadManSwitch.sol` | Proof-of-life pings (30d + 30d grace); missed → `markWriteOff` on InvestmentManager |
| `revenue/RevenueShare.sol` | O(1) MasterChef-style ETH distribution to registered AI agents |
| `registry/PromptRegistry.sol` | On-chain prompt hash commitments |
| `audit/AuditTrail.sol` | Records AI audit decisions on-chain |
| `stylus/scoring-engine/` | Arbitrum Stylus (Rust→WASM) verifiable scoring: 40/30/30 weights, threshold 60 |

### Mock Contracts (`contracts/test/mocks/`)

For local testing without external dependencies:
- `MockWETH.sol` — Mintable WETH
- `MockAavePool.sol` — Simplified AAVE V3 Pool + `MockAToken`
- `MockFundVault.sol` — Test vault stub

### Frontend (`frontend/`)

- `pages/index.tsx` — Main vault UI (deposit/withdraw/stats)
- `hooks/contracts/` — Contract ABIs and addresses
- `hooks/useVaultTransactions.ts` — Deposit ETH, redeem by shares
- `hooks/useVaultStats.ts` — Vault balance queries
- `components/DepositModal.tsx` / `WithdrawModal.tsx` — Transaction modals

### AI Audit Flow

1. Project submits via `InvestmentManager.submitProject()`
2. `OmniOracle.requestAudit()` triggers Chainlink Functions
3. Multi-agent analysis: CodeAnalysis → RiskAssessment → BusinessAnalysis
4. Consensus engine aggregates scores (threshold: 80%)
5. `fulfillAudit()` stores result on-chain
6. If approved, `executeInvestment()` divests from vault and sends ETH to project

## Key Implementation Notes

### FundToken rebasing model

- `balanceOf(user)` returns `shares[user] × accrualFactor / 1e18` (ETH value)
- `getShares(user)` returns raw share count (fixed at deposit)
- `redeem(shares)` expects **raw shares**, NOT balance units — use `getShares()` or `totalSupply()` for the full redeem
- Passing `balanceOf()` to `redeem()` causes `shares × accrualFactor` overflow (panic 0x11)

### Vault gas requirement

After deposit, all ETH is converted to WETH and supplied to AAVE — the vault has 0 raw ETH. Redeem needs ETH for internal gas. In tests, use `hardhat_setBalance` to fund the vault:

```javascript
await hre.network.provider.request({
  method: 'hardhat_setBalance',
  params: [vaultAddr, '0x' + (ethers.parseEther('5')).toString(16)],
});
```

### Local test network config

Use `--network localhost` (not `--network hardhat`) to connect to the background node:

```javascript
// hardhat.config.cjs
networks: {
  hardhat: { chainId: 31337 },          // default in-memory node
  localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },  // background node
}
```

## Tech Stack

- **Frontend**: Next.js 14, wagmi v2, viem v2, ConnectKit, Zustand v5, Recharts
- **Smart Contracts**: Solidity 0.8.24, Hardhat, OpenZeppelin Contracts v5
- **Blockchain**: Arbitrum (mainnet + Sepolia testnet)
- **AI**: Gemini API via @google/genai, Express backend for AI service
- **Testing**: Hardhat (Mocha/Chai), ts-node for scripts