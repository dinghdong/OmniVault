'use client';
import { erc20Abi } from 'viem';

// FundVault — ETH vault with rebasing FundToken
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
    outputs: [{ name: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'fundToken',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'address', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// FundToken - ERC20 with rebasing
export const fundTokenAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'totalSupply',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'accrualFactor',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export const fundVaultAddress       = process.env.NEXT_PUBLIC_FUND_VAULT_ADDRESS        as `0x${string}` || '0x0000000000000000000000000000000000000000';
export const fundTokenAddress       = process.env.NEXT_PUBLIC_FUND_TOKEN_ADDRESS        as `0x${string}` || '0x0000000000000000000000000000000000000000';
export const investmentManagerAddress = process.env.NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS as `0x${string}` || '0x0000000000000000000000000000000000000000';

// Chain where the contracts are deployed (31337 = Hardhat local, 42161 = Arbitrum)
export const contractChainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '31337', 10);

// InvestmentManager ABI
export const investmentManagerAbi = [
  {
    name: 'projectCount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'SCORE_THRESHOLD',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'submitProject',
    type: 'function',
    inputs: [
      { name: 'commitHash',   type: 'bytes32' },
      { name: 'contractAddr', type: 'address' },
      { name: 'bizApi',       type: 'string'  },
    ],
    outputs: [{ name: 'projectId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'projects',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'applicant',      type: 'address' },
      { name: 'commitHash',     type: 'bytes32' },
      { name: 'contractAddr',   type: 'address' },
      { name: 'bizApi',         type: 'string'  },
      { name: 'status',         type: 'uint8'   },
      { name: 'auditScore',     type: 'uint256' },
      { name: 'auditScoreLow',  type: 'uint256' },
      { name: 'auditScoreHigh', type: 'uint256' },
      { name: 'auditReportHash',type: 'bytes32' },
      { name: 'investmentAmount', type: 'uint256' },
      { name: 'releasedAmount', type: 'uint256' },
      { name: 'submittedAt',    type: 'uint256' },
      { name: 'auditedAt',      type: 'uint256' },
      { name: 'exitedAt',       type: 'uint256' },
      { name: 'exitProceeds',   type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;
