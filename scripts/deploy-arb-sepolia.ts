/**
 * deploy-arb-sepolia.ts
 *
 * One-shot deployment to Arbitrum Sepolia:
 *   1. Deploy all contracts (FundToken, FundVault, InvestmentManager, OmniOracle, …)
 *   2. Create Chainlink Functions subscription programmatically
 *   3. Fund subscription with LINK (uses faucet drip if balance low)
 *   4. Add OmniOracle as consumer
 *   5. Write updated .env.local
 *
 * Usage:
 *   npx hardhat run scripts/deploy-arb-sepolia.ts --network arbitrumSepolia
 */
import { ethers } from 'hardhat';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// ── Arbitrum Sepolia Chainlink Constants ──────────────────────────────────────
const CL_ROUTER   = '0x234A5fB5Bd614a7aa2D0A75328f427c5a2e68Cf9';
const CL_DON_ID   = '0x66756e2d617262697472756d2d7365706f6c69612d310000000000000000000000';
const LINK_TOKEN  = '0xb1D4538B4571d411F07960EF2838Ce337FE1E80E';
// LINK faucet on Arb Sepolia (Chainlink provided)
const LINK_FAUCET = '0x4281eCF07378Ee595C564a59048801330f3084eE';

// ── Arbitrum Sepolia WETH / AAVE ──────────────────────────────────────────────
const WETH_ADDRESS      = '0x980b62da97e3aB60ee028C4AC27e7DCe6b0ff3A8';
const AAVE_POOL_ADDRESS = '0x0B913A76bEfF3887D3501B0f4A9cA2Cc1142bCcc';
const aWETH_ADDRESS     = '0xe0d9B65b4C508fEeFE4405c8Aa7b08744C76D9c2';

const SCORE_THRESHOLD = 60;

// ABIs (minimal)
const ROUTER_ABI = [
  'function createSubscription() external returns (uint64 subId)',
  'function addConsumer(uint64 subId, address consumer) external',
  'function getSubscription(uint64 subId) external view returns (uint96 balance, uint96 blockedBalance, address owner, address[] memory consumers)',
  'function fundSubscription(uint64 subId) external payable', // native billing
];
const LINK_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferAndCall(address to, uint256 value, bytes calldata data) returns (bool)',
];
const FAUCET_ABI = [
  'function drip(address to) external',
];

async function waitForDeploy(contract: any, name: string) {
  await contract.waitForDeployment();
  console.log(`  ✓ ${name} → ${await contract.getAddress()}`);
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
  console.log('Deployer:', signer.address);
  console.log('ETH balance:', ethers.formatEther(bal), 'ETH');
  console.log('');

  // ── 1. Deploy contracts ───────────────────────────────────────────────────

  console.log('1. Deploying FundToken…');
  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await waitForDeploy(fundToken, 'FundToken');

  console.log('2. Deploying FundVault…');
  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await FundVault.deploy(WETH_ADDRESS, AAVE_POOL_ADDRESS, aWETH_ADDRESS, await fundToken.getAddress());
  await waitForDeploy(fundVault, 'FundVault');

  console.log('3. Deploying InvestmentManager…');
  const IM = await ethers.getContractFactory('InvestmentManager');
  const im = await IM.deploy(await fundVault.getAddress(), WETH_ADDRESS, SCORE_THRESHOLD);
  await waitForDeploy(im, 'InvestmentManager');

  console.log('4. Deploying AuditTrail…');
  const AuditTrail = await ethers.getContractFactory('AuditTrail');
  const auditTrail = await AuditTrail.deploy();
  await waitForDeploy(auditTrail, 'AuditTrail');

  // Create Chainlink subscription BEFORE deploying OmniOracle (need subId)
  console.log('');
  console.log('5. Creating Chainlink Functions subscription…');
  const router = new ethers.Contract(CL_ROUTER, ROUTER_ABI, signer);
  const createTx = await router.createSubscription();
  const receipt  = await createTx.wait();

  // Extract subId from SubscriptionCreated event (topic[1] = subId as uint64)
  let subId = 0n;
  for (const log of receipt.logs) {
    // SubscriptionCreated(uint64 indexed subscriptionId, address owner)
    if (log.topics.length >= 2) {
      const potentialId = BigInt(log.topics[1]);
      if (potentialId > 0n && potentialId < 1_000_000n) {
        subId = potentialId;
        break;
      }
    }
  }
  if (subId === 0n) throw new Error('Could not parse subscription ID from receipt');
  console.log(`  ✓ Subscription created: #${subId}`);

  // ── 2. Fund subscription with LINK ───────────────────────────────────────

  console.log('6. Checking LINK balance…');
  const link = new ethers.Contract(LINK_TOKEN, LINK_ABI, signer);
  let linkBal = await link.balanceOf(signer.address);
  console.log(`  LINK balance: ${ethers.formatEther(linkBal)} LINK`);

  // Drip from faucet if < 2 LINK
  if (linkBal < ethers.parseEther('2')) {
    console.log('  Low LINK — requesting from faucet…');
    try {
      const faucet = new ethers.Contract(LINK_FAUCET, FAUCET_ABI, signer);
      const faucetTx = await faucet.drip(signer.address, { gasLimit: 100_000 });
      await faucetTx.wait();
      linkBal = await link.balanceOf(signer.address);
      console.log(`  ✓ After drip: ${ethers.formatEther(linkBal)} LINK`);
    } catch (e: any) {
      console.warn('  ⚠ Faucet drip failed:', e.message?.slice(0, 80));
      console.warn('  Get LINK at: https://faucets.chain.link/arbitrum-sepolia');
    }
  }

  // Fund subscription: transferAndCall(router, 2 LINK, abi.encode(subId))
  if (linkBal >= ethers.parseEther('1')) {
    const fundAmount = linkBal >= ethers.parseEther('2')
      ? ethers.parseEther('2')
      : linkBal;
    console.log(`  Funding subscription with ${ethers.formatEther(fundAmount)} LINK…`);
    const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint64'], [subId]);
    const fundTx = await link.transferAndCall(CL_ROUTER, fundAmount, data);
    await fundTx.wait();
    console.log('  ✓ Subscription funded');
  } else {
    console.warn('  ⚠ Insufficient LINK — subscription created but not funded');
    console.warn('  Fund manually at: https://functions.chain.link (Arbitrum Sepolia)');
  }

  // ── 3. Deploy OmniOracle with subId ──────────────────────────────────────

  console.log(`7. Deploying OmniOracle (subId=${subId})…`);
  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  const oracle = await OmniOracle.deploy(CL_ROUTER, subId, CL_DON_ID);
  await waitForDeploy(oracle, 'OmniOracle');

  // ── 4. Add OmniOracle as Chainlink consumer ───────────────────────────────

  console.log('8. Adding OmniOracle as Chainlink consumer…');
  const addTx = await router.addConsumer(subId, await oracle.getAddress());
  await addTx.wait();
  console.log('  ✓ Consumer added');

  // ── 5. Wire contracts ─────────────────────────────────────────────────────

  console.log('9. Wiring contracts…');
  const INVESTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('INVESTOR_ROLE'));

  await (await im.setOracle(await oracle.getAddress())).wait();
  await (await oracle.setInvestmentManager(await im.getAddress())).wait();
  await (await fundVault.grantRole(INVESTOR_ROLE, await im.getAddress())).wait();
  await (await fundToken.setVault(await fundVault.getAddress())).wait();
  console.log('  ✓ All roles and references set');

  // ── 6. Update .env.local ─────────────────────────────────────────────────

  const addresses = {
    fundToken:    await fundToken.getAddress(),
    fundVault:    await fundVault.getAddress(),
    im:           await im.getAddress(),
    oracle:       await oracle.getAddress(),
    auditTrail:   await auditTrail.getAddress(),
  };

  const envPath = join(__dirname, '../frontend/.env.local');
  let envContent = readFileSync(envPath, 'utf-8');

  // Switch to Arbitrum Sepolia
  envContent = envContent
    .replace(/^NEXT_PUBLIC_CHAIN_ID=.*/m,    'NEXT_PUBLIC_CHAIN_ID=421614')
    .replace(/^NEXT_PUBLIC_EXPLORER_URL=.*/m, 'NEXT_PUBLIC_EXPLORER_URL=https://sepolia.arbiscan.io')
    .replace(/^NEXT_PUBLIC_FUND_TOKEN_ADDRESS=.*/m,         `NEXT_PUBLIC_FUND_TOKEN_ADDRESS=${addresses.fundToken}`)
    .replace(/^NEXT_PUBLIC_FUND_VAULT_ADDRESS=.*/m,         `NEXT_PUBLIC_FUND_VAULT_ADDRESS=${addresses.fundVault}`)
    .replace(/^NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=.*/m, `NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${addresses.im}`)
    .replace(/^NEXT_PUBLIC_OMNI_ORACLE_ADDRESS=.*/m,        `NEXT_PUBLIC_OMNI_ORACLE_ADDRESS=${addresses.oracle}`)
    .replace(/^NEXT_PUBLIC_AUDIT_TRAIL_ADDRESS=.*/m,        `NEXT_PUBLIC_AUDIT_TRAIL_ADDRESS=${addresses.auditTrail}`);

  writeFileSync(envPath, envContent);
  console.log('  ✓ frontend/.env.local updated');

  // Update root .env with new subscription ID
  const rootEnvPath = join(__dirname, '../.env');
  let rootEnv = readFileSync(rootEnvPath, 'utf-8');
  rootEnv = rootEnv.replace(/^CHAINLINK_SUBSCRIPTION_ID=.*/m, `CHAINLINK_SUBSCRIPTION_ID=${subId}`);
  writeFileSync(rootEnvPath, rootEnv);
  console.log('  ✓ .env CHAINLINK_SUBSCRIPTION_ID updated to', String(subId));

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('✅  Arbitrum Sepolia deployment complete!');
  console.log('');
  console.log('Chainlink subscription #', String(subId));
  console.log('FundToken:            ', addresses.fundToken);
  console.log('FundVault:            ', addresses.fundVault);
  console.log('InvestmentManager:    ', addresses.im);
  console.log('OmniOracle:           ', addresses.oracle);
  console.log('AuditTrail:           ', addresses.auditTrail);
  console.log('');
  console.log('frontend/.env.local → chain 421614, all addresses updated');
  console.log('══════════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
