/**
 * deploy-resume.ts — Continue deployment from where deploy.ts was interrupted.
 *
 * Already deployed on 0G Galileo Testnet (chainId 16602):
 *   MockWETH         0xcb2Bf898200c0f94D3eD589118cB1D9ca7ADa8aA
 *   MockAavePool     0x4762c23f3bC35aAC0e454d5d4e549E35875732DA
 *   MockAToken       0xAd7c04F184773CdFb41874DEF2840357BCE4E770
 *   FundToken        0x1B29EbDDD1BbB77457b64A53BF143541560410bC
 *   FundVault        0x3ee561B746249359A0077c256504D5FD7C70Dcae
 *   InvestmentManager 0xbAEf953776dCb50Df0BAF30aE9f13F2745786373
 *   PromptRegistry   0x574D912dD7a82BE290065CD7675cC7a0aC63F611
 *
 * Still to deploy: AuditTrail, OmniOracle, MPCGateway, AgentRegistry, AgentVoting
 * Then: grant all roles + register agent wallets.
 */

import { ethers } from 'hardhat';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitForDeploy(contract: any, label: string, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await contract.waitForDeployment();
      await sleep(2000);
      return;
    } catch {
      process.stdout.write(i === 0 ? `  Waiting for ${label} receipt` : '.');
      await sleep(4000);
    }
  }
  await contract.waitForDeployment();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Resuming deployment with account:', deployer.address);
  console.log('Balance:', ethers.formatEther(await deployer.provider.getBalance(deployer.address)), 'OG');

  // ── Already-deployed addresses ──────────────────────────────────────────
  const WETH_ADDRESS             = '0xcb2Bf898200c0f94D3eD589118cB1D9ca7ADa8aA';
  const fundTokenAddress         = '0x1B29EbDDD1BbB77457b64A53BF143541560410bC';
  const fundVaultAddress         = '0x3ee561B746249359A0077c256504D5FD7C70Dcae';
  const investmentManagerAddress = '0xbAEf953776dCb50Df0BAF30aE9f13F2745786373';

  // Attach to already-deployed contracts (for role grants)
  const FundToken         = await ethers.getContractFactory('FundToken');
  const FundVault         = await ethers.getContractFactory('FundVault');
  const InvestmentManager = await ethers.getContractFactory('InvestmentManager');
  const fundToken         = FundToken.attach(fundTokenAddress);
  const fundVault         = FundVault.attach(fundVaultAddress);
  const investmentManager = InvestmentManager.attach(investmentManagerAddress);

  // ── Deploy remaining contracts ──────────────────────────────────────────
  console.log('\nDeploying AuditTrail...');
  const AuditTrail = await ethers.getContractFactory('AuditTrail');
  const auditTrail = await AuditTrail.deploy();
  await waitForDeploy(auditTrail, 'AuditTrail');
  console.log('\nAuditTrail deployed to:', await auditTrail.getAddress());

  console.log('\nDeploying OmniOracle...');
  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  const omniOracle = await OmniOracle.deploy(
    '0x0000000000000000000000000000000000000000',
    1234,
    ethers.id('omnivault-don')
  );
  await waitForDeploy(omniOracle, 'OmniOracle');
  console.log('\nOmniOracle deployed to:', await omniOracle.getAddress());

  console.log('\nDeploying MPCGateway...');
  const MPCGateway = await ethers.getContractFactory('MPCGateway');
  const mpcGateway = await MPCGateway.deploy(deployer.address);
  await waitForDeploy(mpcGateway, 'MPCGateway');
  console.log('\nMPCGateway deployed to:', await mpcGateway.getAddress());

  console.log('\nDeploying AgentRegistry...');
  const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
  const agentRegistry = await AgentRegistry.deploy();
  await waitForDeploy(agentRegistry, 'AgentRegistry');
  console.log('\nAgentRegistry deployed to:', await agentRegistry.getAddress());

  console.log('\nDeploying AgentVoting...');
  const AgentVoting = await ethers.getContractFactory('AgentVoting');
  const agentVoting = await AgentVoting.deploy(
    await agentRegistry.getAddress(),
    investmentManagerAddress,
    fundTokenAddress
  );
  await waitForDeploy(agentVoting, 'AgentVoting');
  console.log('\nAgentVoting deployed to:', await agentVoting.getAddress());

  // ── Grant roles ─────────────────────────────────────────────────────────
  console.log('\nSetting up roles...');

  console.log('  FundToken → MINTER_ROLE + BURNER_ROLE to FundVault');
  await (await fundToken.grantRole(await fundToken.MINTER_ROLE(), fundVaultAddress)).wait();
  await sleep(2000);
  await (await fundToken.grantRole(await fundToken.BURNER_ROLE(), fundVaultAddress)).wait();
  await sleep(2000);

  console.log('  FundVault → INVESTOR_ROLE to InvestmentManager');
  await (await fundVault.grantRole(await fundVault.INVESTOR_ROLE(), investmentManagerAddress)).wait();
  await sleep(2000);

  console.log('  InvestmentManager → AI_ORACLE_ROLE to AgentVoting');
  await (await investmentManager.grantRole(
    await investmentManager.AI_ORACLE_ROLE(),
    await agentVoting.getAddress()
  )).wait();
  await sleep(2000);

  console.log('  InvestmentManager → RISK_AGENT_ROLE to deployer');
  await (await investmentManager.grantRole(
    await investmentManager.RISK_AGENT_ROLE(),
    deployer.address
  )).wait();
  await sleep(2000);

  console.log('  AuditTrail → AI_ORACLE_ROLE to deployer');
  await (await auditTrail.grantRole(await auditTrail.AI_ORACLE_ROLE(), deployer.address)).wait();
  await sleep(2000);

  // ── Register agent wallets ───────────────────────────────────────────────
  const agentAddresses = [
    process.env.AGENT1_ADDRESS,
    process.env.AGENT2_ADDRESS,
    process.env.AGENT3_ADDRESS,
  ].filter(Boolean) as string[];

  if (agentAddresses.length > 0) {
    console.log(`\nRegistering ${agentAddresses.length} agent(s) in AgentRegistry...`);
    for (const addr of agentAddresses) {
      await (await agentRegistry.addAgent(addr)).wait();
      await sleep(2000);
      console.log('  Registered:', addr);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════');
  console.log('  Deployment Complete — 0G Galileo Testnet');
  console.log('════════════════════════════════════════');
  console.log('MockWETH:          0xcb2Bf898200c0f94D3eD589118cB1D9ca7ADa8aA');
  console.log('FundToken:         ', fundTokenAddress);
  console.log('FundVault:         ', fundVaultAddress);
  console.log('InvestmentManager: ', investmentManagerAddress);
  console.log('AuditTrail:        ', await auditTrail.getAddress());
  console.log('OmniOracle:        ', await omniOracle.getAddress());
  console.log('MPCGateway:        ', await mpcGateway.getAddress());
  console.log('AgentRegistry:     ', await agentRegistry.getAddress());
  console.log('AgentVoting:       ', await agentVoting.getAddress());

  console.log('\n── ai-service/.env ──');
  console.log('INVESTMENT_MANAGER_ADDRESS=' + investmentManagerAddress);
  console.log('AGENT_VOTING_ADDRESS=' + await agentVoting.getAddress());

  console.log('\n── frontend/.env.local ──');
  console.log('NEXT_PUBLIC_FUND_VAULT_ADDRESS=' + fundVaultAddress);
  console.log('NEXT_PUBLIC_FUND_TOKEN_ADDRESS=' + fundTokenAddress);
  console.log('NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=' + investmentManagerAddress);
  console.log('NEXT_PUBLIC_AGENT_VOTING_ADDRESS=' + await agentVoting.getAddress());

  console.log('\n── 0G Explorer ──');
  console.log('https://chainscan-galileo.0g.ai/address/' + await agentVoting.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
