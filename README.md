# OmniVault

**AI-Powered Decentralized Venture Capital — Built for Arbitrum**

> OmniVault is a decentralized VC fund where LP capital is managed by multi-agent AI systems that audit Web3 projects 24/7. Every investment decision is verifiable on-chain, every audit score is computed by a Chainlink DON calling 0G Compute, and every fund movement is enforced by smart contracts — no human gatekeepers.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [3D AI Scoring Model](#3d-ai-scoring-model)
4. [Smart Contracts](#smart-contracts)
5. [A2A Audit Flow](#a2a-audit-flow)
6. [LP Mechanics](#lp-mechanics)
7. [Investment Lifecycle](#investment-lifecycle)
8. [Governance & Safety](#governance--safety)
9. [Deployed Contracts (Arbitrum Sepolia)](#deployed-contracts-arbitrum-sepolia)
10. [Setup & Development](#setup--development)
11. [Testing](#testing)
12. [Demo Agent](#demo-agent)
13. [Project Structure](#project-structure)

---

## Overview

OmniVault removes human bias from venture capital. AI agents conduct independent due diligence and submit scores on-chain via Chainlink Functions. A **Rust/Wasm ScoringEngine** (Arbitrum Stylus) verifies the weighted formula. Reports are stored immutably on **0G Storage**.

**Key properties:**

| Property | Mechanism |
|---|---|
| ETH-only vault | LP deposits held as raw ETH, no AAVE |
| 3D AI scoring | Reliability (40%) + Quality (30%) + Market Fit (30%) |
| Chainlink DON | `audit-source.js` calls 0G Compute → returns 160-byte result |
| Stylus verification | `ScoringEngine.sol` (Rust/Wasm) enforces weighted formula |
| Two-tx audit | `submitProject()` → oracle callback → `settleAudit()` |
| A2A provenance | Every submission carries `agentDid`, `agentRepo`, `agentApiEndpoint` |
| Timelock execution | 3-minute timelock before `executeInvestment()` |
| LP veto window | Community can veto any investment before execution |
| Revenue sharing | MasterChef-style O(1) distribution to LPs |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Frontend  (Next.js 14)                       │
│  LP Dashboard │ AI Audit Pipeline │ Apply (A2A) │ Portfolio       │
└──────────────────────────┬───────────────────────────────────────┘
               wagmi v2 / viem / ConnectKit
┌──────────────────────────▼───────────────────────────────────────┐
│                    Arbitrum (Sepolia / One)                        │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │  FundVault   │  │  FundToken   │  │  InvestmentManager    │   │
│  │  ETH-only    │  │  Rebasing    │  │  Project lifecycle    │   │
│  │  no AAVE     │  │  ERC-20      │  │  settleAudit / exec   │   │
│  └──────────────┘  └──────────────┘  └───────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │  OmniOracle  │  │ScoringEngine │  │   RevenueShare        │   │
│  │  Chainlink   │  │Arbitrum      │  │   MasterChef O(1)     │   │
│  │  Functions   │  │Stylus (Rust) │  │   distribution        │   │
│  └──────────────┘  └──────────────┘  └───────────────────────┘   │
└──────────────────────────┬───────────────────────────────────────┘
         Chainlink DON → audit-source.js
┌──────────────────────────▼───────────────────────────────────────┐
│                      0G Network / External                         │
│  0G Compute  (DeepSeek-V3 / Qwen3 — AI scoring inference)        │
│  0G Storage  (immutable audit report archives)                    │
│  Chainlink Functions DON (trustless off-chain compute)            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3D AI Scoring Model

OmniVault uses a three-dimensional scoring model that replaces the old single `auditScore`:

| Dimension | Weight | Description |
|---|---|---|
| **Reliability** | 40% | Smart contract security, code quality, test coverage |
| **Quality** | 30% | Implementation completeness, architecture soundness |
| **Market Fit** | 30% | Business model viability, tokenomics, competitive moat |

**Weighted formula:**

```
finalScore = (reliability × 4000 + quality × 3000 + marketFit × 3000) / 10000
```

This formula is enforced on-chain by the **ScoringEngine** (Arbitrum Stylus, Rust/Wasm).

### Chainlink Oracle Response Format

The `audit-source.js` script returns a 160-byte ABI-encoded payload:

| Offset | Word | Field | Type |
|---|---|---|---|
| 0 | Word 0 | `finalScore` | uint256 (0–100) |
| 32 | Word 1 | `reliabilityScore` | uint256 (0–100) |
| 64 | Word 2 | `qualityScore` | uint256 (0–100) |
| 96 | Word 3 | `marketFitScore` | uint256 (0–100) |
| 128 | Word 4 | `contentHash` | bytes32 (0G Storage root) |

---

## Smart Contracts

### `vault/FundVault.sol`

ETH-only LP vault. No AAVE, no WETH wrapping.

- `deposit()` — payable, mints FundToken shares
- `redeem(shares)` — burns shares, returns ETH pro-rata
- `vaultBalance()` — returns `address(this).balance`

### `vault/FundToken.sol`

Rebasing ERC-20 modelled after aTokens.

- `balanceOf(user) = shares[user] × accrualFactor / 1e18`
- `getShares(user)` — raw share count (fixed at deposit)
- `accrualFactor` rises as AI investments return proceeds to vault

### `investment/InvestmentManager.sol`

Full project lifecycle: submission → oracle → settle → timelock → execution.

| Function | Access | Description |
|---|---|---|
| `submitProject(commitHash, contractAddr, bizApi, requestedAmount, agentDid, agentRepo, agentApiEndpoint)` | public | Opens a new project slot with A2A provenance |
| `settleAudit(projectId)` | permissionless | Reads oracle result, updates project status |
| `executeInvestment(projectId, amount, data)` | permissionless (after timelock) | Sends ETH to funded project |
| `getAuditScores(projectId)` | view | Returns `(finalScore, reliability, quality, marketFit)` |
| `scoreThreshold()` | view | Minimum finalScore to pass (default: 60) |
| `EXECUTION_DELAY()` | view | Timelock duration (3 minutes on testnet) |

**Project struct fields (v2):**
```
applicant, commitHash, contractAddr, bizApi,
agentDid, agentRepo, agentApiEndpoint,        ← A2A identity
status, auditScore, reliabilityScore, qualityScore, marketFitScore,
submittedAt, auditedAt, investedAt, executionUnlocksAt, exitedAt,
requestedAmount, auditContentHash,
investmentAmount, releasedAmount, exitProceeds
```

### `oracle/OmniOracle.sol`

Chainlink Functions client. Requests AI audit on-chain, fulfills with 3D scores.

- `requestAudit(projectId)` — triggers DON execution of `audit-source.js`
- `_fulfillRequest()` — decodes 160-byte response, stores scores
- `fulfilledScores(projectId)` → `(reliability, quality, marketFit)`
- `fulfilledScore(projectId)` → finalScore sentinel (score+1, 0 = unfulfilled)

### `oracle/MockOmniOracleV2.sol`

Demo/test oracle without Chainlink dependency.

- `setResult(projectId, finalScore, reliability, quality, marketFit, contentHash)` — admin only
- Same interface as OmniOracle — `InvestmentManager` reads it the same way

### `stylus/ScoringEngine` (Rust/Wasm — Arbitrum Stylus)

On-chain weighted scoring computation in Rust, compiled to Wasm.

- `computeScore(reliability, quality, marketFit)` → `finalScore`
- Deployed at `0xeb07843c0423208a087460bcc1ee6ec9de8d6566` on Arbitrum Sepolia
- Formula: `(r * 4000 + q * 3000 + m * 3000) / 10000`

### `revenue/RevenueShare.sol`

MasterChef-style O(1) ETH revenue distribution to LP token holders.

- `deposit(amount)` — LP registers weight
- `claimRevenue()` — pulls accrued ETH share
- `revenuePerWeight` accumulator (scaled ×1e18) eliminates O(n) loops

---

## A2A Audit Flow

OmniVault implements **Agent-to-Agent (A2A)** protocol for traceable autonomous investment.

```
1. AI Agent submits project
   im.submitProject(
     commitHash,
     contractAddr,
     bizApi,
     requestedAmount,
     "did:omni:agent:...",          ← agentDid (W3C DID)
     "https://github.com/...",      ← agentRepo
     "https://api.agent.ai/v1/...", ← agentApiEndpoint
   )

2. Chainlink DON executes audit-source.js
   → Calls 0G Compute (DeepSeek-V3)
   → Returns 160-byte result with 3D scores + content hash

3. Oracle stores result
   oracle.setResult() / OmniOracle._fulfillRequest()

4. Anyone settles
   im.settleAudit(projectId)
   → Reads oracle → updates status:
     finalScore ≥ threshold → PendingExecution (timelock starts)
     finalScore < threshold → Rejected

5. After timelock
   im.executeInvestment(projectId, amount, '0x')
   → Status: Active
```

---

## LP Mechanics

### Depositing

```
User sends ETH → FundVault
  ↳ FundToken shares minted proportional to accrualFactor
  ↳ ETH held in vault (no AAVE)
```

### Yield Accrual

`accrualFactor` rises when AI investments return proceeds. Every holder's `balanceOf` increases automatically.

```
balanceOf(user) = shares[user] × accrualFactor / 1e18
```

### LP Dashboard

- Live FundToken (OVFT) holdings and ETH equivalent
- Vault TVL and LP pool share %
- Rebasing sparkline (SVG, from `accrualFactor`)
- Portfolio health bar (Active / Pending / Troubled)
- Alerts for circuit-broken projects with ETH at risk
- Exited investments P&L table

### Redeeming

Call `FundVault.redeem(shares)` — pass **raw shares** from `getShares()`, not `balanceOf()`.

---

## Investment Lifecycle

```
1. SUBMISSION
   submitProject(..., agentDid, agentRepo, agentApiEndpoint)
   Status: Pending

2. AUDITING
   Chainlink DON executes audit-source.js
   3D scores computed via 0G Compute
   Oracle callback stores reliability/quality/marketFit
   Status: Auditing

3. SETTLEMENT (permissionless)
   settleAudit(projectId)
   ↳ score ≥ threshold → PendingExecution (timelock: 3 min testnet / 48h mainnet)
   ↳ score < threshold → Rejected

4. EXECUTION (after timelock)
   executeInvestment(projectId, amount, data)
   ETH sent to project
   Status: Active

5. EXIT / CIRCUIT BREAK
   exitInvestment() — marks exited, records proceeds, rebases vault
   triggerCircuitBreak() — halts active project on anomaly
   Status: Exited / CircuitBroken / WriteOff
```

---

## Governance & Safety

### LP Veto Window

After audit approval, LP holders have a configurable veto window before execution. A single veto is sufficient to block the investment.

### Score Threshold

`InvestmentManager.scoreThreshold()` — configurable minimum finalScore (default: 60 out of 100). Projects scoring below this are automatically rejected.

### Execution Timelock

`EXECUTION_DELAY` separates settlement from execution, giving LPs time to review and veto high-risk investments.

### Circuit Breaker

Monitoring agents can call `triggerCircuitBreak(projectId)`, immediately halting further disbursements to a troubled project.

---

## Deployed Contracts (Arbitrum Sepolia)

| Contract | Address | Explorer |
|---|---|---|
| FundToken | `0x426eC35BfFDf5BFA74664Ce7Cd838341f93e4668` | [↗](https://sepolia.arbiscan.io/address/0x426eC35BfFDf5BFA74664Ce7Cd838341f93e4668) |
| FundVault | `0xafE5c6Cf36B9aBB48fF31D60e9e28507636866A4` | [↗](https://sepolia.arbiscan.io/address/0xafE5c6Cf36B9aBB48fF31D60e9e28507636866A4) |
| InvestmentManager | `0x87eB4bf34CF42205AC6F37BEB8317cAC937819a8` | [↗](https://sepolia.arbiscan.io/address/0x87eB4bf34CF42205AC6F37BEB8317cAC937819a8) |
| MockOmniOracleV2 | `0x14C2f01e939Ae8ECa97bb44b47E566C81e78E209` | [↗](https://sepolia.arbiscan.io/address/0x14C2f01e939Ae8ECa97bb44b47E566C81e78E209) |
| RevenueShare | `0x471806AA331c6D282cA13AbCcce2315E769389c5` | [↗](https://sepolia.arbiscan.io/address/0x471806AA331c6D282cA13AbCcce2315E769389c5) |
| ScoringEngine (Stylus) | `0xeb07843c0423208a087460bcc1ee6ec9de8d6566` | [↗](https://sepolia.arbiscan.io/address/0xeb07843c0423208a087460bcc1ee6ec9de8d6566) |

Network: **Arbitrum Sepolia** · Chain ID: **421614** · Explorer: https://sepolia.arbiscan.io

---

## Setup & Development

### Prerequisites

- Node.js ≥ 18
- npm

### Contracts

```bash
npm install
npx hardhat compile
npx hardhat test
```

### Deploy to Arbitrum Sepolia

```bash
# Set PRIVATE_KEY in .env or environment
npx hardhat run scripts/deploy-arb-sepolia.ts --network arbitrumSepolia
# Auto-updates frontend/.env.local with new addresses
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

`frontend/.env.local` is auto-generated by the deploy script. Manual template:

```env
NEXT_PUBLIC_CHAIN_ID=421614
NEXT_PUBLIC_FUND_TOKEN_ADDRESS=0x426eC35BfFDf5BFA74664Ce7Cd838341f93e4668
NEXT_PUBLIC_FUND_VAULT_ADDRESS=0xafE5c6Cf36B9aBB48fF31D60e9e28507636866A4
NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=0x87eB4bf34CF42205AC6F37BEB8317cAC937819a8
NEXT_PUBLIC_OMNI_ORACLE_ADDRESS=0x14C2f01e939Ae8ECa97bb44b47E566C81e78E209
NEXT_PUBLIC_REVENUE_SHARE_ADDRESS=0x471806AA331c6D282cA13AbCcce2315E769389c5
NEXT_PUBLIC_SCORING_ENGINE_ADDRESS=0xeb07843c0423208a087460bcc1ee6ec9de8d6566
```

---

## Testing

### Hardhat unit + integration tests

```bash
npx hardhat test
# 107+ tests covering FundVault, FundToken, InvestmentManager,
# OmniOracle 3D scoring, RevenueShare, ScoringEngine interface
```

### OmniOracle 3D scoring tests (15 tests)

```bash
npx hardhat test test/OmniOracle.test.js
```

Covers: error path (err bytes, short response, unknown requestId), 5-word 160-byte format, legacy 2-word format, 32-byte score-only, unfulfilled project.

### Chainlink audit-source simulation (8 checks)

```bash
# Requires GEMINI_API_KEY or OPENAI_API_KEY
node chainlink/test-audit-source.js
# Simulates DON execution locally:
# Uint8Array, 160 bytes, all values in [0,100],
# contentHash non-zero, weighted formula ±2 tolerance
```

---

## Demo Agent

`scripts/demo-agent.ts` simulates the full A2A audit pipeline on Arbitrum Sepolia:

```bash
npx hardhat run scripts/demo-agent.ts --network arbitrumSepolia
```

**Pipeline:**
1. Checks vault balance, deposits 0.01 ETH if needed
2. AI agent submits project with DID + repo + API endpoint
3. Simulates Chainlink DON callback (reliability=88, quality=82, marketFit=75 → finalScore=82)
4. Calls `settleAudit()` — status becomes PendingExecution
5. Waits for 3-minute timelock
6. Calls `executeInvestment()` — status becomes Active

**Mock scores:**
```
reliability = 88  (×40% = 35.2)
quality     = 82  (×30% = 24.6)
marketFit   = 75  (×30% = 22.5)
─────────────────────────────
finalScore  = 82  ✓ (threshold: 60)
```

---

## Project Structure

```
OmniVault/
├── contracts/
│   ├── vault/                  FundVault.sol, FundToken.sol
│   ├── investment/             InvestmentManager.sol
│   ├── oracle/                 OmniOracle.sol, MockOmniOracleV2.sol,
│   │                           MPCGateway.sol
│   ├── revenue/                RevenueShare.sol
│   ├── registry/               PromptRegistry.sol
│   ├── audit/                  AuditTrail.sol
│   └── test/
│       ├── mocks/              MockWETH, MockAavePool, OmniOracleHarness
│       └── *.test.js
│
├── stylus/                     Rust/Wasm ScoringEngine (Arbitrum Stylus)
│   └── src/lib.rs              computeScore(r, q, m) → finalScore
│
├── chainlink/
│   ├── audit-source.js         DON script: calls 0G Compute → 160-byte result
│   └── test-audit-source.js   Local simulation with mock DON environment
│
├── frontend/
│   ├── pages/                  index.tsx (main UI)
│   ├── components/             LPDashboard.tsx
│   │                           ProjectsSection.tsx  ← audit drawer
│   │                           AuditStatusView.tsx  ← 3D score panel
│   │                           ApplyModal.tsx       ← A2A identity fields
│   │                           DepositModal.tsx
│   │                           WithdrawModal.tsx
│   ├── hooks/
│   │   ├── contracts/          index.ts (ABIs + addresses)
│   │   ├── useVaultStats.ts
│   │   ├── useVaultTransactions.ts
│   │   ├── useProjects.ts
│   │   ├── useProjectSubmit.ts ← 7-arg A2A submit
│   │   ├── useAuditStatus.ts   ← 3D score fields
│   │   └── useProjects.ts
│   └── styles/                 main.css
│
└── scripts/
    ├── deploy-arb-sepolia.ts   Deploy to Arbitrum Sepolia
    └── demo-agent.ts           Full A2A pipeline simulation
```

---

## License

MIT — see [LICENSE](LICENSE)

---

*Built for the [Arbitrum Open House London Hackathon](https://arbitrum.io) · June 2026*
