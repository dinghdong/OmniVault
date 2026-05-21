import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// ── Unchanged (already deployed) ────────────────────────────────────────────
const FUND_VAULT   = '0xB6f1b5052215eA305dc19d295e037226D949BE89';
const WETH         = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';
const LINK_TOKEN   = '0x779877A7B0D9E8603169DdbD7836e478b4624789';
const OLD_IM       = '0x4f4882929d46588f6Ce366Fc791d6ADD40FcaBD1'; // to revoke role

// ── Chainlink Functions (Sepolia) ────────────────────────────────────────────
const FUNCTIONS_ROUTER = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';
const DON_ID           = ethers.encodeBytes32String('fun-ethereum-sepolia-1');
const SUB_ID           = 6554n;
const CALLBACK_GAS     = 90_000;   // coordinator max; packed struct keeps IM well within budget

// ── Shared ABIs ──────────────────────────────────────────────────────────────
const FUND_VAULT_ABI = [
  'function grantRole(bytes32 role, address account) external',
  'function revokeRole(bytes32 role, address account) external',
  'function hasRole(bytes32 role, address account) view returns (bool)',
];
const ROUTER_ABI = [
  'function addConsumer(uint64 subscriptionId, address consumer) external',
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log('Deployer:', signer.address);

  const INVESTOR_ROLE  = ethers.keccak256(ethers.toUtf8Bytes('INVESTOR_ROLE'));
  const SCORE_THRESHOLD = 60;

  // ── 1. Deploy new InvestmentManager ────────────────────────────────────────
  const InvestmentManager = await ethers.getContractFactory('InvestmentManager');
  console.log('\n1. Deploying InvestmentManager...');
  const im = await InvestmentManager.deploy(FUND_VAULT, WETH, SCORE_THRESHOLD);
  await im.waitForDeployment();
  const imAddr = await im.getAddress();
  console.log('✓ InvestmentManager deployed:', imAddr);

  // ── 2. Grant INVESTOR_ROLE to new IM on FundVault ──────────────────────────
  console.log('2. Granting INVESTOR_ROLE to new InvestmentManager...');
  const fundVault = new ethers.Contract(FUND_VAULT, FUND_VAULT_ABI, signer);
  await (await fundVault.grantRole(INVESTOR_ROLE, imAddr)).wait();
  console.log('✓ INVESTOR_ROLE granted to', imAddr);

  // Revoke role from old IM
  try {
    const hasRole = await fundVault.hasRole(INVESTOR_ROLE, OLD_IM);
    if (hasRole) {
      await (await fundVault.revokeRole(INVESTOR_ROLE, OLD_IM)).wait();
      console.log('✓ INVESTOR_ROLE revoked from old IM', OLD_IM);
    }
  } catch { /* ignore if already revoked */ }

  // ── 3. Deploy new OmniOracle ────────────────────────────────────────────────
  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  console.log('\n3. Deploying OmniOracle...');
  const oracle = await OmniOracle.deploy(FUNCTIONS_ROUTER, SUB_ID, DON_ID);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log('✓ OmniOracle deployed:', oracleAddr);

  // ── 4. Set callback gas limit ───────────────────────────────────────────────
  console.log('4. Setting callbackGasLimit to', CALLBACK_GAS, '...');
  await (await oracle.setCallbackGasLimit(CALLBACK_GAS)).wait();
  console.log('✓ Gas limit set');

  // ── 5. Upload audit source ──────────────────────────────────────────────────
  const sourcePath = path.join(__dirname, '../chainlink/audit-source.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  console.log('5. Uploading audit source...');
  await (await oracle.setAuditSource(source)).wait();
  console.log('✓ Audit source uploaded');

  // ── 6. Wire bidirectionally ─────────────────────────────────────────────────
  console.log('6. Wiring oracle ↔ InvestmentManager...');
  await (await im.setOracle(oracleAddr)).wait();
  console.log('✓ InvestmentManager.oracle =', oracleAddr);
  await (await oracle.setInvestmentManager(imAddr)).wait();
  console.log('✓ OmniOracle.investmentManager =', imAddr);

  // ── 7. Add oracle as Chainlink consumer ─────────────────────────────────────
  console.log('7. Adding OmniOracle as Chainlink consumer (sub', SUB_ID.toString(), ')...');
  const router = new ethers.Contract(FUNCTIONS_ROUTER, ROUTER_ABI, signer);
  await (await router.addConsumer(SUB_ID, oracleAddr)).wait();
  console.log('✓ Consumer added');

  console.log('\n══════════════════════════════════════════');
  console.log('New InvestmentManager:', imAddr);
  console.log('New OmniOracle:       ', oracleAddr);
  console.log('\nUpdate frontend/.env.local:');
  console.log(`NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${imAddr}`);
  console.log(`NEXT_PUBLIC_OMNI_ORACLE_ADDRESS=${oracleAddr}`);
  console.log('══════════════════════════════════════════');
}

main().catch(console.error);
