/**
 * autonomous-agent.ts
 *
 * OmniVault Autonomous AI Agent — A2A Investment Proposal Pipeline
 *
 * Loop:
 *   1. Discover  — scan GitHub trending / configured sources for Web3 projects
 *   2. Evaluate  — Claude API scores the project (go / no-go + 3D reasoning)
 *   3. Submit    — calls im.submitProject() on-chain with NFA DID identity
 *   4. Settle    — polls oracle; calls im.settleAudit() once result is ready
 *   5. Report    — prints outcome; waits for next cycle
 *
 * Usage:
 *   # With real GitHub discovery:
 *   GITHUB_TOKEN=ghp_... ANTHROPIC_API_KEY=sk-... \
 *     npx hardhat run scripts/autonomous-agent.ts --network arbitrumSepolia
 *
 *   # With mock data (no API keys needed):
 *   MOCK_MODE=true \
 *     npx hardhat run scripts/autonomous-agent.ts --network arbitrumSepolia
 *
 * Env vars:
 *   PRIVATE_KEY              — deployer wallet (from hardhat.config)
 *   NFA_TOKEN_ID             — NFA token ID the agent uses (default: 1)
 *   ANTHROPIC_API_KEY        — Claude API key for project evaluation
 *   GITHUB_TOKEN             — GitHub PAT for higher rate limits (optional)
 *   MOCK_MODE=true           — skip real GitHub/Claude, use mock projects
 *   CYCLE_INTERVAL_MS        — ms between discovery cycles (default: 60000)
 *   MAX_CYCLES               — stop after N cycles (default: unlimited)
 */

import { ethers } from 'hardhat';
import { readFileSync } from 'fs';
import { join } from 'path';
import https from 'https';

// ── Config ────────────────────────────────────────────────────────────────────
const NFA_TOKEN_ID       = parseInt(process.env.NFA_TOKEN_ID       || '1',     10);
const CYCLE_INTERVAL_MS  = parseInt(process.env.CYCLE_INTERVAL_MS  || '60000', 10);
const MAX_CYCLES         = parseInt(process.env.MAX_CYCLES         || '0',     10); // 0 = unlimited
const MOCK_MODE          = process.env.MOCK_MODE === 'true';
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY || '';
const GITHUB_TOKEN       = process.env.GITHUB_TOKEN || '';
const SETTLE_POLL_MS     = 15_000;
const SETTLE_TIMEOUT_MS  = 5 * 60_000;  // 5 min
const EXEC_DELAY_BUFFER  = 5_000;       // 5s buffer after timelock

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Types ────────────────────────────────────────────────────────────────────
interface Project {
  name:        string;
  description: string;
  url:         string;        // GitHub/IPFS/etc.
  contractAddr: string;       // on-chain address (0x0 if unknown)
  language:    string;
  stars:       number;
}

interface Evaluation {
  go:          boolean;
  reliability: number;  // 0-100
  quality:     number;
  marketFit:   number;
  finalScore:  number;
  reasoning:   string;
  requestedEth: string;  // e.g. "0.01"
}

// ── Load deployed addresses ───────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  const path    = join(__dirname, '../frontend/.env.local');
  const content = readFileSync(path, 'utf-8');
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const opts = Object.assign(new URL(url), { headers: { 'User-Agent': 'OmniVault-Agent/1.0', ...headers } });
    https.get(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    }).on('error', reject);
  });
}

// ── Step 1: Discover ──────────────────────────────────────────────────────────
const MOCK_PROJECTS: Project[] = [
  {
    name: 'DefiYield Protocol',
    description: 'On-chain yield optimizer with automated rebalancing strategies for stablecoin vaults. Uses Aave and Compound as underlying.',
    url: 'https://github.com/defi-yield/protocol',
    contractAddr: '0x000000000000000000000000000000000000dEaD',
    language: 'Solidity',
    stars: 142,
  },
  {
    name: 'ZK Bridge v2',
    description: 'Zero-knowledge cross-chain bridge using Groth16 proofs. Audited by Trail of Bits. Supports ETH, USDC, WBTC.',
    url: 'https://github.com/zkbridge/v2',
    contractAddr: '0x000000000000000000000000000000000000bEEF',
    language: 'Solidity',
    stars: 387,
  },
  {
    name: 'NFT Lending Market',
    description: 'Peer-to-peer NFT-collateralized lending. Integrates with major NFT collections. No oracle risk, fixed-term loans.',
    url: 'https://github.com/nft-lend/market',
    contractAddr: '0x000000000000000000000000000000000000CAFE',
    language: 'Solidity',
    stars: 89,
  },
];

async function discoverProjects(): Promise<Project[]> {
  if (MOCK_MODE) {
    console.log('  [discover] MOCK_MODE — returning mock projects');
    // Return one random mock project per cycle
    return [MOCK_PROJECTS[Math.floor(Math.random() * MOCK_PROJECTS.length)]];
  }

  try {
    const headers: Record<string, string> = {};
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

    // Search GitHub for recently created Web3/DeFi projects
    const q   = 'topic:defi+topic:solidity+language:solidity&sort=stars&order=desc&per_page=5';
    const res = await httpGet(`https://api.github.com/search/repositories?q=${q}`, headers);

    if (!res.items) return [];
    return (res.items as any[]).map((item: any) => ({
      name:         item.full_name,
      description:  item.description || '',
      url:          item.html_url,
      contractAddr: ethers.ZeroAddress,
      language:     item.language || 'Solidity',
      stars:        item.stargazers_count,
    }));
  } catch (err: any) {
    console.warn('  [discover] GitHub API error:', err.message);
    return [];
  }
}

// ── Step 2: Evaluate (Claude API) ─────────────────────────────────────────────
async function evaluateProject(project: Project): Promise<Evaluation> {
  const mockScore = () => ({
    go:          true,
    reliability: 70 + Math.floor(Math.random() * 25),
    quality:     65 + Math.floor(Math.random() * 25),
    marketFit:   60 + Math.floor(Math.random() * 30),
    finalScore:  0,
    reasoning:   'Mock evaluation — MOCK_MODE is enabled.',
    requestedEth: '0.01',
  });

  if (MOCK_MODE || !ANTHROPIC_API_KEY) {
    const ev = mockScore();
    ev.finalScore = Math.round((ev.reliability * 40 + ev.quality * 30 + ev.marketFit * 30) / 100);
    return ev;
  }

  const prompt = `You are an AI investment analyst for OmniVault, a decentralized VC fund.
Evaluate the following Web3 project for investment:

Name: ${project.name}
Description: ${project.description}
URL: ${project.url}
Language: ${project.language}
GitHub Stars: ${project.stars}

Score the project on three dimensions (0–100 each):
- reliability (40% weight): smart contract security, code quality, test coverage
- quality (30% weight): implementation completeness, architecture
- marketFit (30% weight): business model, tokenomics, competitive moat

finalScore = (reliability × 40 + quality × 30 + marketFit × 30) / 100
Minimum score to invest: 60

Respond with ONLY a JSON object:
{
  "go": true/false,
  "reliability": 0-100,
  "quality": 0-100,
  "marketFit": 0-100,
  "finalScore": 0-100,
  "reasoning": "one sentence",
  "requestedEth": "0.01"
}`;

  const body = JSON.stringify({
    model: 'claude-opus-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json    = JSON.parse(data);
          const content = json.content?.[0]?.text ?? '{}';
          // Extract JSON from response (Claude may add surrounding text)
          const match   = content.match(/\{[\s\S]*\}/);
          const ev      = JSON.parse(match?.[0] ?? '{}') as Evaluation;
          // Recalculate to ensure consistency
          ev.finalScore = Math.round((ev.reliability * 40 + ev.quality * 30 + ev.marketFit * 30) / 100);
          resolve(ev);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Step 3: Submit on-chain ───────────────────────────────────────────────────
async function submitProject(
  im: ethers.Contract,
  nfa: ethers.Contract,
  project: Project,
  ev: Evaluation,
  signer: ethers.Signer,
): Promise<{ projectId: bigint; txHash: string }> {
  const agentDid      = await nfa.getDid(NFA_TOKEN_ID);
  const agentMeta     = await nfa.getAgent(NFA_TOKEN_ID);
  const agentRepo     = agentMeta.repo;
  const agentEndpoint = agentMeta.apiEndpoint;

  const commitHash = ethers.keccak256(
    ethers.toUtf8Bytes(`${project.url}:${project.name}:${Date.now()}`)
  );

  const reqWei = ethers.parseEther(ev.requestedEth);

  const tx = await im.submitProject(
    commitHash,
    project.contractAddr || ethers.ZeroAddress,
    project.url,
    reqWei,
    agentDid,
    agentRepo,
    agentEndpoint,
  );
  const receipt = await tx.wait();

  // Parse ProjectSubmitted event
  const iface = new ethers.Interface([
    'event ProjectSubmitted(uint256 indexed projectId, address indexed applicant, bytes32 commitHash, address contractAddr, uint256 requestedAmount, string agentDid)',
  ]);
  let projectId = BigInt(0);
  for (const log of receipt.logs) {
    try {
      const decoded = iface.parseLog(log);
      if (decoded?.name === 'ProjectSubmitted') {
        projectId = BigInt(decoded.args.projectId);
        break;
      }
    } catch {}
  }

  return { projectId, txHash: tx.hash };
}

// ── Step 4: Oracle simulation + settle ────────────────────────────────────────
async function settleProject(
  im:        ethers.Contract,
  oracle:    ethers.Contract,
  vault:     ethers.Contract,
  signer:    ethers.Signer,
  projectId: bigint,
  ev:        Evaluation,
): Promise<{ status: string; score: number }> {
  // Simulate Chainlink DON callback via MockOmniOracleV2
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(`audit:${projectId}:${Date.now()}`));
  await (await oracle.setResult(
    projectId,
    BigInt(ev.finalScore + 1),   // sentinel: score+1 (0 = unfulfilled)
    ev.reliability,
    ev.quality,
    ev.marketFit,
    contentHash,
  )).wait();

  // settleAudit (permissionless)
  await (await im.settleAudit(projectId)).wait();

  const STATUS = ['None','Pending','Auditing','PendingExecution','Rejected','Active','CircuitBroken','Exited','WriteOff','Vetoed'];
  const proj   = await im.projects(projectId);
  const statusNum = Number(proj[7]);

  // If PendingExecution, wait for timelock and execute
  if (statusNum === 3) {
    const unlocksAt   = Number(proj[15]) * 1000;
    const waitMs      = Math.max(0, unlocksAt - Date.now()) + EXEC_DELAY_BUFFER;

    if (waitMs > 0) {
      console.log(`  [settle] Timelock: waiting ${(waitMs / 1000).toFixed(0)}s…`);
      await sleep(waitMs);
    }

    // Ensure vault has enough ETH to fund the investment
    const investAmount  = proj[17]; // requestedAmount (uint256)
    const vaultBalance  = await vault.vaultBalance();
    if (BigInt(vaultBalance) < BigInt(investAmount)) {
      const needed = BigInt(investAmount) - BigInt(vaultBalance);
      console.log(`  [settle] Depositing ${ethers.formatEther(needed)} ETH into vault…`);
      await (await vault.connect(signer).deposit({ value: needed })).wait();
    }

    await (await im.executeInvestment(projectId, investAmount, '0x')).wait();
    const projAfter = await im.projects(projectId);
    return { status: STATUS[Number(projAfter[7])] ?? 'Unknown', score: ev.finalScore };
  }

  return { status: STATUS[statusNum] ?? 'Unknown', score: ev.finalScore };
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();
  const [signer]  = await ethers.getSigners();
  const provider  = signer.provider!;
  const network   = await provider.getNetwork();
  const chainId   = Number(network.chainId);

  if (chainId !== 421614) throw new Error(`Wrong network: expected Arbitrum Sepolia (421614), got ${chainId}`);

  const IM_ADDR     = env['NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS'];
  const ORACLE_ADDR = env['NEXT_PUBLIC_OMNI_ORACLE_ADDRESS'];
  const NFA_ADDR    = env['NEXT_PUBLIC_NFA_ADDRESS'];

  if (!IM_ADDR || !ORACLE_ADDR || !NFA_ADDR) {
    throw new Error('Missing addresses in frontend/.env.local — run deploy-arb-sepolia.ts first');
  }

  const IM_ABI = [
    'function submitProject(bytes32,address,string,uint256,string,string,string) returns (uint256)',
    'function settleAudit(uint256)',
    'function executeInvestment(uint256,uint256,bytes)',
    'function projects(uint256) view returns (address,bytes32,address,string,string,string,string,uint8,uint8,uint8,uint8,uint8,uint40,uint40,uint40,uint40,uint40,uint256,bytes32,uint256,uint256,uint256)',
    'function getAuditScores(uint256) view returns (uint8,uint8,uint8,uint8)',
    'function EXECUTION_DELAY() view returns (uint256)',
    'event ProjectSubmitted(uint256 indexed,address indexed,bytes32,address,uint256,string)',
  ];
  const ORACLE_ABI = ['function setResult(uint256,uint256,uint8,uint8,uint8,bytes32)'];
  const NFA_ABI    = [
    'function getDid(uint256) view returns (string)',
    'function getAgent(uint256) view returns (tuple(string repo, string apiEndpoint, string model, uint256 mintedAt))',
    'function ownerOf(uint256) view returns (address)',
  ];

  const VAULT_ADDR = env['NEXT_PUBLIC_FUND_VAULT_ADDRESS'];
  if (!VAULT_ADDR) throw new Error('Missing NEXT_PUBLIC_FUND_VAULT_ADDRESS in frontend/.env.local');

  const VAULT_ABI = [
    'function vaultBalance() view returns (uint256)',
    'function deposit() payable',
  ];

  const im     = new ethers.Contract(IM_ADDR,     IM_ABI,     signer);
  const oracle = new ethers.Contract(ORACLE_ADDR, ORACLE_ABI, signer);
  const nfa    = new ethers.Contract(NFA_ADDR,    NFA_ABI,    signer);
  const vault  = new ethers.Contract(VAULT_ADDR,  VAULT_ABI,  signer);

  // Verify NFA ownership
  const nfaOwner = await nfa.ownerOf(NFA_TOKEN_ID);
  if (nfaOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`NFA #${NFA_TOKEN_ID} is owned by ${nfaOwner}, not by deployer ${signer.address}`);
  }
  const agentDid = await nfa.getDid(NFA_TOKEN_ID);

  const bal = await provider.getBalance(signer.address);
  console.log('══════════════════════════════════════════════════════════');
  console.log(' OmniVault Autonomous Agent');
  console.log('══════════════════════════════════════════════════════════');
  console.log(` Agent DID:  ${agentDid}`);
  console.log(` Wallet:     ${signer.address}`);
  console.log(` Balance:    ${ethers.formatEther(bal)} ETH`);
  console.log(` Mode:       ${MOCK_MODE ? 'MOCK' : 'LIVE'}`);
  console.log(` Cycle:      ${CYCLE_INTERVAL_MS / 1000}s`);
  if (MAX_CYCLES > 0) console.log(` Max cycles: ${MAX_CYCLES}`);
  console.log('══════════════════════════════════════════════════════════\n');

  let cycle = 0;
  const submitted = new Set<string>(); // avoid re-submitting same project

  while (MAX_CYCLES === 0 || cycle < MAX_CYCLES) {
    cycle++;
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    console.log(`[${ts}] ── Cycle #${cycle} ────────────────────────────`);

    try {
      // 1. Discover
      console.log('  [discover] Scanning for Web3 projects…');
      const projects = await discoverProjects();
      const fresh    = projects.filter(p => !submitted.has(p.url));
      console.log(`  [discover] Found ${projects.length} project(s), ${fresh.length} new`);

      for (const project of fresh) {
        console.log(`\n  ┌ Project: ${project.name}`);
        console.log(`  │ URL:     ${project.url}`);
        console.log(`  │ Stars:   ${project.stars}`);

        // 2. Evaluate
        console.log('  │ [evaluate] Calling Claude API…');
        const ev = await evaluateProject(project);
        console.log(`  │ [evaluate] Score: R=${ev.reliability} Q=${ev.quality} M=${ev.marketFit} → final=${ev.finalScore}`);
        console.log(`  │ [evaluate] Decision: ${ev.go ? '✅ GO' : '❌ NO-GO'} — ${ev.reasoning}`);

        if (!ev.go) {
          console.log('  └ Skipped (below threshold)');
          submitted.add(project.url);
          continue;
        }

        // 3. Submit
        console.log('  │ [submit] Calling im.submitProject()…');
        const { projectId, txHash } = await submitProject(im, nfa, project, ev, signer);
        submitted.add(project.url);
        console.log(`  │ [submit] ✓ Project #${projectId} (tx: ${txHash.slice(0, 18)}…)`);

        // 4. Settle
        console.log('  │ [settle] Simulating oracle + settling audit…');
        const { status, score } = await settleProject(im, oracle, vault, signer, projectId, ev);
        console.log(`  └ [settle] ✓ Final status: ${status} · Score: ${score}/100`);
      }

      if (fresh.length === 0) {
        console.log('  No new projects this cycle.');
      }
    } catch (err: any) {
      console.error('  [ERROR]', err?.message ?? err);
    }

    if (MAX_CYCLES > 0 && cycle >= MAX_CYCLES) break;
    console.log(`\n  Sleeping ${CYCLE_INTERVAL_MS / 1000}s until next cycle…\n`);
    await sleep(CYCLE_INTERVAL_MS);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('✅  Autonomous Agent finished.');
  console.log('══════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
