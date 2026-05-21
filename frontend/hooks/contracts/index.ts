'use client';

// ─── Contract addresses (Ethereum Sepolia, chainId 11155111) ─────────────────
export const fundVaultAddress           = (process.env.NEXT_PUBLIC_FUND_VAULT_ADDRESS           || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const fundTokenAddress           = (process.env.NEXT_PUBLIC_FUND_TOKEN_ADDRESS           || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const investmentManagerAddress   = (process.env.NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS   || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const omniOracleAddress          = (process.env.NEXT_PUBLIC_OMNI_ORACLE_ADDRESS          || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const computeTrailAddress        = (process.env.NEXT_PUBLIC_COMPUTE_TRAIL_ADDRESS        || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const explorerUrl                =  process.env.NEXT_PUBLIC_EXPLORER_URL                 || 'https://sepolia.etherscan.io';

// Chain ID (11155111 = Ethereum Sepolia)
export const contractChainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '11155111', 10);

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
    name: 'totalAssets',
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

// ─── InvestmentManager ABI ────────────────────────────────────────────────────
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
      { name: 'commitHash',      type: 'bytes32' },
      { name: 'contractAddr',    type: 'address' },
      { name: 'bizApi',          type: 'string'  },
      { name: 'requestedAmount', type: 'uint256' },
    ],
    outputs: [{ name: 'projectId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'projects',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      // slots 0-3
      { name: 'applicant',          type: 'address' },
      { name: 'commitHash',         type: 'bytes32' },
      { name: 'contractAddr',       type: 'address' },
      { name: 'bizApi',             type: 'string'  },
      // packed slot 4: status+auditScore+timestamps (27 bytes, one SSTORE)
      { name: 'status',             type: 'uint8'   },
      { name: 'auditScore',         type: 'uint8'   },
      { name: 'submittedAt',        type: 'uint40'  },
      { name: 'auditedAt',          type: 'uint40'  },
      { name: 'investedAt',         type: 'uint40'  },
      { name: 'executionUnlocksAt', type: 'uint40'  },
      { name: 'exitedAt',           type: 'uint40'  },
      // large value slots 5-9
      { name: 'requestedAmount',    type: 'uint256' },
      { name: 'auditContentHash',   type: 'bytes32' },
      { name: 'investmentAmount',   type: 'uint256' },
      { name: 'releasedAmount',     type: 'uint256' },
      { name: 'exitProceeds',       type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getClaimableAmount',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'vestingProgress',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'vestedBps',  type: 'uint256' },
      { name: 'claimable',  type: 'uint256' },
      { name: 'released',   type: 'uint256' },
      { name: 'total',      type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'claimPayout',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'simulateExit',
    type: 'function',
    inputs: [
      { name: 'projectId',          type: 'uint256' },
      { name: 'simulatedReturnBps', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'executeInvestment',
    type: 'function',
    inputs: [
      { name: 'projectId',       type: 'uint256' },
      { name: 'amount',          type: 'uint256' },
      { name: 'vestingSchedule', type: 'bytes'   },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'settleAudit',
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
  {
    name: 'markWriteOff',
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
      { name: 'commitHash',      type: 'bytes32', indexed: false },
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
      { name: 'score',       type: 'uint256', indexed: false },
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
      { name: 'amount',    type: 'uint256', indexed: false },
      { name: 'upfront',   type: 'uint256', indexed: false },
    ],
  },
] as const;

// ─── OmniOracle ABI ───────────────────────────────────────────────────────────
export const omniOracleAbi = [
  {
    name: 'requestAudit',
    type: 'function',
    inputs: [
      { name: 'projectId',      type: 'uint256' },
      { name: 'sourceCodeHash', type: 'string'  },
      { name: 'bizApi',         type: 'string'  },
    ],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  // ── MockOmniOracle demo helpers ─────────────────────────────────────────────
  {
    name: 'autoApprove',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'autoReject',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'fulfillAuditMock',
    type: 'function',
    inputs: [
      { name: 'projectId',   type: 'uint256' },
      { name: 'score',       type: 'uint8'   },
      { name: 'contentHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'fulfilledScore',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
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
    name: 'AuditReport',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true  },
      { name: 'summary',   type: 'string',  indexed: false },
    ],
  },
  {
    name: 'AuditRequested',
    type: 'event',
    inputs: [
      { name: 'projectId',      type: 'uint256', indexed: true  },
      { name: 'requestId',      type: 'bytes32', indexed: true  },
      { name: 'sourceCodeHash', type: 'string',  indexed: false },
    ],
  },
  {
    name: 'AuditFulfilled',
    type: 'event',
    inputs: [
      { name: 'projectId',   type: 'uint256', indexed: true  },
      { name: 'requestId',   type: 'bytes32', indexed: true  },
      { name: 'score',       type: 'uint256', indexed: false },
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

// ─── Project status labels ────────────────────────────────────────────────────
export const PROJECT_STATUS = [
  'None', 'Pending', 'Auditing', 'PendingExecution',
  'Rejected', 'Active', 'CircuitBroken', 'Exited', 'WriteOff', 'Vetoed',
] as const;

export type ProjectStatus = typeof PROJECT_STATUS[number];
