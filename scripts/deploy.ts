import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying contracts with account:', deployer.address);
  console.log('Account balance:', (await deployer.provider.getBalance(deployer.address)).toString());

  // WETH on Arbitrum Sepolia
  const WETH_ADDRESS = '0x980B62Da97e3aB60eE028C4aC27e7dCE6B0FF3A8';

  // AAVE V3 Pool on Arbitrum Sepolia
  const AAVE_POOL_ADDRESS = '0x0b913A76beFF3887d3501b0f4a9Ca2Cc1142bCCc';

  // aWETH on Arbitrum Sepolia
  const aWETH_ADDRESS = '0xE0d9b65b4C508feEFe4405C8aa7b08744C76d9C2';

  // Deploy FundToken
  console.log('\nDeploying FundToken...');
  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await fundToken.waitForDeployment();
  console.log('FundToken deployed to:', await fundToken.getAddress());

  // Deploy FundVault (ETH/WETH vault with AAVE)
  console.log('\nDeploying FundVault...');
  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await FundVault.deploy(
    WETH_ADDRESS,
    AAVE_POOL_ADDRESS,
    aWETH_ADDRESS,
    await fundToken.getAddress()
  );
  await fundVault.waitForDeployment();
  console.log('FundVault deployed to:', await fundVault.getAddress());

  // Deploy InvestmentManager
  console.log('\nDeploying InvestmentManager...');
  const InvestmentManager = await ethers.getContractFactory('InvestmentManager');
  const investmentManager = await InvestmentManager.deploy(
    await fundVault.getAddress(),
    WETH_ADDRESS
  );
  await investmentManager.waitForDeployment();
  console.log('InvestmentManager deployed to:', await investmentManager.getAddress());

  // Deploy PromptRegistry
  console.log('\nDeploying PromptRegistry...');
  const PromptRegistry = await ethers.getContractFactory('PromptRegistry');
  const promptRegistry = await PromptRegistry.deploy(deployer.address);
  await promptRegistry.waitForDeployment();
  console.log('PromptRegistry deployed to:', await promptRegistry.getAddress());

  // Deploy AuditTrail
  console.log('\nDeploying AuditTrail...');
  const AuditTrail = await ethers.getContractFactory('AuditTrail');
  const auditTrail = await AuditTrail.deploy();
  await auditTrail.waitForDeployment();
  console.log('AuditTrail deployed to:', await auditTrail.getAddress());

  // Deploy OmniOracle (Chainlink Functions client)
  console.log('\nDeploying OmniOracle...');
  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  const omniOracle = await OmniOracle.deploy(
    process.env.FUNCTIONS_ROUTER || '0x0000000000000000000000000000000000000000',
    1234,
    ethers.id('omnivault-don')
  );
  await omniOracle.waitForDeployment();
  console.log('OmniOracle deployed to:', await omniOracle.getAddress());

  // Deploy MPCGateway
  console.log('\nDeploying MPCGateway...');
  const MPCGateway = await ethers.getContractFactory('MPCGateway');
  const mpcGateway = await MPCGateway.deploy(deployer.address);
  await mpcGateway.waitForDeployment();
  console.log('MPCGateway deployed to:', await mpcGateway.getAddress());

  // Deploy AgentRegistry
  console.log('\nDeploying AgentRegistry...');
  const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
  const agentRegistry = await AgentRegistry.deploy();
  await agentRegistry.waitForDeployment();
  console.log('AgentRegistry deployed to:', await agentRegistry.getAddress());

  // Deploy AgentVoting
  console.log('\nDeploying AgentVoting...');
  const AgentVoting = await ethers.getContractFactory('AgentVoting');
  const agentVoting = await AgentVoting.deploy(
    await agentRegistry.getAddress(),
    await investmentManager.getAddress(),
    await fundToken.getAddress()
  );
  await agentVoting.waitForDeployment();
  console.log('AgentVoting deployed to:', await agentVoting.getAddress());

  // Setup roles
  console.log('\nSetting up roles...');

  // FundToken roles
  const MINTER_ROLE = await fundToken.MINTER_ROLE();
  const BURNER_ROLE = await fundToken.BURNER_ROLE();
  await fundToken.grantRole(MINTER_ROLE, await fundVault.getAddress());
  await fundToken.grantRole(BURNER_ROLE, await fundVault.getAddress());
  console.log('FundToken roles granted to FundVault');

  // FundVault roles
  const INVESTOR_ROLE = await fundVault.INVESTOR_ROLE();
  await fundVault.grantRole(INVESTOR_ROLE, await investmentManager.getAddress());
  console.log('FundVault INVESTOR_ROLE granted to InvestmentManager');

  // InvestmentManager roles — AgentVoting holds AI_ORACLE_ROLE (not OmniOracle directly)
  const AI_ORACLE_ROLE  = await investmentManager.AI_ORACLE_ROLE();
  const RISK_AGENT_ROLE = await investmentManager.RISK_AGENT_ROLE();
  await investmentManager.grantRole(AI_ORACLE_ROLE,  await agentVoting.getAddress());
  await investmentManager.grantRole(RISK_AGENT_ROLE, deployer.address);
  console.log('InvestmentManager AI_ORACLE_ROLE granted to AgentVoting');
  console.log('InvestmentManager RISK_AGENT_ROLE granted to deployer');

  // OmniOracle roles
  const AUDIT_EXECUTOR_ROLE = await omniOracle.AUDIT_EXECUTOR_ROLE();
  await omniOracle.grantRole(AUDIT_EXECUTOR_ROLE, deployer.address);
  console.log('OmniOracle AUDIT_EXECUTOR_ROLE granted');

  // Register agent wallets in AgentRegistry (from env vars)
  const agentKeys = [
    process.env.AGENT1_ADDRESS,
    process.env.AGENT2_ADDRESS,
    process.env.AGENT3_ADDRESS,
  ].filter(Boolean);

  if (agentKeys.length > 0) {
    console.log(`\nRegistering ${agentKeys.length} AI agent(s)...`);
    for (const addr of agentKeys) {
      await agentRegistry.addAgent(addr);
      console.log('  Registered agent:', addr);
    }
  } else {
    console.log('\n⚠️  No AGENT1_ADDRESS / AGENT2_ADDRESS / AGENT3_ADDRESS set.');
    console.log('   Run: npx hardhat run scripts/register-agents.ts after setting env vars.');
  }

  console.log('\n=== Deployment Summary ===');
  console.log('FundToken:', await fundToken.getAddress());
  console.log('FundVault:', await fundVault.getAddress());
  console.log('InvestmentManager:', await investmentManager.getAddress());
  console.log('AgentRegistry:', await agentRegistry.getAddress());
  console.log('AgentVoting:', await agentVoting.getAddress());
  console.log('PromptRegistry:', await promptRegistry.getAddress());
  console.log('AuditTrail:', await auditTrail.getAddress());
  console.log('OmniOracle:', await omniOracle.getAddress());
  console.log('MPCGateway:', await mpcGateway.getAddress());

  console.log('\n=== Configuration for ai-service .env ===');
  console.log('INVESTMENT_MANAGER_ADDRESS=' + await investmentManager.getAddress());
  console.log('AGENT_VOTING_ADDRESS=' + await agentVoting.getAddress());

  console.log('\n=== Configuration for frontend .env.local ===');
  console.log('NEXT_PUBLIC_FUND_VAULT_ADDRESS=' + await fundVault.getAddress());
  console.log('NEXT_PUBLIC_FUND_TOKEN_ADDRESS=' + await fundToken.getAddress());
  console.log('NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=' + await investmentManager.getAddress());
  console.log('NEXT_PUBLIC_AGENT_VOTING_ADDRESS=' + await agentVoting.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
