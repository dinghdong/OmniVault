# OmniVault API 接口规范 v1.0

> 基于 [CDS v1.0](./OmniVault_CDS_v1.md) 设计

---

## 1. 概述

### 1.1 接口分层

```
┌─────────────────────────────────────────────────┐
│                  前端 (Web App)                  │
└─────────────────────┬───────────────────────────┘
                      │ HTTP / Wallet Signature
┌─────────────────────▼───────────────────────────┐
│              链下服务层 (Backend)                │
│  ┌─────────────┐  ┌──────────────┐  ┌───────┐ │
│  │ REST API    │  │ The Graph    │  │ IPFS │ │
│  │ (Next.js)   │  │ (索引 & 查询) │  │(元数据)│ │
│  └──────┬──────┘  └──────┬───────┘  └───┬───┘ │
│         │                │               │      │
└─────────┼────────────────┼───────────────┼──────┘
          │   Direct ABI   │               │
┌─────────▼────────────────▼──────────────▼──────┐
│              区块链层 (Arbitrum)                 │
│  OmniVault.sol / FundVault.sol / FundToken.sol │
└─────────────────────────────────────────────────┘
```

### 1.2 技术选型

| 组件 | 技术 |
|------|------|
| 前端 → 后端 | REST (JSON) / JSON-RPC |
| 链上数据索引 | The Graph Protocol |
| 链下文件存储 | IPFS (审计报告、项目文档) |
| 钱包签名 | EIP-712 (Typed Data Signing) |
| 实时更新 | GraphQL Subscriptions / WebSocket |

---

## 2. REST API 规范

> Base URL: `https://api.omnivault.xyz/v1`（测试网：`https://api.test.omnivault.xyz/v1`）

### 2.1 通用规范

**请求头**
```
Content-Type: application/json
Authorization: Bearer {access_token}   # 可选，部分接口需要钱包签名
X-Request-ID: {uuid}                  # 请求唯一标识
```

**通用响应格式**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": 1745801600,
    "chainId": 42161
  }
}
```

**错误响应格式**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_SIGNATURE",
    "message": "钱包签名验证失败",
    "details": { ... }
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": 1745801600
  }
}
```

**HTTP 状态码**
| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 400 | 参数错误 |
| 401 | 未授权（需连接钱包）|
| 403 | 签名验证失败 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

---

## 3. 基金数据接口

### 3.1 获取基金统计

```
GET /fund/stats
```

**响应**
```json
{
  "success": true,
  "data": {
    "tvl": "1500000000000000000000",          // ETH 总锁仓量（18位精度，wei）
    "totalShares": "1485214000000000000000",   // FundToken 总份额（18位精度）
    "accrualFactor": "1018000000000000000", // 当前收益因子
    "cumulativeYield": "1.018",       // 累计收益倍数（展示用）
    "lpCount": 342,                  // LP 地址数
    "projectCount": 12,               // 投资项目数
    "activeProjectCount": 8,          // 在投项目数
    "totalRealizedProfit": "5200000000000000000", // 已实现收益（ETH 18位，wei）
    "totalRealizedLoss": "1200000000000000000",    // 已实现亏损（ETH 18位，wei）
    "netAssetValue": "1514000000000000000000",     // 净资产（ETH 18位，wei）
    "aaveBalance": "800000000000000000000",        // AAVE aWETH 余额
    "deployedAmount": "714000000000000000000",     // 已部署投资额（ETH，wei）
    "updatedAt": 1745801600
  }
}
```

---

### 3.2 获取基金历史净值

```
GET /fund/nav-history
```

**参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `interval` | string | 否 | `1h` / `1d` / `1w`（默认 `1d`）|
| `from` | integer | 否 | 起始时间戳（默认 30 天前）|
| `to` | integer | 否 | 结束时间戳（默认当前）|

**响应**
```json
{
  "success": true,
  "data": {
    "interval": "1d",
    "points": [
      {
        "timestamp": 1745715200,
        "accrualFactor": "1015000000000000000",
        "nav": "1.015",
        "tvl": "1480000000000"
      },
      {
        "timestamp": 1745801600,
        "accrualFactor": "1018000000000000000",
        "nav": "1.018",
        "tvl": "1514000000000"
      }
    ]
  }
}
```

---

### 3.3 获取 LP 个人数据

```
GET /lp/portfolio
```

**请求头**
```
Authorization: Bearer {wallet_signature}
```

> **说明**：`Authorization` 头需包含 EIP-712 签名，证明钱包地址所有权。

**响应**
```json
{
  "success": true,
  "data": {
    "address": "0x1234...abcd",
    "fundTokenBalance": "1018000000000000000",  // FundToken balanceOf（ETH 计价，18位精度，wei）
    "shares": "1000000000000000000",             // 原始 shares（赎回时使用，18位精度）
    "ethEquiv": "1018000000000000000",           // 等值 ETH（含复利，18位精度，wei）
    "cumulativeYield": "1.018",
    "depositHistory": [
      {
        "txHash": "0xabcd...",
        "amount": "1000000000000000000",                  // 充值 ETH（wei）
        "shares": "1000000000000000000",
        "accrualFactorAtDeposit": "1000000000000000000",
        "timestamp": 1745200000
      }
    ],
    "redeemHistory": [],
    "totalDeposited": "1000000000000000000",            // 累计充值 ETH（wei）
    "totalRedeemed": "0"
  }
}
```

---

## 4. 项目接口

### 4.1 提交融资申请

```
POST /project/apply
```

**请求头**
```
Authorization: Bearer {wallet_signature}
Content-Type: application/json
```

**请求体**
```json
{
  "commitHash": "a1b2c3d4e5f6...",
  "contractAddress": "0xABCD...1234",
  "bizApi": "https://api.example.com/metrics",
  "stakeAmount": "500000000000000000",      // 质押 WETH（18位精度，wei）
  "stakeToken": "0xWETH...",
  "requestedAmount": "5000000000000000000",  // 申请融资额（ETH，wei）
  "projectName": "Example Protocol",
  "projectDescription": "...",
  "githubUrl": "https://github.com/example/protocol"
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "projectId": 42,
    "txHash": "0xdef...789",
    "status": "Auditing",
    "submittedAt": 1745801600,
    "estimatedAuditTime": 300,  // 预计审核时长（秒）
    "auditRequestId": "req_clf_abc123"
  }
}
```

---

### 4.2 获取项目状态

```
GET /project/{projectId}
```

**响应**
```json
{
  "success": true,
  "data": {
    "projectId": 42,
    "name": "Example Protocol",
    "applicant": "0x1234...abcd",
    "contractAddress": "0xABCD...1234",
    "commitHash": "a1b2c3d4...",
    "bizApi": "https://api.example.com/metrics",
    "requestedAmount": "5000000000000000000",  // ETH wei
    "status": "Active",
    "auditScore": 85,
    "auditScoreLow": 82,
    "auditScoreHigh": 88,
    "auditReportCid": "Qm...abc",  // IPFS 上的审计报告
    "investmentAmount": "5000000000000000000",  // ETH wei
    "releasedAmount": "1000000000000000000",    // 已释放 20%（ETH wei）
    "claimableAmount": "0",                      // 下期可领取
    "submittedAt": 1745801600,
    "auditedAt": 1745801900,
    "vestingStart": 1745801900,
    "vestingEnd": 1754067200,        // 1 年后
    "vestingPercentReleased": 20     // 已释放 20%
  }
}
```

**ProjectStatus 枚举**
| 状态 | 说明 |
|------|------|
| `Pending` | 已提交，待触发审核 |
| `Auditing` | 审核中 |
| `Approved` | 审核通过，待拨款 |
| `Rejected` | 审核拒绝 |
| `Active` | 投资执行中（分期拨付）|
| `CircuitBroken` | 已熔断 |
| `Exited` | 正常退出 |
| `WriteOff` | 亏损核销 |

---

### 4.3 获取项目列表

```
GET /project/list
```

**参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | string | 否 | 筛选状态 |
| `page` | integer | 否 | 页码（默认 1）|
| `pageSize` | integer | 否 | 每页数量（默认 20，最大 100）|

**响应**
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "projectId": 42,
        "name": "Example Protocol",
        "status": "Active",
        "auditScore": 85,
        "investmentAmount": "5000000000000000000",  // ETH wei
        "releasedPercent": 20
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 156
    }
  }
}
```

---

### 4.4 项目方领取拨款

```
POST /project/{projectId}/claim
```

**请求头**
```
Authorization: Bearer {wallet_signature}
```

**响应**
```json
{
  "success": true,
  "data": {
    "projectId": 42,
    "claimedAmount": "250000000000000000",   // 本次领取 ETH（wei）
    "totalReleased": "1250000000000000000",  // 累计已领（ETH wei）
    "remainingAmount": "3750000000000000000", // 剩余未释放（ETH wei）
    "txHash": "0xdef...789",
    "claimedAt": 1745801600
  }
}
```

---

## 5. 交易接口

### 5.1 LP 充值（链上交易）

> 充值直接调用合约，不走后端 API。后端通过事件监听更新状态。

**合约调用**
```
FundVault.deposit() payable   // ETH 通过 msg.value 传入；合约自动 wrap 为 WETH 并 supply 到 AAVE V3
```

**前端引导流程**
```
1. 前端调用 POST /api/tx/deposit/prepare
   → 获取 gas 估算、AAVE pool 地址

2. 前端构造交易，调用 FundVault.deposit() 并附带 value = ETH 充值额（wei）

3. 前端监听事件 FundVault.Deposited(LP, assets, shares)
   → 调用 POST /api/tx/deposit/confirm 通知后端

4. 后端更新 LP 记录
```

### 5.2 LP 赎回（链上交易）

**合约调用**
```
FundVault.redeem(shares)
```

**赎回预览接口（可选）**
```
GET /lp/redeem-preview?shares=1000000000000000000
```

**响应**
```json
{
  "success": true,
  "data": {
    "shares": "1000000000000000000",
    "estimatedAssets": "1018000000000000000",  // 可赎回 ETH（18位精度，wei）
    "currentAccrualFactor": "1018000000000000000",
    "gasEstimate": "0.002",          // ETH
    "availableLiquidity": "1200000000000000000000"  // AAVE aWETH 可提取余额（wei）
  }
}
```

---

## 6. 审计报告接口

### 6.1 获取审计报告

```
GET /project/{projectId}/report
```

**响应**
```json
{
  "success": true,
  "data": {
    "projectId": 42,
    "reportCid": "Qm...abc",    // IPFS CID
    "reportUrl": "https://ipfs.io/ipfs/Qm...abc",
    "reportMetadata": {
      "model": "gpt-4o",
      "nodeCount": 3,
      "scoreConsensus": "85",
      "scoreRange": { "low": 82, "high": 88 },
      "generatedAt": 1745801900,
      "promptVersion": "audit-v2.3"
    },
    "scoreBreakdown": {
      "security": 88,
      "complexity": 82,
      "businessLogic": 85,
      "teamTraceability": 80
    },
    "riskFlags": [
      { "type": "OwnerPrivilege", "severity": "Medium", "description": "..." },
      { "type": "ExternalDependency", "severity": "Low", "description": "..." }
    ]
  }
}
```

---

## 7. 链上事件索引（The Graph）

> 链上事件通过 The Graph 索引，供前端和后端高效查询。

### 7.1 Subgraph 端点

```
测试网: https://api.thegraph.com/subgraphs/name/omnivault/arbitrum-sepolia
主网:  https://gateway.thegraph.com/subgraphs/name/omnivault/arbitrum-one
```

### 7.2 主要实体

```graphql
type FundStats @entity {
  id: ID!                    # "global"
  tvl: BigInt!
  totalShares: BigInt!
  accrualFactor: BigInt!
  lpCount: Int!
  projectCount: Int!
  updatedAt: BigInt!
}

type Deposit @entity {
  id: ID!                    # txHash + logIndex
  lp: Bytes!                # 地址
  assets: BigInt!           # ETH 数量（wei）
  shares: BigInt!           # 获得的份额
  accrualFactorAtDeposit: BigInt!
  timestamp: BigInt!
  transaction: Bytes!
}

type Redeem @entity {
  id: ID!
  lp: Bytes!
  shares: BigInt!
  assets: BigInt!
  timestamp: BigInt!
  transaction: Bytes!
}

type Project @entity {
  id: ID!                    # projectId
  name: String!
  applicant: Bytes!
  contractAddress: Bytes!
  commitHash: String!
  status: String!
  auditScore: Int
  investmentAmount: BigInt
  releasedAmount: BigInt
  submittedAt: BigInt!
  auditedAt: BigInt
  exitedAt: BigInt
  exitProceeds: BigInt
}

type AccrualFactorUpdate @entity {
  id: ID!
  factor: BigInt!
  totalAssets: BigInt!
  trigger: String!          # "yield" | "loss"
  amount: BigInt!           # 触发金额
  timestamp: BigInt!
}
```

### 7.3 GraphQL 查询示例

```graphql
# 查询 LP 的所有充值记录
query GetLpDeposits($lp: String!) {
  deposits(where: { lp: $lp }, orderBy: timestamp, orderDirection: desc) {
    id
    assets
    shares
    accrualFactorAtDeposit
    timestamp
  }
}

# 查询基金历史净值
query GetNavHistory($from: BigInt!, $to: BigInt!) {
  accrualFactorUpdates(
    where: { timestamp_gte: $from, timestamp_lte: $to }
    orderBy: timestamp
    orderDirection: asc
  ) {
    id
    factor
    totalAssets
    timestamp
  }
}

# 查询活跃项目列表
query GetActiveProjects {
  projects(
    where: { status: "Active" }
    orderBy: auditedAt
    orderDirection: desc
  ) {
    id
    name
    auditScore
    investmentAmount
    releasedAmount
  }
}
```

---

## 8. 提示词验证接口

### 8.1 验证提示词完整性

```
GET /prompt/{promptId}/verify?content={base64EncodedPrompt}
```

**响应**
```json
{
  "success": true,
  "data": {
    "promptId": "audit-v2.3",
    "name": "审计 Agent v2.3",
    "commitment": "0xabc123...",
    "isActive": true,
    "verified": true,
    "registeredAt": 1745200000,
    "activatedAt": 1745300000
  }
}
```

---

## 9. WebSocket 实时订阅

### 9.1 订阅基金数据更新

```
WS /ws/fund
```

**订阅消息**
```json
{
  "type": "subscribe",
  "channel": "fund.stats",
  "params": {}
}
```

**推送消息**
```json
{
  "type": "update",
  "channel": "fund.stats",
  "data": {
    "tvl": "1510000000000",
    "accrualFactor": "1018000000000000000",
    "lpCount": 343,
    "updatedAt": 1745801600
  }
}
```

### 9.2 订阅项目状态变更

```
WS /ws/project/{projectId}
```

**推送消息**
```json
{
  "type": "update",
  "channel": "project.status",
  "data": {
    "projectId": 42,
    "oldStatus": "Auditing",
    "newStatus": "Active",
    "auditScore": 85,
    "txHash": "0xdef...789",
    "timestamp": 1745801900
  }
}
```

---

## 10. 错误码定义

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `INVALID_SIGNATURE` | 403 | 钱包签名验证失败 |
| `UNAUTHORIZED` | 401 | 未连接钱包 |
| `PROJECT_NOT_FOUND` | 404 | 项目不存在 |
| `INVALID_STATUS` | 400 | 项目状态不允许此操作 |
| `ZERO_AMOUNT` | 400 | 金额为零 |
| `EXCEEDS_BALANCE` | 400 | 超过可赎回余额 |
| `EXCEEDS_REDEMPTION_LIMIT` | 400 | 超过单次赎回上限（10%）|
| `AUDIT_IN_PROGRESS` | 400 | 审核进行中 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `CHAIN_MISMATCH` | 400 | 链 ID 不匹配 |

---

## 11. 限流规则

| 接口 | 限制 |
|------|------|
| `GET /fund/stats` | 10 req/min（同一 IP）|
| `GET /lp/portfolio` | 30 req/min（同一钱包）|
| `POST /project/apply` | 5 req/hour（同一钱包）|
| `POST /project/{id}/claim` | 1 req/min（同一钱包）|
| WebSocket 连接 | 5 连接/钱包 |

---

## 12. 钱包签名规范（EIP-712）

### 签名域（Domain）

```typescript
const domain = {
  name: "OmniVault",
  version: "1",
  chainId: 42161,          // Arbitrum One
  verifyingContract: "0xOmniVaultProxyAddress..."
};
```

### 消息类型

```typescript
// LP 身份认证
type AuthMessage = {
  address: string;
  nonce: string;
  expires: number;
};

// 授权代理操作
type DelegateMessage = {
  delegate: string;       // 代理地址
  tokenId: string;        // 操作类型
  expires: number;
};
```

---

## 13. 待明确事项

| # | 事项 | 优先级 |
|---|------|--------|
| 1 | WebSocket 是否使用自建服务还是第三方（Pusher/Ably） | 中 |
| 2 | IPFS 固定节点方案（自建 Pinata 还是官方） | 中 |
| 3 | API 鉴权是否需要 OAuth2.0，还是纯钱包签名 | 低 |
| 4 | The Graph  subgraph 由谁托管（自建还是托管服务） | 低 |
| 5 | 审计报告的详细字段（由 AI Agent 输出决定）| 高 |
