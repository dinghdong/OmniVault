# OmniVault

**AI-Powered Decentralized Venture Capital Fund**

OmniVault is a decentralized VC fund that combines yield generation through AAVE V3 with multi-agent AI auditing of Web3 projects. LPs deposit ETH (auto-wrapped to WETH and supplied to AAVE V3 for aWETH yield) while AI agents continuously audit projects seeking funding.

> **v1 is ETH-only** — no USDC or other tokens. The vault wraps ETH to WETH, supplies to AAVE V3, and issues rebasing FundToken shares.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                    │
│   Dashboard  │  Project Apply  │  Portfolio  │  Analytics   │
└──────────────┬──────────────────────────────────────────────┘
               │ ethers.js / wagmi / RainbowKit
┌──────────────▼──────────────────────────────────────────────┐
│              Blockchain Layer (Arbitrum)                      │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────┐  │
│  │  FundVault   │  │FundToken   │  │InvestmentManager │  │
│  │  (AAVE Yields)│  │(Rebasing)  │  │  (AI-Powered)    │  │
│  └──────────────┘  └─────────────┘  └────────────────────┘  │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────┐  │
│  │PromptRegistry│  │AuditTrail  │  │    OmniOracle     │  │
│  └──────────────┘  └─────────────┘  └────────────────────┘  │
└──────────────┬──────────────────────────────────────────────┘
               │ Chainlink Functions
┌──────────────▼──────────────────────────────────────────────┐
│              AI Service Layer                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           Multi-Agent Orchestrator                   │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────┐    │    │
│  │  │CodeAnalysis│ │RiskAssess │ │BusinessAnalysis│    │    │
│  │  │  Agent     │ │  Agent    │ │    Agent      │    │    │
│  │  └────────────┘ └────────────┘ └────────────────┘    │    │
│  │              Consensus Engine                         │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| `FundVault.sol` | LP deposits, AAVE integration, fund management |
| `FundToken.sol` | Rebasing ERC-20 (like aToken), tracks yield via accrualFactor |
| `InvestmentManager.sol` | Project applications, audit workflow, investment execution |
| `PromptRegistry.sol` | On-chain prompt hash commitments |
| `AuditTrail.sol` | Records AI audit decisions on-chain |
| `OmniOracle.sol` | Chainlink Functions client for AI audit requests |
| `MPCGateway.sol` | API key management and rate limiting for AI services |

## Getting Started

### Prerequisites

- Node.js >= 18
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test
```

### Deploy to Arbitrum Sepolia

```bash
# Set environment variables
export ARBITRUM_SEPOLIA_RPC_URL=your_rpc_url
export PRIVATE_KEY=your_private_key
export ETHERSCAN_API_KEY=your_etherscan_key

# Deploy
npx hardhat run scripts/deploy.ts --network arbitrumSepolia
```

### Frontend Setup

```bash
cd frontend
npm install

# Create .env.local
cp .env.example .env.local

# Run development server
npm run dev
```

## Contract Addresses (Testnet)

| Contract | Address |
|----------|---------|
| FundVault | `TBD after deployment` |
| FundToken | `TBD after deployment` |
| InvestmentManager | `TBD after deployment` |
| WETH | `TBD after deployment` |
| aWETH (AAVE) | `TBD after deployment` |

## AI Audit Flow

1. **Project Submission**: Team submits via `InvestmentManager.submitProject()`
2. **Audit Request**: `OmniOracle.requestAudit()` triggers Chainlink Functions
3. **Multi-Agent Analysis**:
   - CodeAnalysisAgent: Security vulnerabilities, code quality
   - RiskAssessmentAgent: Financial and technical risks
   - BusinessAnalysisAgent: Tokenomics, sustainability
4. **Consensus**: Scores weighted and aggregated (threshold: 80%)
5. **On-Chain Result**: `fulfillAudit()` stores score in `InvestmentManager`
6. **Investment**: If approved, funds released via `executeInvestment()`

## Test Coverage

```
FundToken      : 22 tests
FundVault      : 7 tests
InvestmentManager: 13 tests
OtherContracts : 12 tests
Integration    : 10 tests
────────────────────────────
Total          : 64 tests (100% passing)
```

## Project Structure

```
OmniVault/
├── contracts/           # Solidity smart contracts
│   ├── vault/          # FundVault, FundToken
│   ├── investment/     # InvestmentManager
│   ├── oracle/         # OmniOracle, MPCGateway
│   ├── registry/      # PromptRegistry
│   ├── audit/         # AuditTrail
│   └── interfaces/    # IFundVault
├── ai-service/         # Node.js AI audit service
│   └── src/
│       ├── agents/     # Multi-agent orchestration
│       ├── routes/     # Express routes
│       └── services/   # Business logic
├── frontend/          # Next.js web application
│   └── src/
│       └── app/       # Pages and components
├── scripts/           # Deployment scripts
└── test/             # Hardhat tests
```

## Security Considerations

- All fund operations use OpenZeppelin AccessControl
- FundVault requires INVESTOR_ROLE for investments
- InvestmentManager requires AI_ORACLE_ROLE for audit callbacks
- Rate limiting on AI service calls via MPCGateway
- Prompt commitments stored on-chain for verification

## License

MIT