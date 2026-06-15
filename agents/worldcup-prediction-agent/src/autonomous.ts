/**
 * Autonomous World Cup Prediction Agent
 *
 * This script demonstrates the A2A (Agent-to-Agent) flow:
 *
 *   1. Ensure the agent owns an NFA identity.
 *   2. Scan open matches on MockPolyMarket.
 *   3. Predict and pick matches worth betting.
 *   4. Submit a funding request to OmniVault's InvestmentManager.
 *   5. Wait for AI audit, then sign & execute the bet.
 *   6. Wait for match resolution, then settle and claim agent share.
 *
 * For demo/local testing the agent also performs keeper duties that would
 * normally be handled by the OmniVault protocol/Chainlink:
 *   - Calls MockOmniOracleV2.setResult() to simulate AI audit.
 *   - Calls InvestmentManager.settleAudit().
 *   - Resolves matches on MockPolyMarket.
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeAbiParameters,
  parseAbiParameters,
  parseEther,
  formatEther,
  keccak256,
  encodePacked,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { predict } from './strategy';
import { getAgentIdentity } from './attestation';
import * as fs from 'fs';
import * as path from 'path';

// ─── Load env ───────────────────────────────────────────────────────────────
function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function loadAddresses() {
  const root = path.join(__dirname, '../../../frontend/.env.local');
  const env: Record<string, string> = {};
  if (fs.existsSync(root)) {
    for (const line of fs.readFileSync(root, 'utf8').split('\n')) {
      const m = line.match(/^NEXT_PUBLIC_(\w+)=(.+)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  return {
    nfa:                 env.NFA_ADDRESS                   || '0x0000000000000000000000000000000000000000',
    investmentManager:   env.INVESTMENT_MANAGER_ADDRESS    || '0x0000000000000000000000000000000000000000',
    omniOracle:          env.OMNI_ORACLE_ADDRESS           || '0x0000000000000000000000000000000000000000',
    worldCupAgentVault:  env.WORLD_CUP_AGENT_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000',
    mockPolyMarket:      env.MOCK_POLY_MARKET_ADDRESS      || '0x0000000000000000000000000000000000000000',
  };
}

const PRIVATE_KEY = requireEnv('AGENT_PRIVATE_KEY') as `0x${string}`;
const RPC_URL     = process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
const ADDRESSES   = loadAddresses();

const account = privateKeyToAccount(PRIVATE_KEY);
const transport = http(RPC_URL);

const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
const walletClient = createWalletClient({ chain: arbitrumSepolia, transport, account });

// ─── Minimal ABIs for agent operations ──────────────────────────────────────
const nfaAbi = [
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'tokensOfOwner', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'mint', type: 'function', inputs: [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'uint256' }] },
] as const;

const imAbi = [
  { name: 'projectCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    name: 'projects',
    type: 'function',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { type: 'address' }, { type: 'address' },          // 0 applicant, 1 contractAddr
      { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, // 2 requestedAmount, 3 fundedAmount, 4 agentId
      { type: 'bytes' },                                 // 5 initData
      { type: 'uint8' },                                 // 6 status
      { type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, // 7-10 scores
      { type: 'uint40' }, { type: 'uint40' }, { type: 'uint40' }, { type: 'uint40' }, { type: 'uint40' }, // 11-15 timestamps
      { type: 'bytes32' }, { type: 'uint256' }           // 16 auditContentHash, 17 returnedAmount
    ]
  },
  { name: 'submitProject', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }], outputs: [{ type: 'uint256' }] },
  { name: 'settleAudit', type: 'function', inputs: [{ type: 'uint256' }] },
  { name: 'executeProject', type: 'function', inputs: [{ type: 'uint256' }] },
] as const;

const oracleAbi = [
  { name: 'setResult', type: 'function', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bytes32' }] },
] as const;

const vaultAbi = [
  { name: 'executeBetOrder', type: 'function', inputs: [{ type: 'uint256' }, { type: 'bytes' }] },
  { name: 'settleBetOrder', type: 'function', inputs: [{ type: 'uint256' }] },
  { name: 'betOrders', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint40' }, { type: 'uint40' }, { type: 'uint40' }, { type: 'uint8' }] },
] as const;

const marketAbi = [
  { name: 'matchCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'matches', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }, { type: 'string' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'int8' }, { type: 'uint8' }] },
  { name: 'resolveMatch', type: 'function', inputs: [{ type: 'uint256' }, { type: 'uint256' }] },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function ensureNfa(): Promise<bigint> {
  const ids = (await publicClient.readContract({
    address: ADDRESSES.nfa as `0x${string}`,
    abi: nfaAbi,
    functionName: 'tokensOfOwner',
    args: [account.address],
  })) as bigint[];

  if (ids.length > 0) {
    console.log(`Using existing NFA #${ids[0]}`);
    return ids[0];
  }

  console.log('Minting new NFA...');
  const identity = getAgentIdentity();
  const hash = await walletClient.writeContract({
    address: ADDRESSES.nfa as `0x${string}`,
    abi: nfaAbi,
    functionName: 'mint',
    args: [
      'https://github.com/omnivault/worldcup-prediction-agent',
      'http://localhost:4000',
      'naive-momentum-v1',
      identity.teeMrenclave,
      identity.teePublicKey,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // Read back the owner's tokens to get the newly minted id.
  const newIds = (await publicClient.readContract({
    address: ADDRESSES.nfa as `0x${string}`,
    abi: nfaAbi,
    functionName: 'tokensOfOwner',
    args: [account.address],
  })) as bigint[];
  const tokenId = newIds[newIds.length - 1];
  console.log(`Minted NFA #${tokenId}, tx ${hash}`);
  return tokenId;
}

async function scanMatches(): Promise<{ matchId: bigint; home: string; away: string; homeOdds: bigint; drawOdds: bigint; awayOdds: bigint; expiration: bigint; status: number }[]> {
  const count = await publicClient.readContract({
    address: ADDRESSES.mockPolyMarket as `0x${string}`,
    abi: marketAbi,
    functionName: 'matchCount',
  }) as bigint;

  const matches = [];
  for (let i = 1; i <= Number(count); i++) {
    const m = await publicClient.readContract({
      address: ADDRESSES.mockPolyMarket as `0x${string}`,
      abi: marketAbi,
      functionName: 'matches',
      args: [BigInt(i)],
    }) as [string, string, bigint, bigint, bigint, bigint, bigint, number, number];
    matches.push({
      matchId: BigInt(i),
      home: m[0], away: m[1],
      homeOdds: m[2], drawOdds: m[3], awayOdds: m[4],
      expiration: m[5], status: m[8],
    });
  }
  return matches.filter(m => m.status === 0 && m.expiration > BigInt(Math.floor(Date.now() / 1000) + 60));
}

function encodeBetRequest(matchId: bigint, outcomeIndex: number, betAmount: bigint, minOdds: bigint, deadline: bigint, nonce: bigint): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters('uint256 matchId, uint256 outcomeIndex, uint256 betAmount, uint256 minOdds, uint256 deadline, uint256 nonce'),
    [matchId, BigInt(outcomeIndex), betAmount, minOdds, deadline, nonce]
  );
}

async function signBetRequest(matchId: bigint, outcomeIndex: number, betAmount: bigint, minOdds: bigint, deadline: bigint, nonce: bigint): Promise<`0x${string}`> {
  const payloadHash = keccak256(encodePacked(
    ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
    [matchId, BigInt(outcomeIndex), betAmount, minOdds, deadline, nonce]
  ));
  return walletClient.signMessage({ message: { raw: payloadHash } });
}

async function submitProject(agentId: bigint, matchId: bigint, outcomeIndex: number, betAmount: bigint, minOdds: bigint): Promise<bigint> {
  const requestedAmount = betAmount;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = BigInt(Math.floor(Math.random() * 1e12));
  const initData = encodeBetRequest(matchId, outcomeIndex, betAmount, minOdds, deadline, nonce);

  console.log(`Submitting project for NFA #${agentId}, match #${matchId}, outcome ${outcomeIndex}, bet ${formatEther(betAmount)} ETH`);
  const hash = await walletClient.writeContract({
    address: ADDRESSES.investmentManager as `0x${string}`,
    abi: imAbi,
    functionName: 'submitProject',
    args: [ADDRESSES.worldCupAgentVault as `0x${string}`, requestedAmount, agentId, initData],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const projectId = await publicClient.readContract({
    address: ADDRESSES.investmentManager as `0x${string}`,
    abi: imAbi,
    functionName: 'projectCount',
  }) as bigint;
  console.log(`Submitted project #${projectId}, tx ${hash}`);
  return projectId;
}

async function simulateAudit(projectId: bigint) {
  console.log(`Simulating AI audit for project #${projectId}...`);
  const h1 = await walletClient.writeContract({
    address: ADDRESSES.omniOracle as `0x${string}`,
    abi: oracleAbi,
    functionName: 'setResult',
    args: [projectId, 76n, 80n, 75n, 70n, '0x0000000000000000000000000000000000000000000000000000000000000000'],
  });
  await publicClient.waitForTransactionReceipt({ hash: h1 });
  const h2 = await walletClient.writeContract({
    address: ADDRESSES.investmentManager as `0x${string}`,
    abi: imAbi,
    functionName: 'settleAudit',
    args: [projectId],
  });
  await publicClient.waitForTransactionReceipt({ hash: h2 });
  console.log(`Audit settled for project #${projectId}`);
}

async function executeProject(projectId: bigint) {
  console.log(`Waiting for timelock and executing project #${projectId}...`);
  while (true) {
    const p = await publicClient.readContract({
      address: ADDRESSES.investmentManager as `0x${string}`,
      abi: imAbi,
      functionName: 'projects',
      args: [projectId],
    }) as any;
    const status = Number(p[6]);
    const unlocksAt = Number(p[13]);
    if (status === 2 && Date.now() / 1000 >= unlocksAt) {
      const hash = await walletClient.writeContract({
        address: ADDRESSES.investmentManager as `0x${string}`,
        abi: imAbi,
        functionName: 'executeProject',
        args: [projectId],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`Executed project #${projectId}, tx ${hash}`);
      return;
    }
    await sleep(5000);
  }
}

async function executeBet(projectId: bigint) {
  console.log(`Executing bet for project #${projectId}...`);
  const b = await publicClient.readContract({
    address: ADDRESSES.worldCupAgentVault as `0x${string}`,
    abi: vaultAbi,
    functionName: 'betOrders',
    args: [projectId],
  }) as any;
  const signature = await signBetRequest(b[4], Number(b[5]), b[6], b[7], b[11], b[12]);
  const hash = await walletClient.writeContract({
    address: ADDRESSES.worldCupAgentVault as `0x${string}`,
    abi: vaultAbi,
    functionName: 'executeBetOrder',
    args: [projectId, signature],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Bet executed for project #${projectId}, tx ${hash}`);
}

async function settleBet(projectId: bigint) {
  console.log(`Waiting for match resolution to settle project #${projectId}...`);
  while (true) {
    const b = await publicClient.readContract({
      address: ADDRESSES.worldCupAgentVault as `0x${string}`,
      abi: vaultAbi,
      functionName: 'betOrders',
      args: [projectId],
    }) as any;
    const status = Number(b[16]);
    if (status === 3) { // Settled
      console.log(`Project #${projectId} already settled`);
      return;
    }
    if (status === 2) { // Executed, try settle
      try {
        const hash = await walletClient.writeContract({
          address: ADDRESSES.worldCupAgentVault as `0x${string}`,
          abi: vaultAbi,
          functionName: 'settleBetOrder',
          args: [projectId],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`Settled project #${projectId}, tx ${hash}`);
        return;
      } catch (e: any) {
        console.log('Settle not ready yet:', e.shortMessage || e.message);
      }
    }
    await sleep(5000);
  }
}

async function resolveMatch(matchId: bigint, outcomeIndex: number) {
  console.log(`Resolving match #${matchId} with outcome ${outcomeIndex}...`);
  const hash = await walletClient.writeContract({
    address: ADDRESSES.mockPolyMarket as `0x${string}`,
    abi: marketAbi,
    functionName: 'resolveMatch',
    args: [matchId, BigInt(outcomeIndex)],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Resolved match #${matchId}`);
}

// ─── Main loop ──────────────────────────────────────────────────────────────
async function runOnce() {
  console.log('Agent address:', account.address);

  if (Object.values(ADDRESSES).some(a => a === '0x0000000000000000000000000000000000000000')) {
    console.error('Some contract addresses are not set in frontend/.env.local');
    process.exit(1);
  }

  const agentId = await ensureNfa();
  const openMatches = await scanMatches();
  console.log(`Found ${openMatches.length} open matches`);

  if (openMatches.length === 0) {
    console.log('No matches to bet on.');
    return;
  }

  // Pick the first open match with value
  const match = openMatches[0];
  const prediction = predict({
    home: match.home,
    away: match.away,
    homeOdds: Number(match.homeOdds) / 1e18,
    drawOdds: Number(match.drawOdds) / 1e18,
    awayOdds: Number(match.awayOdds) / 1e18,
  });

  if (prediction.confidence < 40) {
    console.log(`Confidence too low (${prediction.confidence}%), skipping.`);
    return;
  }

  console.log(`Predicted ${match.home} vs ${match.away}: outcome ${prediction.outcomeIndex}, confidence ${prediction.confidence}`);

  const betAmount = parseEther('0.01');
  const minOdds = [match.homeOdds, match.drawOdds, match.awayOdds][prediction.outcomeIndex];
  const projectId = await submitProject(agentId, match.matchId, prediction.outcomeIndex, betAmount, minOdds);

  // Demo keeper steps performed by agent for convenience
  await simulateAudit(projectId);
  await executeProject(projectId);
  await executeBet(projectId);

  // In a real scenario the match resolves externally. Here we resolve it ourselves for demo.
  await resolveMatch(match.matchId, prediction.outcomeIndex);
  await settleBet(projectId);

  console.log(`A2A flow complete for project #${projectId}`);
}

runOnce().catch(err => {
  console.error(err);
  process.exit(1);
});
