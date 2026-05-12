# OmniVault 技术架构图 v1.0

> 渲染说明：推荐使用支持 Mermaid 的 Markdown 编辑器（如 Typora、GitHub、Cursor 内置预览）查看完整图表。
> 基于 [PRD v1.0](./OmniVault_PRD_v1.md) 设计。

---

## 1. 系统整体架构

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#1a1a2e', 'primaryTextColor': '#eaeaea', 'primaryBorderColor': '#4a4a6a', 'lineColor': '#7c7c9a'}}}%%
flowchart TB
    subgraph Client["客户端层"]
        direction TB
        WEB["Web App (React/Next.js)"]
        WALLET["Wallet (MetaMask / WalletConnect)"]
        WEB --> WALLET
    end

    subgraph Chain["区块链层 (Arbitrum One / Sepolia)"]
        direction TB
        OVAULT["OmniVault.sol\n(Vault + InvestmentManager)"]
        FUND_TOKEN["FundToken (ERC-20)\nLP 份额代币"]
        OVAULT <--> FUND_TOKEN
    end

    subgraph YieldLayer["收益层 (AAVE)"]
        direction TB
        AAVE["AAVE V3 Pool\n(Arbitrum)"]
        aWETH["aWETH\n(计息凭证)"]
        AAVE <--> aWETH
    end

    subgraph Oracle["预言机层 (Chainlink Functions)"]
        direction TB
        CLF["Chainlink Functions"]
        CLD["Chainlink DON"]
        SECRETS["Secrets (Threshold Encryption)"]
        CLF --> CLD
        CLD --> SECRETS
    end

    subgraph AIStack["AI 执行层"]
        direction TB
        MPC["MPC Cluster\n(密钥分片 & API Key 保护)"]
        LLM["LLM Gateway\n(GPT-4o / Claude 3.5)"]
        PROMPT["Prompt Provider\n(链下提示词存储)"]
        MPC --> LLM
        PROMPT -->|Hash Commitment| OVAULT
        PROMPT -->|推送至节点| MPC
    end

    subgraph External["外部数据源"]
        GITHUB["GitHub\n(代码拉取)"]
        ONCHAIN["On-Chain Data\n(链上交易分析)"]
        BIZ_API["Business API\n(项目业务数据)"]
    end

    subgraph Indexing["索引 & 监控层"]
        THEGRAPH["The Graph\n(链上数据索引)"]
        MONITOR["Chainlink Automation\n(定时任务 & 熔断检测)"]
    end

    %% Cross-layer connections
    WEB -->|合约读写| OVAULT
    OVAULT -->|ETH→WETH supply| AAVE
    OVAULT <-->|aWETH 持仓| AAVE
    AAVE -->|利息复入| OVAULT
    CLF -->|触发审计| AIStack
    AIStack -->|结果回传| CLF
    OVAULT -->|存储 Commitment| CLF
    MONITOR -->|监控| OVAULT
    MONITOR -->|监控| BIZ_API
    ONCHAIN -->|分析数据| AIStack
    GITHUB -->|代码内容| AIStack

    style Client fill:#16213e,stroke:#0f3460,color:#eaeaea
    style Chain fill:#1a1a2e,stroke:#4a4a6a,color:#eaeaea
    style YieldLayer fill:#0d4f3c,stroke:#1a7a5e,color:#eaeaea
    style Oracle fill:#0f3460,stroke:#16213e,color:#eaeaea
    style AIStack fill:#533483,stroke:#1a1a2e,color:#eaeaea
    style External fill:#2d2d2d,stroke:#4a4a6a,color:#eaeaea
    style Indexing fill:#2d2d2d,stroke:#4a4a6a,color:#eaeaea
```

---

## 2. 核心流程时序图

### 2.1 LP 入金 → 项目审核 → 投资 → 赎回 完整流程

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#1a1a2e', 'primaryTextColor': '#eaeaea', 'primaryBorderColor': '#4a4a6a', 'lineColor': '#7c7c9a'}}}%%
sequenceDiagram
    autonumber
    actor LP as LP 投资者
    actor VAULT as OmniVault FundVault
    actor AAVE as AAVE V3 Pool
    actor CLF as Chainlink Functions
    actor MPC as MPC Cluster
    actor LLM as LLM (GPT-4o/Claude)
    actor STARTUP as 创业团队

    rect rgb(20, 25, 45)
        Note over LP,AAVE: Phase 1: LP 入金 (无项目依赖)
        LP->>VAULT: deposit() payable (msg.value = ETH)
        VAULT->>VAULT: wrap ETH → WETH
        VAULT->>AAVE: supply(WETH)
        AAVE-->>VAULT: aWETH (计息凭证)
        VAULT-->>LP: FundToken (按 accrualFactor 铸造 shares)
        Note over VAULT: shares = msg.value × 1e18 / accrualFactor
    end

    rect rgb(25, 30, 50)
        Note over STARTUP,LLM: Phase 2: 项目申请 & AI 审计
        STARTUP->>VAULT: submitApplication(commitHash, contractAddr, bizApi)
        VAULT->>VAULT: 记录申请，质押代币转入合约
        VAULT->>CLF: sendRequest(auditRequest)
        CLF->>MPC: 获取 API Key 分片
        MPC-->>CLF: API Key 重组
        CLF->>LLM: executeAudit(code, promptSubset)
        LLM-->>CLF: riskScore 区间
        CLF->>VAULT: fulfillAudit(score, reportHash)
        Note over VAULT: score >= threshold → 通过
    end

    rect rgb(20, 30, 40)
        Note over VAULT,STARTUP: Phase 3: 自动投资放款
        VAULT->>AAVE: withdraw(WETH, amount)
        AAVE-->>VAULT: WETH
        VAULT->>VAULT: 记录 totalInvested += amount
        VAULT->>STARTUP: 首期释放 (20-30%, 以 ETH 形式)
        Note over STARTUP: 剩余部分按 vesting schedule 分期释放
        Note over VAULT,AAVE: 持续监控 (MONITOR 节点)
        alt 熔断触发
            MPC-->>VAULT: triggerCircuitBreak()
            VAULT->>VAULT: 暂停分期释放，Slash 质押
        end
    end

    rect rgb(15, 25, 40)
        Note over LP,AAVE: Phase 4: LP 赎回
        LP->>VAULT: redeem(shares)
        VAULT->>AAVE: withdraw(WETH, shares × accrualFactor / 1e18)
        AAVE-->>VAULT: WETH (含利息)
        VAULT->>VAULT: unwrap WETH → ETH
        VAULT->>LP: ETH (call{value: assets})
        VAULT->>LP: burn(FundToken shares)
    end
```

---

## 3. 合约模块架构

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#1a1a2e', 'primaryTextColor': '#eaeaea', 'primaryBorderColor': '#4a4a6a', 'lineColor': '#7c7c9a'}}}%%
flowchart LR
    subgraph Core["OmniVault 核心合约"]
        direction TB
        VAULT["FundVault\n统一资金托管 + AAVE 交互"]
        FUND_TOKEN["FundToken (ERC-20)\nLP 份额代币"]
        INV_MGR["InvestmentManager\n投资项目 + 分期拨款"]
        NAV_CALC["NAVCalculator\n基金净值计算"]
        PROMPT_REG["PromptRegistry\n提示词哈希注册"]
        AUDIT_TRAIL["AuditTrail\n决策 Hash 记录"]
    end

    subgraph Governance["治理模块 (v2)"]
        GK["GovernanceKit\n争议仲裁 & 治理投票"]
    end

    subgraph External["外部协议"]
        AAVE_EXT["AAVE V3\n(Arbitrum)"]
    end

    VAULT --> FUND_TOKEN
    VAULT <--> AAVE_EXT
    VAULT --> INV_MGR
    VAULT --> NAV_CALC
    INV_MGR --> PROMPT_REG
    INV_MGR --> AUDIT_TRAIL
    VAULT --> GK

    style Core fill:#1a1a2e,stroke:#4a4a6a,color:#eaeaea
    style Governance fill:#2d2d2d,stroke:#4a4a6a,color:#eaeaea
    style External fill:#0d4f3c,stroke:#1a7a5e,color:#eaeaea
```

---

## 4. FundVault 资金流架构

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#1a1a2e', 'primaryTextColor': '#eaeaea', 'primaryBorderColor': '#4a4a6a', 'lineColor': '#7c7c9a'}}}%%
flowchart TB
    subgraph Inflow["资金流入"]
        ETH_IN["ETH\n(LP 充值, msg.value)"]
        WETH_WRAP["wrap → WETH"]
        ETH_IN --> WETH_WRAP
    end

    subgraph VaultLogic["FundVault 核心变量"]
        AAVE_BAL["aWETH 余额\n(实时生息，含累计利息)"]
        FACTOR["accrualFactor\n全局收益因子\n初始 = 1e18，仅净收益时增长"]
        SHARES["shares[user]\n用户固定份额"]
        PRINCIPAL["totalPrincipalDeposited\n累计本金"]
    end

    subgraph Outflow["资金流出"]
        INVEST["投资项目\n(从 AAVE 撤回 WETH)"]
        REDEEM["LP 赎回\n(balanceOf = shares × accrualFactor / 1e18, 以 ETH 形式)"]
        YIELD["applyYield()\n项目退出时复利分发"]
    end

    WETH_WRAP -->|supply| AAVE_BAL
    AAVE_BAL -->|赎回| INVEST
    INVEST -->|退出收益| YIELD
    YIELD -->|factor 放大| FACTOR
    FACTOR -->|余额自动增长| REDEEM
    FACTOR -->|计价| REDEEM

    style Inflow fill:#16213e,stroke:#0f3460,color:#eaeaea
    style VaultLogic fill:#1a1a2e,stroke:#4a4a6a,color:#eaeaea
    style Outflow fill:#533483,stroke:#1a1a2e,color:#eaeaea
```

---

## 5. AI Agent 集群协作架构

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#1a1a2e', 'primaryTextColor': '#eaeaea', 'primaryBorderColor': '#4a4a6a', 'lineColor': '#7c7c9a'}}}%%
flowchart TB
    subgraph Input["审计输入"]
        CODE["合约源代码\n(来自 GitHub)"]
        TXDATA["链上交易数据\n(来自 The Graph)"]
        BIZDATA["业务数据\n(来自 Business API)"]
    end

    subgraph Agents["AI Agent 集群"]
        AUDIT["审计 Agent\n(Audit Agent)"]
        ANALYST["分析 Agent\n(Analyst Agent)"]
        RISK["风控 Agent\n(Risk Agent)"]
        AUDIT -->|权限/重入/逻辑| CODE
        ANALYST -->|Wash Trading 检测| TXDATA
        ANALYST -->|数据一致性| BIZDATA
        RISK -->|熔断决策| AUDIT
        RISK -->|熔断决策| ANALYST
    end

    subgraph Consensus["共识层"]
        AGG["聚合器\n(中位数/加权)"]
        VERIFY["结果验证\n(多节点签名)"]
    end

    subgraph Output["审计输出"]
        SCORE["综合风险分数"]
        REPORT["审计报告 (链下)"]
        DECISION["链上裁决\n(通过/拒绝/复核)"]
    end

    Agents --> AGG
    AGG --> VERIFY
    VERIFY --> DECISION
    AGG --> REPORT

    style Input fill:#16213e,stroke:#0f3460,color:#eaeaea
    style Agents fill:#533483,stroke:#1a1a2e,color:#eaeaea
    style Consensus fill:#0f3460,stroke:#16213e,color:#eaeaea
    style Output fill:#1a1a2e,stroke:#4a4a6a,color:#eaeaea
```

---

## 6. 密钥与 Secrets 管理架构

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#1a1a2e', 'primaryTextColor': '#eaeaea', 'primaryBorderColor': '#4a4a6a', 'lineColor': '#7c7c9a'}}}%%
flowchart TB
    subgraph KeyGen["密钥生成 (初始化阶段, 单次)"]
        SK["Master Secret Key\n(平台主密钥, 永不出现于链上)"]
        K1["分片 1 (节点 A)"]
        K2["分片 2 (节点 B)"]
        K3["分片 3 (节点 C)"]
        SK --> K1
        SK --> K2
        SK --> K3
    end

    subgraph Storage["分片存储"]
        CL_SECRETS["Chainlink Secrets\n(加密存储于 DON)"]
        K1 --> CL_SECRETS
        K2 --> CL_SECRETS
        K3 --> CL_SECRETS
    end

    subgraph Decrypt["审计时解密 (MPC)"]
        CLF["Chainlink Functions 请求"]
        N1["节点 A 解密"]
        N2["节点 B 解密"]
        N3["节点 C 解密"]
        COMBINE["密钥重组\n(不完整于任一节点)"]
        CLF --> N1
        CLF --> N2
        CLF --> N3
        N1 --> COMBINE
        N2 --> COMBINE
        N3 --> COMBINE
    end

    subgraph Usage["API 调用"]
        LLM["LLM API\n(GPT-4o / Claude)"]
        COMBINE -->|携带密钥| LLM
    end

    style KeyGen fill:#533483,stroke:#1a1a2e,color:#eaeaea
    style Storage fill:#0f3460,stroke:#16213e,color:#eaeaea
    style Decrypt fill:#1a1a2e,stroke:#4a4a6a,color:#eaeaea
    style Usage fill:#16213e,stroke:#0f3460,color:#eaeaea
```

---

## 7. Rebasing Factor 模型

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#1a1a2e', 'primaryTextColor': '#eaeaea', 'primaryBorderColor': '#4a4a6a', 'lineColor': '#7c7c9a'}}}%%
flowchart TB
    subgraph Shares["份额系统 (固定不变)"]
        SHARES["shares[user]\n用户持有的固定份额\n存款时确定，仅存取时变化"]
        TOTAL_S["TotalShares\nFundToken 总份额"]
    end

    subgraph Factor["收益因子 (动态增长)"]
        FACTOR["accrualFactor\n全局收益累积因子\n初始 = 1e18"]
        YIELD["项目退出净收益\n(退出收益 - 本金)"]
        FACTOR -->|放大| NEW_FACTOR
        YIELD -->|按比例分配| NEW_FACTOR
    end

    subgraph Balance["余额计算 (自动复利)"]
        FORMULA["balanceOf(user)\n= shares[user] × accrualFactor / 1e18"]
        SHARES --> FORMULA
        NEW_FACTOR --> FORMULA
    end

    subgraph Output["LP 余额输出"]
        INIT["初始：1 FundToken share = 1 ETH"]
        GROW["收益后：余额自动增长\n（无需 claim，类似 aToken）"]
    end

    FORMULA --> GROW

    style Shares fill:#16213e,stroke:#0f3460,color:#eaeaea
    style Factor fill:#533483,stroke:#1a1a2e,color:#eaeaea
    style Balance fill:#1a1a2e,stroke:#4a4a6a,color:#eaeaea
    style Output fill:#0d4f3c,stroke:#1a7a5e,color:#eaeaea

    style Inputs fill:#16213e,stroke:#0f3460,color:#eaeaea
    style Calc fill:#1a1a2e,stroke:#4a4a6a,color:#eaeaea
    style Output fill:#0d4f3c,stroke:#1a7a5e,color:#eaeaea
```

---

## 8. 技术选型汇总

| 层级 | 组件 | 技术选型 | 备注 |
|------|------|----------|------|
| **前端** | Web App | Next.js / React | AI Studio 风格 |
| **前端** | 钱包连接 | wagmi + viem | 支持 MetaMask / WalletConnect |
| **合约** | 开发语言 | Solidity ^0.8 | 使用 OpenZeppelin 5.x |
| **合约** | 升级方案 | UUPS Proxy | 允许合约升级 |
| **链** | 主网 | Arbitrum One | Layer 2 低 gas |
| **链** | 测试网 | Arbitrum Sepolia |  |
| **收益层** | 借贷协议 | AAVE V3 (Arbitrum) | 闲置资金自动存入生息 |
| **预言机** | 触发 AI | Chainlink Functions |  |
| **预言机** | 定时任务 | Chainlink Automation | 熔断检测 |
| **索引** | 链上数据 | The Graph | 交易分析 |
| **AI** | LLM | GPT-4o / Claude 3.5 | 多节点冗余 |
| **AI** | 密钥保护 | MPC (门限签名) | Chainlink Secrets |
| **存储** | 元数据 | IPFS / Arweave | (V2 规划) |
| **ZK** | 隐私保护 | (V2 规划) | zkSNARKs |

---

## 9. 目录结构（参考）

```
OmniVault/
├── contracts/
│   ├── vault/
│   │   ├── FundVault.sol         # 统一资金托管 + AAVE 交互
│   │   └── FundToken.sol         # Rebasing LP 份额代币
│   ├── investment/
│   │   ├── InvestmentManager.sol  # 投资项目 + 分期拨款
│   │   └── StreamingPayout.sol   # 分期释放算法
│   ├── registry/
│   │   ├── PromptRegistry.sol     # 提示词哈希注册
│   │   └── ApplicationRegistry.sol # 项目申请注册
│   ├── audit/
│   │   └── AuditTrail.sol        # 决策 Hash 记录
│   ├── governance/
│   │   └── GovernanceKit.sol     # (v2) 争议仲裁 & 治理
│   └── interfaces/
│       ├── IAiOracle.sol
│       ├── IFundVault.sol
│       └── IAavePool.sol
├── scripts/
│   ├── deploy.ts                  # 部署脚本
│   └── setup-aave.ts             # AAVE 配置
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # 主页（基金仪表盘）
│   │   ├── apply/page.tsx        # 项目申请入口
│   │   └── lp/
│   │       ├── deposit.tsx       # LP 充值
│   │       └── redeem.tsx        # LP 赎回
│   └── components/
│       ├── FundDashboard.tsx      # 基金仪表盘
│       ├── AuditStatus.tsx       # 审计进度
│       └── YieldHistory.tsx       # 收益历史图
├── ai-agents/
│   ├── audit-agent/
│   │   ├── index.ts
│   │   └── prompts/
│   ├── analyst-agent/
│   └── risk-agent/
├── subgraph/
│   └── omni-vault-subgraph/
├── test/
│   ├── contracts/
│   └── integration/
└── docs/
    └── architecture/
```
