/**
 * deploy-arb-sepolia.ts
 *
 * One-shot deployment to Arbitrum Sepolia for the A2A World Cup demo:
 *   1. FundToken → FundVault (ETH-only)
 *   2. NonFungibleAgent (NFA identities)
 *   3. InvestmentManager (A2A funding gateway)
 *   4. MockOmniOracleV2 (3D demo oracle)
 *   5. MockPolyMarket (simulated prediction market)
 *   6. WorldCupAgentVault (domain-specific agent vault)
 *   7. Wire roles, create a demo match, seed liquidity
 *   8. Write updated frontend/.env.local
 *
 * Usage:
 *   npx hardhat run scripts/deploy-arb-sepolia.ts --network arbitrumSepolia
 */
import { ethers } from 'hardhat';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const SCORE_THRESHOLD = 60; // min score to approve investment
const DEMO_AGENT_SHARE_BPS = 3000; // 30% profit share to agent

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
  console.log('OmniVault A2A · Arbitrum Sepolia Deployment');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Deployer:', signer.address);
  console.log('ETH balance:', ethers.formatEther(bal), 'ETH');
  console.log('');

  // ── 1. Core vault contracts ────────────────────────────────────────────────
  console.log('1. Core vault contracts');

  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await deploy(FundToken, 'FundToken');

  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await deploy(FundVault, 'FundVault', await fundToken.getAddress());

  // ── 2. NonFungibleAgent (NFA) ─────────────────────────────────────────────
  console.log('\n2. NonFungibleAgent (NFA)');

  const NFA = await ethers.getContractFactory('NonFungibleAgent');
  const nfa = await deploy(NFA, 'NonFungibleAgent');

  // ── 3. InvestmentManager (A2A funding gateway) ─────────────────────────────
  console.log('\n3. InvestmentManager (A2A funding gateway)');

  const IM = await ethers.getContractFactory('InvestmentManager');
  const im = await deploy(IM, 'InvestmentManager',
    await fundVault.getAddress(),
    await nfa.getAddress(),
    SCORE_THRESHOLD
  );

  // ── 4. MockOmniOracleV2 (3D scores demo oracle) ────────────────────────────
  console.log('\n4. MockOmniOracleV2 (3D scores demo oracle)');

  const MockOracle = await ethers.getContractFactory('MockOmniOracleV2');
  const oracle = await deploy(MockOracle, 'MockOmniOracleV2');

  // ── 5. MockPolyMarket (simulated prediction market) ────────────────────────
  console.log('\n5. MockPolyMarket');

  const Market = await ethers.getContractFactory('MockPolyMarket');
  const market = await deploy(Market, 'MockPolyMarket');

  // ── 6. WorldCupAgentVault (domain-specific vault) ──────────────────────────
  console.log('\n6. WorldCupAgentVault');

  const Vault = await ethers.getContractFactory('WorldCupAgentVault');
  const vault = await deploy(Vault, 'WorldCupAgentVault',
    await im.getAddress(),
    await nfa.getAddress(),
    await market.getAddress()
  );

  // ── 7. Wire roles & configure contracts ────────────────────────────────────
  console.log('\n7. Wiring roles & configuration');

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

  // InvestmentManager: grant RISK_AGENT_ROLE to deployer (veto demo)
  await waitTx(
    await im.grantRole(await im.RISK_AGENT_ROLE(), signer.address),
    'InvestmentManager.RISK_AGENT_ROLE → deployer'
  );

  // WorldCupAgentVault: optionally set default profit share to 30%
  // (left at default 3000 bps in contract; setAgentShare is per-order and owner-only)

  // ── 8. Seed liquidity & create demo match ──────────────────────────────────
  console.log('\n8. Seed liquidity & demo match');

  // Seed FundVault with ETH so it can fund agent bets
  await waitTx(
    await fundVault.deposit({ value: ethers.parseEther('0.02') }),
    'Deposit 0.02 ETH into FundVault'
  );

  // Seed MockPolyMarket with ETH so it can pay out winning odds
  await waitTx(
    await signer.sendTransaction({ to: await market.getAddress(), value: ethers.parseEther('0.02') }),
    'Seed 0.02 ETH into MockPolyMarket'
  );

  // Create a demo World Cup match
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 7 * 24 * 60 * 60; // 1 week
  await waitTx(
    await market.createMatch(
      'Argentina',
      'Brazil',
      ethers.parseEther('2.3'),   // home odds
      ethers.parseEther('3.2'),   // draw odds
      ethers.parseEther('3.1'),   // away odds
      expiration
    ),
    'Create demo match #1 Argentina vs Brazil'
  );

  // ── 9. Update frontend/.env.local ──────────────────────────────────────────
  console.log('\n9. Updating frontend/.env.local');

  const addresses = {
    fundToken:     await fundToken.getAddress(),
    fundVault:     await fundVault.getAddress(),
    im:            await im.getAddress(),
    oracle:        await oracle.getAddress(),
    nfa:           await nfa.getAddress(),
    market:        await market.getAddress(),
    vault:         await vault.getAddress(),
  };

  const envPath = join(__dirname, '../frontend/.env.local');
  let envContent = readFileSync(envPath, 'utf-8');

  function setEnvVar(content: string, key: string, value: string): string {
    const pattern = new RegExp(`^${key}=.*`, 'm');
    if (pattern.test(content)) {
      return content.replace(pattern, `${key}=${value}`);
    }
    return content + `\n${key}=${value}`;
  }

  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_CHAIN_ID',                    '421614');
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_EXPLORER_URL',                'https://sepolia.arbiscan.io');
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_FUND_TOKEN_ADDRESS',          addresses.fundToken);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_FUND_VAULT_ADDRESS',          addresses.fundVault);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS',  addresses.im);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_OMNI_ORACLE_ADDRESS',         addresses.oracle);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_NFA_ADDRESS',                 addresses.nfa);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_WORLD_CUP_AGENT_VAULT_ADDRESS', addresses.vault);
  envContent = setEnvVar(envContent, 'NEXT_PUBLIC_MOCK_POLY_MARKET_ADDRESS',    addresses.market);

  writeFileSync(envPath, envContent);
  console.log('  ✓ frontend/.env.local updated');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✅  Deployment complete!');
  console.log('');
  console.log('FundToken:              ', addresses.fundToken);
  console.log('FundVault:              ', addresses.fundVault);
  console.log('InvestmentManager:      ', addresses.im);
  console.log('MockOmniOracleV2:       ', addresses.oracle);
  console.log('NonFungibleAgent:       ', addresses.nfa);
  console.log('MockPolyMarket:         ', addresses.market);
  console.log('WorldCupAgentVault:     ', addresses.vault);
  console.log('');
  console.log('Demo match #1: Argentina vs Brazil (expires', expiration, ')');
  console.log('');
  console.log('frontend/.env.local updated for Arbitrum Sepolia (chainId 421614)');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('Next steps:');
  console.log('  cd frontend && npm run dev');
  console.log('  cd agents/worldcup-prediction-agent && npm run autonomous');
}

main().catch(e => { console.error(e); process.exit(1); });
