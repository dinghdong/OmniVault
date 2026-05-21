import { ethers } from 'hardhat';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Poll for deployment receipt — 0G testnet RPC can be slow / drop connections. */
async function waitForDeploy(contract: any, label: string, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await contract.waitForDeployment();
      await sleep(2000); // brief pause after each deploy
      return;
    } catch {
      process.stdout.write(i === 0 ? `  Waiting for receipt` : '.');
      await sleep(4000);
    }
  }
  await contract.waitForDeployment();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await deployer.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log('Deploying contracts with account:', deployer.address);
  console.log('Account balance:', (await deployer.provider.getBalance(deployer.address)).toString());
  console.log('Network chainId:', chainId);

  // ── WETH / AAVE addresses ────────────────────────────────────────────────
  // On Arbitrum Sepolia (421614) use real addresses.
  // On everything else (0G testnet, localhost…) deploy Mocks.
  let WETH_ADDRESS: string;
  let AAVE_POOL_ADDRESS: string;
  let aWETH_ADDRESS: string;

  if (chainId === 421614) {
    // Arbitrum Sepolia
    WETH_ADDRESS      = '0x980B62Da97e3aB60eE028C4aC27e7dCE6B0FF3A8';
    AAVE_POOL_ADDRESS = '0x0b913A76beFF3887d3501b0f4a9Ca2Cc1142bCCc';
    aWETH_ADDRESS     = '0xE0d9b65b4C508feEFe4405C8aa7b08744C76d9C2';
    console.log('\nUsing real WETH/AAVE addresses (Arbitrum Sepolia)');
  } else {
    // Deploy mocks for 0G testnet / localhost
    console.log('\nDeploying Mock WETH + AAVE (testnet / local)...');

    const MockWETH = await ethers.getContractFactory('MockWETH');
    const mockWeth = await MockWETH.deploy();
    await waitForDeploy(mockWeth, "MockWETH");
    WETH_ADDRESS = await mockWeth.getAddress();
    console.log('MockWETH deployed to:', WETH_ADDRESS);

    const MockAavePool = await ethers.getContractFactory('MockAavePool');
    const mockAavePool = await MockAavePool.deploy();
    await waitForDeploy(mockAavePool, "MockAavePool");
    AAVE_POOL_ADDRESS = await mockAavePool.getAddress();
    console.log('MockAavePool deployed to:', AAVE_POOL_ADDRESS);

    const MockAToken = await ethers.getContractFactory('MockAToken');
    const mockAToken = await MockAToken.deploy(AAVE_POOL_ADDRESS, WETH_ADDRESS);
    await waitForDeploy(mockAToken, "MockAToken");
    aWETH_ADDRESS = await mockAToken.getAddress();
    console.log('MockAToken deployed to:', aWETH_ADDRESS);

    await mockAavePool.setAToken(WETH_ADDRESS, aWETH_ADDRESS);
    console.log('MockAavePool: aToken configured');
  }

  // Deploy FundToken
  console.log('\nDeploying FundToken...');
  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await waitForDeploy(fundToken, "FundToken");
  console.log('FundToken deployed to:', await fundToken.getAddress());

  // Deploy FundVault
  console.log('\nDeploying FundVault...');
  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await FundVault.deploy(
    WETH_ADDRESS,
    AAVE_POOL_ADDRESS,
    aWETH_ADDRESS,
    await fundToken.getAddress()
  );
  await waitForDeploy(fundVault, "FundVault");
  console.log('FundVault deployed to:', await fundVault.getAddress());

  // Deploy InvestmentManager
  console.log('\nDeploying InvestmentManager...');
  const InvestmentManager = await ethers.getContractFactory('InvestmentManager');
  const investmentManager = await InvestmentManager.deploy(
    await fundVault.getAddress(),
    WETH_ADDRESS
  );
  await waitForDeploy(investmentManager, "InvestmentManager");
  console.log('InvestmentManager deployed to:', await investmentManager.getAddress());

  // Deploy PromptRegistry
  console.log('\nDeploying PromptRegistry...');
  const PromptRegistry = await ethers.getContractFactory('PromptRegistry');
  const promptRegistry = await PromptRegistry.deploy(deployer.address);
  await waitForDeploy(promptRegistry, "PromptRegistry");
  console.log('PromptRegistry deployed to:', await promptRegistry.getAddress());

  // Deploy AuditTrail
  console.log('\nDeploying AuditTrail...');
  const AuditTrail = await ethers.getContractFactory('AuditTrail');
  const auditTrail = await AuditTrail.deploy();
  await waitForDeploy(auditTrail, "AuditTrail");
  console.log('AuditTrail deployed to:', await auditTrail.getAddress());

  // ── Chainlink Functions config per chain ──────────────────────────────────
  // Router & DON ID differ by network. Subscription ID comes from env.
  const CHAINLINK_CONFIG: Record<number, { router: string; donId: string }> = {
    11155111: { // Ethereum Sepolia
      router: '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0',
      donId:  '0x66756e2d657468657265756d2d7365706f6c69612d3100000000000000000000',
    },
    421614: { // Arbitrum Sepolia
      router: '0x234a5fb5Bd614a7AA2d0a75328f427c5A2E68CF9',
      donId:  '0x66756e2d617262697472756d2d7365706f6c69612d310000000000000000000000',
    },
  };
  const clConfig = CHAINLINK_CONFIG[chainId] ?? {
    router: process.env.FUNCTIONS_ROUTER || '0x0000000000000000000000000000000000000000',
    donId:  ethers.id('omnivault-don'),
  };
  const clSubId = parseInt(process.env.CHAINLINK_SUBSCRIPTION_ID || '0', 10);

  // Deploy OmniOracle (Chainlink Functions client)
  console.log('\nDeploying OmniOracle...');
  console.log('  Chainlink router:', clConfig.router);
  console.log('  Subscription ID:', clSubId);
  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  const omniOracle = await OmniOracle.deploy(
    clConfig.router,
    clSubId,
    clConfig.donId
  );
  await waitForDeploy(omniOracle, "OmniOracle");
  console.log('OmniOracle deployed to:', await omniOracle.getAddress());

  // Deploy MPCGateway
  console.log('\nDeploying MPCGateway...');
  const MPCGateway = await ethers.getContractFactory('MPCGateway');
  const mpcGateway = await MPCGateway.deploy(deployer.address);
  await waitForDeploy(mpcGateway, "MPCGateway");
  console.log('MPCGateway deployed to:', await mpcGateway.getAddress());

  // Deploy AgentRegistry
  console.log('\nDeploying AgentRegistry...');
  const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
  const agentRegistry = await AgentRegistry.deploy();
  await waitForDeploy(agentRegistry, "AgentRegistry");
  console.log('AgentRegistry deployed to:', await agentRegistry.getAddress());

  // Deploy AgentVoting
  console.log('\nDeploying AgentVoting...');
  const AgentVoting = await ethers.getContractFactory('AgentVoting');
  const agentVoting = await AgentVoting.deploy(
    await agentRegistry.getAddress(),
    await investmentManager.getAddress(),
    await fundToken.getAddress()
  );
  await waitForDeploy(agentVoting, "AgentVoting");
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
