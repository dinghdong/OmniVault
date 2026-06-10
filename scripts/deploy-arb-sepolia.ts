/**
 * deploy-arb-sepolia.ts
 *
 * One-shot deployment to Arbitrum Sepolia (v2 — AAVE-free, A2A AI Agents):
 *   1. FundToken  → FundVault (ETH-only, no AAVE)
 *   2. InvestmentManager (AI Agent reform — agentDid/agentRepo/agentApiEndpoint)
 *   3. MockOmniOracleV2 (3D scores — demo oracle, no Chainlink subscription needed)
 *   4. RevenueShare (MasterChef-style per-agent revenue distribution)
 *   5. Wire roles + set oracle
 *   6. Write updated frontend/.env.local
 *
 * Usage:
 *   npx hardhat run scripts/deploy-arb-sepolia.ts --network arbitrumSepolia
 */
import { ethers } from 'hardhat';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const SCORE_THRESHOLD = 60; // min score to approve investment

async function waitTx(tx: any, label: string) {
  const receipt = await tx.wait();
  console.log(`  ✓ ${label} (gas: ${receipt.gasUsed})`);
  return receipt;
}

async function deploy(factory: any, name: string, ...args: any[]) {
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ✓ ${name} → ${addr}`);
  return contract;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const provider  = signer.provider!;
  const network   = await provider.getNetwork();
  const chainId   = Number(network.chainId);

  if (chainId !== 421614) {
    throw new Error(`Wrong network: expected Arbitrum Sepolia (421614), got ${chainId}`);
  }

  const bal = await provider.getBalance(signer.address);
  console.log('═══════════════════════════════════════════════════════');
  console.log('OmniVault v2  ·  Arbitrum Sepolia Deployment');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Deployer:', signer.address);
  console.log('ETH balance:', ethers.formatEther(bal), 'ETH');
  console.log('');

  // ── 1. Core vault contracts ────────────────────────────────────────────────
  console.log('1. Core vault contracts');

  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await deploy(FundToken, 'FundToken');

  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await deploy(FundVault, 'FundVault',
    await fundToken.getAddress()        // new: no WETH/AAVE args
  );

  // ── 2. InvestmentManager (AI Agent reform) ────────────────────────────────
  console.log('\n2. InvestmentManager (AI Agent reform)');

  const IM = await ethers.getContractFactory('InvestmentManager');
  const im = await deploy(IM, 'InvestmentManager',
    await fundVault.getAddress(),
    SCORE_THRESHOLD                     // new: no WETH arg
  );

  // ── 3. MockOmniOracleV2 (3D scores — demo oracle) ─────────────────────────
  // We deploy the mock oracle for demo purposes.
  // Task #9 (Chainlink ToS) is skipped; the real OmniOracle can replace this
  // later by calling im.setOracle(realOracleAddress).
  console.log('\n3. MockOmniOracleV2 (3D scores demo oracle)');

  const MockOracle = await ethers.getContractFactory('MockOmniOracleV2');
  const oracle = await deploy(MockOracle, 'MockOmniOracleV2');

  // ── 4. RevenueShare (MasterChef-style per-agent distribution) ─────────────
  console.log('\n4. RevenueShare');

  const RS = await ethers.getContractFactory('RevenueShare');
  const revenueShare = await deploy(RS, 'RevenueShare');

  // ── 4b. NonFungibleAgent (on-chain AI agent identity) ─────────────────────
  console.log('\n4b. NonFungibleAgent (NFA)');

  const NFA = await ethers.getContractFactory('NonFungibleAgent');
  const nfa = await deploy(NFA, 'NonFungibleAgent');

  // Mint the deployer's demo agent identity (Agent #1)
  const mintTx = await nfa.mint(
    'github.com/dinghdong/OmniVault',
    'https://api.omnivault-demo.ai/v1/audit',
    'claude-sonnet-4-6',
  );
  await mintTx.wait();
  console.log(`  ✓ Agent #1 minted to deployer (did: ${await nfa.getDid(1)})`);

  // ── 5. Wire roles ─────────────────────────────────────────────────────────
  console.log('\n5. Wiring roles');

  // FundToken: grant MINTER + BURNER to FundVault
  await waitTx(
    await fundToken.grantRole(await fundToken.MINTER_ROLE(), await fundVault.getAddress()),
    'FundToken.MINTER_ROLE → FundVault'
  );
  await waitTx(
    await fundToken.grantRole(await fundToken.BURNER_ROLE(), await fundVault.getAddress()),
    'FundToken.BURNER_ROLE → FundVault'
  );

  // FundVault: grant INVESTOR_ROLE to InvestmentManager
  await waitTx(
    await fundVault.grantRole(await fundVault.INVESTOR_ROLE(), await im.getAddress()),
    'FundVault.INVESTOR_ROLE → InvestmentManager'
  );

  // InvestmentManager: set oracle
  await waitTx(
    await im.setOracle(await oracle.getAddress()),
    'InvestmentManager.setOracle → MockOmniOracleV2'
  );

  // InvestmentManager: grant AI_ORACLE_ROLE to deployer (for settleAudit in demo)
  await waitTx(
    await im.grantRole(await im.AI_ORACLE_ROLE(), signer.address),
    'InvestmentManager.AI_ORACLE_ROLE → deployer'
  );

  // InvestmentManager: grant RISK_AGENT_ROLE to deployer (for veto in demo)
  await waitTx(
    await im.grantRole(await im.RISK_AGENT_ROLE(), signer.address),
    'InvestmentManager.RISK_AGENT_ROLE → deployer'
  );

  // ── 6. Update frontend/.env.local ─────────────────────────────────────────
  console.log('\n6. Updating frontend/.env.local');

  const addresses = {
    fundToken:     await fundToken.getAddress(),
    fundVault:     await fundVault.getAddress(),
    im:            await im.getAddress(),
    oracle:        await oracle.getAddress(),
    revenueShare:  await revenueShare.getAddress(),
    nfa:           await nfa.getAddress(),
  };

  const envPath = join(__dirname, '../frontend/.env.local');
  let envContent = readFileSync(envPath, 'utf-8');

  // Helper: replace or append a line
  function setEnvVar(content: string, key: string, value: string): string {
    const pattern = new RegExp(`^${key}=.*`, 'm');
    if (pattern.test(content)) {
      return content.replace(pattern, `${key}=${value}`);
    }
    return content + `\n${key}=${value}`;
  }

  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_CHAIN_ID',                    '421614');
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_EXPLORER_URL',                 'https://sepolia.arbiscan.io');
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_FUND_TOKEN_ADDRESS',            addresses.fundToken);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_FUND_VAULT_ADDRESS',            addresses.fundVault);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS',    addresses.im);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_OMNI_ORACLE_ADDRESS',           addresses.oracle);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_REVENUE_SHARE_ADDRESS',         addresses.revenueShare);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_NFA_ADDRESS',                    addresses.nfa);

  writeFileSync(envPath, envContent);
  console.log('  ✓ frontend/.env.local updated');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✅  Deployment complete!');
  console.log('');
  console.log('FundToken:         ', addresses.fundToken);
  console.log('FundVault:         ', addresses.fundVault);
  console.log('InvestmentManager: ', addresses.im);
  console.log('MockOmniOracleV2:  ', addresses.oracle);
  console.log('RevenueShare:      ', addresses.revenueShare);
  console.log('NonFungibleAgent:  ', addresses.nfa);
  console.log('ScoringEngine:      0xeb07843c0423208a087460bcc1ee6ec9de8d6566 (Stylus, deployed)');
  console.log('');
  console.log('frontend/.env.local updated for Arbitrum Sepolia (chainId 421614)');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('Next steps:');
  console.log('  cd frontend && npm run dev   ← verify the UI');
  console.log('  node chainlink/test-audit-source.js   ← verify audit-source.js');
}

main().catch(e => { console.error(e); process.exit(1); });
