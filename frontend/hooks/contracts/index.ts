'use client';

// ─── Contract addresses (Arbitrum Sepolia, chainId 421614) ────────────────────
export const fundVaultAddress           = (process.env.NEXT_PUBLIC_FUND_VAULT_ADDRESS           || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const fundTokenAddress           = (process.env.NEXT_PUBLIC_FUND_TOKEN_ADDRESS           || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const investmentManagerAddress   = (process.env.NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS   || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const omniOracleAddress          = (process.env.NEXT_PUBLIC_OMNI_ORACLE_ADDRESS          || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const revenueShareAddress        = (process.env.NEXT_PUBLIC_REVENUE_SHARE_ADDRESS        || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const scoringEngineAddress       = (process.env.NEXT_PUBLIC_SCORING_ENGINE_ADDRESS       || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const nfaAddress                 = (process.env.NEXT_PUBLIC_NFA_ADDRESS                  || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const worldCupAgentVaultAddress  = (process.env.NEXT_PUBLIC_WORLD_CUP_AGENT_VAULT_ADDRESS|| '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const mockPolyMarketAddress      = (process.env.NEXT_PUBLIC_MOCK_POLY_MARKET_ADDRESS     || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const explorerUrl                =  process.env.NEXT_PUBLIC_EXPLORER_URL                 || 'https://sepolia.arbiscan.io';

// Chain ID (421614 = Arbitrum Sepolia)
export const contractChainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '421614', 10);

// ─── FundVault ABI ────────────────────────────────────────────────────────────
export const fundVaultAbi = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    name: 'redeem',
    type: 'function',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'assets', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'lp', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'vaultBalance',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'fundToken',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// ─── FundToken ABI ────────────────────────────────────────────────────────────
export const fundTokenAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getShares',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'totalSupply',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'accrualFactor',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ─── InvestmentManager ABI (A2A flow) ─────────────────────────────────────────
export const investmentManagerAbi = [
  {
    name: 'projectCount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'scoreThreshold',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'submitProject',
    type: 'function',
    inputs: [
      { name: 'contractAddr',    type: 'address' },
      { name: 'requestedAmount', type: 'uint256' },
      { name: 'agentId',         type: 'uint256' },
      { name: 'initData',        type: 'bytes'   },
    ],
    outputs: [{ name: 'projectId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'projects',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'applicant',          type: 'address' },
      { name: 'contractAddr',       type: 'address' },
      { name: 'requestedAmount',    type: 'uint256' },
      { name: 'fundedAmount',       type: 'uint256' },
      { name: 'agentId',            type: 'uint256' },
      { name: 'initData',           type: 'bytes'   },
      { name: 'status',             type: 'uint8'   },
      { name: 'auditScore',         type: 'uint8'   },
      { name: 'reliabilityScore',   type: 'uint8'   },
      { name: 'qualityScore',       type: 'uint8'   },
      { name: 'marketFitScore',     type: 'uint8'   },
      { name: 'submittedAt',        type: 'uint40'  },
      { name: 'auditedAt',          type: 'uint40'  },
      { name: 'executionUnlocksAt', type: 'uint40'  },
      { name: 'settledAt',          type: 'uint40'  },
      { name: 'auditContentHash',   type: 'bytes32' },
      { name: 'returnedAmount',     type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getAuditScores',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'finalScore',   type: 'uint8' },
      { name: 'reliability',  type: 'uint8' },
      { name: 'quality',      type: 'uint8' },
      { name: 'marketFit',    type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'settleAudit',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'executeProject',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'veto',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'triggerCircuitBreak',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // Events
  {
    name: 'ProjectSubmitted',
    type: 'event',
    inputs: [
      { name: 'projectId',       type: 'uint256', indexed: true  },
      { name: 'applicant',       type: 'address', indexed: true  },
      { name: 'agentId',         type: 'uint256', indexed: true  },
      { name: 'contractAddr',    type: 'address', indexed: false },
      { name: 'requestedAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'AuditRequested',
    type: 'event',
    inputs: [
      { name: 'projectId',          type: 'uint256', indexed: true  },
      { name: 'chainlinkRequestId', type: 'bytes32', indexed: false },
    ],
  },
  {
    name: 'AuditCompleted',
    type: 'event',
    inputs: [
      { name: 'projectId',   type: 'uint256', indexed: true  },
      { name: 'finalScore',  type: 'uint8',   indexed: false },
      { name: 'reliability', type: 'uint8',   indexed: false },
      { name: 'quality',     type: 'uint8',   indexed: false },
      { name: 'marketFit',   type: 'uint8',   indexed: false },
      { name: 'contentHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    name: 'AuditFailed',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
    ],
  },
  {
    name: 'ExecutionQueued',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true  },
      { name: 'unlocksAt', type: 'uint256', indexed: false },
      { name: 'score',     type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'InvestmentExecuted',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true  },
      { name: 'vault',     type: 'address', indexed: true  },
      { name: 'amount',    type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ProjectSettled',
    type: 'event',
    inputs: [
      { name: 'projectId',     type: 'uint256', indexed: true  },
      { name: 'returnedAmount',type: 'uint256', indexed: false },
    ],
  },
] as const;

// ─── OmniOracle / MockOmniOracleV2 ABI ───────────────────────────────────────
export const omniOracleAbi = [
  {
    name: 'fulfilledScore',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'fulfilledScores',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'reliability', type: 'uint8' },
      { name: 'quality',     type: 'uint8' },
      { name: 'marketFit',   type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'fulfilledHash',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    name: 'requestAudit',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  // MockOmniOracleV2 demo helper
  {
    name: 'setResult',
    type: 'function',
    inputs: [
      { name: 'projectId',  type: 'uint256' },
      { name: 'finalScore', type: 'uint256' },
      { name: 'reliability',type: 'uint8'   },
      { name: 'quality',    type: 'uint8'   },
      { name: 'marketFit',  type: 'uint8'   },
      { name: 'contentHash',type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'AuditRequested',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true  },
      { name: 'requestId', type: 'bytes32', indexed: true  },
    ],
  },
  {
    name: 'AuditFulfilled',
    type: 'event',
    inputs: [
      { name: 'projectId',   type: 'uint256', indexed: true  },
      { name: 'requestId',   type: 'bytes32', indexed: true  },
      { name: 'score',       type: 'uint256', indexed: false },
      { name: 'reliability', type: 'uint8',   indexed: false },
      { name: 'quality',     type: 'uint8',   indexed: false },
      { name: 'marketFit',   type: 'uint8',   indexed: false },
      { name: 'contentHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    name: 'AuditFailed',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true  },
      { name: 'requestId', type: 'bytes32', indexed: true  },
      { name: 'reason',    type: 'string',  indexed: false },
    ],
  },
] as const;

// ─── WorldCupAgentVault ABI ───────────────────────────────────────────────────
export const worldCupAgentVaultAbi = [
  {
    name: 'createBetOrder',
    type: 'function',
    inputs: [
      { name: 'projectId',    type: 'uint256' },
      { name: 'agentId',      type: 'uint256' },
      { name: 'fundedAmount', type: 'uint256' },
      { name: 'initData',     type: 'bytes'   },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'executeBetOrder',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'signature', type: 'bytes'   },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'settleBetOrder',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'betOrders',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'projectId',     type: 'uint256' },
      { name: 'agentId',       type: 'uint256' },
      { name: 'agentOwner',    type: 'address' },
      { name: 'market',        type: 'address' },
      { name: 'matchId',       type: 'uint256' },
      { name: 'outcomeIndex',  type: 'uint256' },
      { name: 'betAmount',     type: 'uint256' },
      { name: 'minOdds',       type: 'uint256' },
      { name: 'fundedAmount',  type: 'uint256' },
      { name: 'returnAmount',  type: 'uint256' },
      { name: 'agentShareBps', type: 'uint256' },
      { name: 'deadline',      type: 'uint256' },
      { name: 'nonce',         type: 'uint256' },
      { name: 'createdAt',     type: 'uint40'  },
      { name: 'executedAt',    type: 'uint40'  },
      { name: 'settledAt',     type: 'uint40'  },
      { name: 'status',        type: 'uint8'   },
    ],
    stateMutability: 'view',
  },
] as const;

// ─── MockPolyMarket ABI ───────────────────────────────────────────────────────
export const mockPolyMarketAbi = [
  {
    name: 'createMatch',
    type: 'function',
    inputs: [
      { name: 'home',     type: 'string'  },
      { name: 'away',     type: 'string'  },
      { name: 'homeOdds', type: 'uint256' },
      { name: 'drawOdds', type: 'uint256' },
      { name: 'awayOdds', type: 'uint256' },
      { name: 'expiration',type:'uint256' },
    ],
    outputs: [{ name: 'matchId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'placeBet',
    type: 'function',
    inputs: [
      { name: 'matchId',      type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'resolveMatch',
    type: 'function',
    inputs: [
      { name: 'matchId',      type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'redeem',
    type: 'function',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{ name: 'payout', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getOdds',
    type: 'function',
    inputs: [
      { name: 'matchId',      type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'pendingPayout',
    type: 'function',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'bettor',  type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'matches',
    type: 'function',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [
      { name: 'home',       type: 'string'  },
      { name: 'away',       type: 'string'  },
      { name: 'homeOdds',   type: 'uint256' },
      { name: 'drawOdds',   type: 'uint256' },
      { name: 'awayOdds',   type: 'uint256' },
      { name: 'expiration', type: 'uint256' },
      { name: 'totalPool',  type: 'uint256' },
      { name: 'outcome',    type: 'int8'    },
      { name: 'status',     type: 'uint8'   },
    ],
    stateMutability: 'view',
  },
  {
    name: 'matchCount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ─── RevenueShare ABI ─────────────────────────────────────────────────────────
export const revenueShareAbi = [
  {
    name: 'agentCount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'totalWeight',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'totalDeposited',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'contractBalance',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'pendingRevenue',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'claim',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'depositRevenue',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'registerAgent',
    type: 'function',
    inputs: [
      { name: 'did',         type: 'string'  },
      { name: 'name',        type: 'string'  },
      { name: 'weightBps',   type: 'uint256' },
      { name: 'wallet',      type: 'address' },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'RevenueDeposited',
    type: 'event',
    inputs: [
      { name: 'depositor', type: 'address', indexed: true  },
      { name: 'amount',    type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'RevenueClaimed',
    type: 'event',
    inputs: [
      { name: 'agentId',  type: 'uint256', indexed: true  },
      { name: 'wallet',   type: 'address', indexed: true  },
      { name: 'amount',   type: 'uint256', indexed: false },
    ],
  },
] as const;

// ─── NonFungibleAgent ABI ─────────────────────────────────────────────────────
export const nfaAbi = [
  {
    name: 'mint',
    type: 'function',
    inputs: [
      { name: 'repo',         type: 'string'  },
      { name: 'apiEndpoint',  type: 'string'  },
      { name: 'model',        type: 'string'  },
      { name: 'teeMrenclave', type: 'bytes32' },
      { name: 'teePublicKey', type: 'bytes'   },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAgent',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'repo',         type: 'string'  },
        { name: 'apiEndpoint',  type: 'string'  },
        { name: 'model',        type: 'string'  },
        { name: 'teeMrenclave', type: 'bytes32' },
        { name: 'teePublicKey', type: 'bytes'   },
        { name: 'mintedAt',     type: 'uint256' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    name: 'getDid',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'tokensOfOwner',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'totalSupply',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'AgentMinted',
    type: 'event',
    inputs: [
      { name: 'tokenId',      type: 'uint256', indexed: true  },
      { name: 'owner',        type: 'address', indexed: true  },
      { name: 'did',          type: 'string',  indexed: false },
      { name: 'repo',         type: 'string',  indexed: false },
      { name: 'model',        type: 'string',  indexed: false },
      { name: 'teeMrenclave', type: 'bytes32', indexed: false },
    ],
  },
] as const;

// ─── Project status labels ────────────────────────────────────────────────────
export const PROJECT_STATUS = [
  'None', 'Auditing', 'PendingExecution', 'Rejected', 'Active', 'Settled', 'Vetoed', 'CircuitBroken',
] as const;
