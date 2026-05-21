# OmniVault

**AI-Powered Decentralized Venture Capital — Built on 0G**

> OmniVault is a decentralized VC fund where LP capital earns yield via AAVE V3 while a council of on-chain AI agents continuously audits Web3 projects seeking funding. Every investment decision is verifiable, every audit report is immutable, and every fund movement is governed by smart contracts.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Smart Contracts](#smart-contracts)
4. [AI Agent System](#ai-agent-system)
5. [0G Stack Integration](#0g-stack-integration)
6. [LP Mechanics](#lp-mechanics)
7. [Investment Lifecycle](#investment-lifecycle)
8. [Governance & Safety](#governance--safety)
9. [Deployed Contracts (0G Galileo Testnet)](#deployed-contracts-0g-galileo-testnet)
10. [Setup & Development](#setup--development)
11. [Project Structure](#project-structure)

---

## Overview

OmniVault removes human bias from venture capital. Instead of a committee deciding which Web3 projects receive funding, three specialized AI agents conduct independent due diligence — then debate their findings across three rounds before committing a consensus score on-chain.

**Key properties:**

| Property | Mechanism |
|---|---|
| Yield while waiting | LP deposits → WETH → AAVE V3 aWETH |
| Tamper-proof audits | Reports stored on **0G Storage**, Merkle root recorded on-chain |
| AI inference on 0G | **BusinessAnalysisAgent** routes through **0G Compute** (DeepSeek-V3) |
| Community protection | 48 h LP veto window before any funds leave the vault |
| Vesting | 20 % upfront + 80 % linear 52-week vest in the contract |
| Dead-man safety | `DeadManSwitch.sol` triggers fund recovery if projects go dark |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Frontend  (Next.js 14)                     │
│   LP Dashboard  │  Audit Pipeline  │  Apply  │  Portfolio    │
└─────────────────────────┬────────────────────────────────────┘
              wagmi v2 / viem / ConnectKit
┌─────────────────────────▼────────────────────────────────────┐
│                  0G Galileo Testnet (EVM)                     │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │  FundVault  │  │  FundToken  │  │  InvestmentManager   │  │
│  │  AAVE V3    │  │  Rebasing   │  │  Project lifecycle   │  │
│  │  ETH yield  │  │  ERC-20     │  │  Vesting/claimPayout │  │
│  └─────────────┘  └─────────────┘  └──────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │ AgentVoting │  │AgentRegistry│  │   DeadManSwitch      │  │
│  │ Quorum/veto │  │  3 agents   │  │   30d ping window    │  │
│  └─────────────┘  └─────────────┘  └──────────────────────┘  │
└─────────────────────────┬────────────────────────────────────┘
              On-chain events / ethers.js
┌─────────────────────────▼────────────────────────────────────┐
│                    AI Service  (Node.js/Express)              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              DebateOrchestrator                        │  │
│  │  Round 1: Independent parallel analysis               │  │
│  │  Round 2: Cross-peer review (LLM-mediated)            │  │
│  │  Round 3: Final synthesis → consensus score           │  │
│  │  Each round → 0G Storage (Merkle root on-chain)       │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐  │
│  │ CodeAnalysis │ │RiskAssessment│ │  BusinessAnalysis    │  │
│  │    Agent     │ │    Agent     │ │ Agent (0G Compute)   │  │
│  └──────────────┘ └──────────────┘ └──────────────────────┘  │
│                                                              │
│  MonitoringAgent (6 h)  │  DeadManPinger (24 h)            │
└─────────────────────────┬────────────────────────────────────┘
              0G Storage SDK / 0G Compute API
┌─────────────────────────▼────────────────────────────────────┐
│                      0G Network                              │
│  0G Storage (immutable audit archives)                       │
│  0G Compute  (DeepSeek-V3 / Qwen3 inference)                │
└──────────────────────────────────────────────────────────────┘
```

---

## Smart Contracts

### `vault/FundVault.sol`

LP deposit/redemption hub. Wraps ETH → WETH → supplies to AAVE V3 for aWETH yield.

- `deposit()` — payable, returns FundToken shares
- `redeem(shares)` — burns shares, returns ETH pro-rata
- Role-based: `INVESTOR_ROLE` for investment execution

### `vault/FundToken.sol`

Rebasing ERC-20 modelled after aTokens.

- `balanceOf(user) = shares[user] × accrualFactor / 1e18`
- `getShares(user)` — raw share count (fixed at deposit)
- `accrualFactor` rises as AAVE yield accrues, increasing every holder's balance

### `investment/InvestmentManager.sol`

Full project lifecycle: submission → audit → community window → investment → vesting.

| Function | Access | Description |
|---|---|---|
| `submitProject(commitHash, contractAddr, bizApi, requestedAmount)` | public | Opens a new project slot |
| `fulfillAudit(projectId, score, scoreLow, scoreHigh, reportHash)` | AI_ORACLE_ROLE | Records audit result |
| `fulfillAuditFailure(projectId, reason)` | AI_ORACLE_ROLE | Records rejection or veto |
| `executeInvestment(projectId, amount, vestingSchedule)` | INVESTOR_ROLE | Sends 20 % upfront, holds 80 % for vesting |
| `claimPayout(projectId)` | applicant | Pulls vested ETH from the contract |
| `vestingProgress(projectId)` | view | Returns vestedBps, claimable, released, total |
| `simulateExit(projectId, simulatedReturnBps)` | admin | Test-mode exit trigger |
| `triggerCircuitBreak(projectId, severity)` | MONITOR_ROLE | Halts active project on anomaly |

**Vesting model:** `UPFRONT_BPS = 2000` (20 % sent at `executeInvestment`). The remaining 80 % vests linearly over 52 weeks from `investedAt`. Applicants call `claimPayout` to pull their available tranche.

### `governance/AgentVoting.sol`

On-chain ballot box for the three AI agents.

- Agents submit `vote(projectId, approved, score, scoreLow, scoreHigh, reasoningHash)`
- Quorum = all registered agents; stores Merkle root of debate report
- On quorum: opens 48 h community veto window (`communityWindowEnd`)
- `communityVeto(projectId)` — any LP can veto within the window
- `triggerExecution(projectId)` — permissionless after window closes without veto

### `governance/DeadManSwitch.sol`

Permissionless safety net for funded projects.

- `PING_WINDOW = 30 days` — projects must ping every 30 days
- `GRACE_PERIOD = 30 days` — extra grace after the window expires
- `ping(projectId, commitHash)` — permissionless heartbeat
- `triggerDeadSwitch(projectId)` — permissionless; callable after `PING_WINDOW + GRACE_PERIOD`
- `isTriggerable(projectId)` — view helper

---

## AI Agent System

### Three Specialized Agents

| Agent | Analyses | Primary score |
|---|---|---|
| **CodeAnalysisAgent** | Smart contract security, code quality, test coverage | `securityScore` |
| **RiskAssessmentAgent** | Rug-pull vectors, liquidity risks, team exposure | `riskScore` |
| **BusinessAnalysisAgent** | Revenue model, tokenomics, governance, competitive moat | `sustainabilityScore` |

### Three-Round Debate (`DebateOrchestrator`)

```
Round 1 — Independent (parallel)
  Each agent analyses the project alone.
  Results uploaded to 0G Storage → label: debate-r1-{projectId}

Round 2 — Cross-review (LLM-mediated)
  Each agent sees peers' Round 1 summaries, revises its score.
  Uploaded to 0G Storage → label: debate-r2-{projectId}

Round 3 — Final synthesis (LLM-mediated)
  All Round 2 data combined into final consensus score.
  Uploaded to 0G Storage → label: debate-r3-{projectId}
  Merkle root committed on-chain via AgentVoting
```

### Monitoring Agent

`monitoringAgent.js` runs every 6 hours and checks every Active project:

- **On-chain TX count growth** — baseline vs current
- **GitHub commit activity** — via `bizApi` endpoint
- On ≥ 2 anomalies: calls `triggerCircuitBreak(projectId, severity=10)`
- Uploads per-project report + cycle summary to 0G Storage

### Dead-Man Pinger

`deadManPinger.js` runs every 24 hours:

- Auto-registers newly Active projects in `DeadManSwitch`
- Derives `commitHash = sha256(pid:bizApi:dayNumber)` for each ping
- Gracefully skips if `DEAD_MAN_SWITCH_ADDRESS` is not set

---

## 0G Stack Integration

### 0G Storage

Every audit artifact is stored immutably:

| Artifact | Label |
|---|---|
| Round 1 debate JSON | `debate-r1-{projectId}` |
| Round 2 cross-review JSON | `debate-r2-{projectId}` |
| Round 3 synthesis JSON | `debate-r3-{projectId}` |
| Monitoring cycle report | `monitor-cycle-{timestamp}` |
| Per-project monitoring report | `monitor-{projectId}-{timestamp}` |

The Merkle root of the final report is recorded on-chain in `AgentVoting.projectVotings[id].reportHash` — a tamper-proof link between the immutable storage layer and the smart contract.

### 0G Compute

`BusinessAnalysisAgent` routes inference through **0G Compute** (`https://router-api.0g.ai/v1`) using an OpenAI-compatible client. If `ZG_COMPUTE_API_KEY` is not configured, it falls back transparently to the primary LLM.

```
Default model: deepseek-ai/DeepSeek-V3
Auth: Bearer app-sk-<SECRET>
Fallback: OPENAI_BASE_URL / OPENAI_API_KEY
```

---

## LP Mechanics

### Depositing

```
User sends ETH → FundVault
  ↳ ETH wraps to WETH
  ↳ WETH supplied to AAVE V3 → aWETH yield begins
  ↳ FundToken shares minted proportional to accrualFactor
```

### Yield Accrual

`accrualFactor` is the single global exchange rate between shares and ETH value. As AAVE yield accumulates, `accrualFactor` rises — every holder's `balanceOf` increases automatically without any rebase transaction.

```
balanceOf(user) = shares[user] × accrualFactor / 1e18
```

### LP Dashboard

The dashboard shows:
- Live FundToken (OVFT) holdings and ETH equivalent
- Total TVL and LP pool share %
- Compound-growth sparkline (SVG, derived from `accrualFactor`)
- Portfolio health bar (Active / Pending / Troubled projects)
- Alerts for any circuit-broken projects and ETH at risk

### Redeeming

Call `FundVault.redeem(shares)` — pass **raw shares** from `getShares()`, not the ETH balance from `balanceOf()`. The contract withdraws aWETH from AAVE, unwraps to ETH, and sends pro-rata to the caller.

---

## Investment Lifecycle

```
1. SUBMISSION
   submitProject(commitHash, contractAddr, bizApi, requestedAmount)
   Status: Pending

2. AUDITING (on-chain listener detects ProjectSubmitted event)
   DebateOrchestrator runs 3-round debate
   Each round stored on 0G Storage
   Agents vote on-chain via AgentVoting
   Status: Auditing

3. PENDING EXECUTION (quorum reached)
   communityWindowEnd set (now + 48 h)
   LP holders may call communityVeto() during this window
   Status: PendingExecution

4. EXECUTION (after window closes without veto)
   triggerExecution() → AgentVoting calls InvestmentManager
   20 % ETH sent immediately to applicant
   80 % held in contract for 52-week linear vest
   Status: Active

5. VESTING (applicant calls claimPayout periodically)
   vestingProgress() shows vestedBps, claimable, released, total
   claimPayout() transfers the unlocked tranche to applicant

6. EXIT / CIRCUIT BREAK
   simulateExit() (admin) — marks exited, records proceeds
   triggerCircuitBreak() (MonitoringAgent) — halts disbursements
   triggerDeadSwitch() (anyone) — after 60-day silence
   Status: Exited / CircuitBroken / WriteOff
```

---

## Governance & Safety

### Community Veto

After AI quorum, LP holders have a 48-hour window to veto any investment. A single veto is sufficient — this gives the community a final human check on AI decisions. Vetoed projects move to `Vetoed` status and no funds are released.

### Agent Role Separation

Agents are wallets registered in `AgentRegistry`. `AgentVoting` only accepts votes from registered addresses (`AI_ORACLE_ROLE`). The three agents use distinct private keys, ensuring no single key can forge a quorum.

### Dead-Man Switch

If a funded project stops pinging `DeadManSwitch` for 60 days (30-day window + 30-day grace), anyone can call `triggerDeadSwitch()` to initiate fund recovery. The `deadManPinger.js` service automates the heartbeat so compliant projects are never accidentally triggered.

### Circuit Breaker

`MonitoringAgent` watches on-chain TX volume and GitHub activity every 6 hours. If two or more anomaly checks fail for the same project, it calls `triggerCircuitBreak()`, immediately halting further vesting disbursements.

---

## Deployed Contracts (0G Galileo Testnet)

| Contract | Address |
|---|---|
| FundToken | [`0x77dde9441D7d03f30963dA9C0d17431017487AFe`](https://chainscan-galileo.0g.ai/address/0x77dde9441D7d03f30963dA9C0d17431017487AFe) |
| FundVault | [`0x786897DDc85D592C116e870AC46f4c0e3c8f2F41`](https://chainscan-galileo.0g.ai/address/0x786897DDc85D592C116e870AC46f4c0e3c8f2F41) |
| InvestmentManager | [`0x549d3A606C0Ff03F333D3c867A3A79c7d34f4888`](https://chainscan-galileo.0g.ai/address/0x549d3A606C0Ff03F333D3c867A3A79c7d34f4888) |
| AgentRegistry | [`0x906eaF095b37978580E6cb5CD00b331e0B66D1aF`](https://chainscan-galileo.0g.ai/address/0x906eaF095b37978580E6cb5CD00b331e0B66D1aF) |
| AgentVoting | [`0x4BdD5CeF85A36124992eC588952A7EFf057a3Ac8`](https://chainscan-galileo.0g.ai/address/0x4BdD5CeF85A36124992eC588952A7EFf057a3Ac8) |
| DeadManSwitch | [`0x34a8856b4B688077A144B5c88C3481e542258C75`](https://chainscan-galileo.0g.ai/address/0x34a8856b4B688077A144B5c88C3481e542258C75) |

Network: **0G Galileo Testnet** · Chain ID: **16602** · Explorer: https://chainscan-galileo.0g.ai

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

### AI Service

```bash
cd ai-service
npm install
cp .env.example .env  # fill in keys

# Required
OPENAI_API_KEY=...         # or any OpenAI-compatible key
OPENAI_BASE_URL=...        # optional, e.g. https://api.minimaxi.com/v1
OPENAI_MODEL=...

# 0G-specific
ZG_STORAGE_PRIVATE_KEY=... # wallet for 0G Storage uploads
ZG_EVM_RPC=https://evmrpc-testnet.0g.ai
ZG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai

ZG_COMPUTE_API_KEY=        # optional: app-sk-... for 0G Compute inference
ZG_COMPUTE_MODEL=deepseek-ai/DeepSeek-V3

INVESTMENT_MANAGER_ADDRESS=0x549d3A606C0Ff03F333D3c867A3A79c7d34f4888
AGENT_VOTING_ADDRESS=0x4BdD5CeF85A36124992eC588952A7EFf057a3Ac8
DEAD_MAN_SWITCH_ADDRESS=0x34a8856b4B688077A144B5c88C3481e542258C75
AGENT1_PRIVATE_KEY=...
AGENT2_PRIVATE_KEY=...
AGENT3_PRIVATE_KEY=...

node src/server.js
```

### Frontend

```bash
cd frontend
npm install

# frontend/.env.local
NEXT_PUBLIC_FUND_VAULT_ADDRESS=0x786897DDc85D592C116e870AC46f4c0e3c8f2F41
NEXT_PUBLIC_FUND_TOKEN_ADDRESS=0x77dde9441D7d03f30963dA9C0d17431017487AFe
NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=0x549d3A606C0Ff03F333D3c867A3A79c7d34f4888
NEXT_PUBLIC_AGENT_VOTING_ADDRESS=0x4BdD5CeF85A36124992eC588952A7EFf057a3Ac8
NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS=0x906eaF095b37978580E6cb5CD00b331e0B66D1aF
NEXT_PUBLIC_CHAIN_ID=16602
NEXT_PUBLIC_EXPLORER_URL=https://chainscan-galileo.0g.ai

npm run dev   # http://localhost:3000
```

---

## Project Structure

```
OmniVault/
├── contracts/
│   ├── vault/                  FundVault.sol, FundToken.sol
│   ├── investment/             InvestmentManager.sol
│   ├── governance/             AgentVoting.sol, AgentRegistry.sol,
│   │                           DeadManSwitch.sol
│   ├── oracle/                 OmniOracle.sol, MPCGateway.sol
│   ├── registry/               PromptRegistry.sol
│   ├── audit/                  AuditTrail.sol
│   └── test/mocks/             MockWETH, MockAavePool, MockAToken
│
├── ai-service/
│   └── src/
│       ├── agents/             codeAnalysisAgent.js
│       │                       riskAssessmentAgent.js
│       │                       businessAnalysisAgent.js  ← 0G Compute
│       │                       debateOrchestrator.js     ← 3-round debate
│       │                       reportGenerator.js
│       ├── services/           onChainListener.js        ← event-driven
│       │                       monitoringAgent.js        ← 6 h cycle
│       │                       deadManPinger.js          ← 24 h heartbeat
│       │                       auditStorage.js
│       ├── utils/              zgStorage.js              ← 0G Storage SDK
│       │                       zgComputeClient.js        ← 0G Compute
│       │                       llmClient.js
│       │                       parseJson.js
│       └── routes/             audit.js
│
├── frontend/
│   ├── pages/                  index.tsx (main UI)
│   ├── components/             LPDashboard.tsx
│   │                           ProjectsSection.tsx       ← veto + claim UI
│   │                           AuditStatusView.tsx       ← AI panel
│   │                           ApplyModal.tsx
│   │                           DepositModal.tsx
│   │                           WithdrawModal.tsx
│   ├── hooks/
│   │   ├── contracts/          index.ts (ABIs + addresses)
│   │   ├── useVaultStats.ts
│   │   ├── useVaultTransactions.ts
│   │   ├── useProjects.ts
│   │   ├── useProjectSubmit.ts
│   │   ├── useAuditStatus.ts
│   │   ├── useVeto.ts
│   │   └── useClaimPayout.ts   ← A4: vesting claim
│   └── styles/                 main.css
│
└── scripts/
    ├── deploy.ts               deploy to 0G / Arbitrum
    └── deploy-and-test.ts      local E2E test
```

---

## License

MIT — see [LICENSE](LICENSE)

---

*Built for the [0G APAC Hackathon](https://0g.ai) · May 2026*
