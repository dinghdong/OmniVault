/**
 * deploy-sepolia.ts — Full deployment to Ethereum Sepolia
 *
 * Usage:
 *   npx hardhat run scripts/deploy-sepolia.ts --network sepolia
 *
 * Prerequisites:
 *   1. Create a Chainlink Functions subscription at https://functions.chain.link
 *      (Sepolia network) and top it up with LINK.
 *   2. Note your subscription ID.
 *   3. After deployment, add the OmniOracle address as a consumer in the subscription UI.
 *   4. Upload DON-hosted secrets (ZG_API_KEY, ZG_BASE_URL) via:
 *        npx hardhat run scripts/upload-secrets.ts --network sepolia
 *
 * Environment variables needed (in .env):
 *   PRIVATE_KEY                     — deployer private key
 *   CHAINLINK_SUBSCRIPTION_ID       — from step 1
 *   CHAINLINK_SECRETS_SLOT_ID       — from upload-secrets.ts (default 0)
 *   CHAINLINK_SECRETS_VERSION       — from upload-secrets.ts
 *
 * Contract addresses on Sepolia (as of 2026):
 *   Chainlink Functions Router : 0xb83E47C2bC239B3bf370bc41e1459A34b41238D0
 *   DON ID                     : fun-ethereum-sepolia-1
 *   AAVE V3 Pool               : 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
 *   WETH (AAVE test token)     : 0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c
 *   aWETH                      : 0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830
 */

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// ─── Sepolia Constants ───────────────────────────────────────────────────────
const SEPOLIA = {
  chainlinkRouter  : '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0',
  donId            : ethers.encodeBytes32String('fun-ethereum-sepolia-1'),
  aavePool         : '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
  weth             : '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c',
  aWeth            : '0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830',
};

// Audit score threshold: 60 / 100  (60%)
const SCORE_THRESHOLD = 60;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  OmniVault — Sepolia Deployment');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log('');

  const subId        = parseInt(process.env.CHAINLINK_SUBSCRIPTION_ID || '0');
  const secretsSlot  = parseInt(process.env.CHAINLINK_SECRETS_SLOT_ID || '0');
  const secretsVer   = parseInt(process.env.CHAINLINK_SECRETS_VERSION || '0');

  if (!subId) {
    console.warn('⚠  CHAINLINK_SUBSCRIPTION_ID not set — set it after creating a subscription at https://functions.chain.link');
  }

  // ── 1. Deploy FundToken ────────────────────────────────────────────────────
  console.log('1. Deploying FundToken...');
  const FundToken = await ethers.getContractFactory('FundToken');
  const fundToken = await FundToken.deploy();
  await fundToken.waitForDeployment();
  const fundTokenAddr = await fundToken.getAddress();
  console.log(`   FundToken        → ${fundTokenAddr}`);

  // ── 2. Deploy FundVault ────────────────────────────────────────────────────
  console.log('2. Deploying FundVault...');
  const FundVault = await ethers.getContractFactory('FundVault');
  const fundVault = await FundVault.deploy(
    SEPOLIA.weth,
    SEPOLIA.aavePool,
    SEPOLIA.aWeth,
    fundTokenAddr,
  );
  await fundVault.waitForDeployment();
  const fundVaultAddr = await fundVault.getAddress();
  console.log(`   FundVault        → ${fundVaultAddr}`);

  // ── 3. Wire FundToken → FundVault (grant MINTER_ROLE) ─────────────────────
  console.log('3. Granting FundToken MINTER_ROLE to FundVault...');
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('MINTER_ROLE'));
  await (await fundToken.grantRole(MINTER_ROLE, fundVaultAddr)).wait();
  console.log('   Done.');

  // ── 4. Deploy InvestmentManager ────────────────────────────────────────────
  console.log('4. Deploying InvestmentManager...');
  const InvestmentManager = await ethers.getContractFactory('InvestmentManager');
  const im = await InvestmentManager.deploy(
    fundVaultAddr,
    SEPOLIA.weth,
    SCORE_THRESHOLD,
  );
  await im.waitForDeployment();
  const imAddr = await im.getAddress();
  console.log(`   InvestmentManager→ ${imAddr}`);

  // ── 5. Grant InvestmentManager INVESTOR_ROLE on FundVault ─────────────────
  console.log('5. Granting INVESTOR_ROLE to InvestmentManager...');
  const INVESTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('INVESTOR_ROLE'));
  await (await fundVault.grantRole(INVESTOR_ROLE, imAddr)).wait();
  console.log('   Done.');

  // ── 6. Deploy OmniOracle ───────────────────────────────────────────────────
  console.log('6. Deploying OmniOracle...');
  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  const oracle = await OmniOracle.deploy(
    SEPOLIA.chainlinkRouter,
    subId,
    SEPOLIA.donId,
  );
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`   OmniOracle       → ${oracleAddr}`);

  // ── 7. Upload Chainlink Functions JS source to OmniOracle ─────────────────
  console.log('7. Uploading audit source to OmniOracle...');
  const sourcePath = path.join(__dirname, '../chainlink/audit-source.js');
  const auditSource = fs.readFileSync(sourcePath, 'utf8');
  await (await oracle.setAuditSource(auditSource)).wait();
  console.log(`   Source uploaded (${auditSource.length} chars)`);

  // ── 8. Configure DON-hosted secrets ───────────────────────────────────────
  if (secretsVer > 0) {
    console.log(`8. Setting secrets config (slot=${secretsSlot}, version=${secretsVer})...`);
    await (await oracle.setSecretsConfig(secretsSlot, secretsVer)).wait();
    console.log('   Done.');
  } else {
    console.log('8. ⚠  Secrets not configured — run upload-secrets.ts then call setSecretsConfig()');
  }

  // ── 9. Wire Oracle ↔ InvestmentManager ────────────────────────────────────
  console.log('9. Wiring Oracle ↔ InvestmentManager...');
  // OmniOracle knows IM (for calling fulfillAudit) + grants AI_ORACLE_ROLE to oracle
  await (await oracle.setInvestmentManager(imAddr)).wait();
  // IM knows Oracle (calls requestAudit) + grants AI_ORACLE_ROLE to oracle
  await (await im.setOracle(oracleAddr)).wait();
  console.log('   Done.');

  // ── 10. Deploy AuditTrail (on-chain event log) ────────────────────────────
  console.log('10. Deploying AuditTrail...');
  const AuditTrail = await ethers.getContractFactory('AuditTrail');
  const auditTrail = await AuditTrail.deploy();
  await auditTrail.waitForDeployment();
  const auditTrailAddr = await auditTrail.getAddress();
  console.log(`    AuditTrail       → ${auditTrailAddr}`);

  // ── 11. Deploy ComputeAuditTrail ───────────────────────────────────────────
  console.log('11. Deploying ComputeAuditTrail...');
  const ComputeAuditTrail = await ethers.getContractFactory('ComputeAuditTrail');
  const computeTrail = await ComputeAuditTrail.deploy();
  await computeTrail.waitForDeployment();
  const computeTrailAddr = await computeTrail.getAddress();
  console.log(`    ComputeAuditTrail→ ${computeTrailAddr}`);

  // ── 12. Summary ────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Deployment Complete — Sepolia');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  FundToken         : ${fundTokenAddr}`);
  console.log(`  FundVault         : ${fundVaultAddr}`);
  console.log(`  InvestmentManager : ${imAddr}`);
  console.log(`  OmniOracle        : ${oracleAddr}`);
  console.log(`  AuditTrail        : ${auditTrailAddr}`);
  console.log(`  ComputeAuditTrail : ${computeTrailAddr}`);
  console.log('');
  console.log('  Next steps:');
  console.log(`  1. Add OmniOracle (${oracleAddr}) as a consumer in your`);
  console.log('     Chainlink Functions subscription at https://functions.chain.link');
  if (!secretsVer) {
    console.log('  2. Upload DON secrets: npx hardhat run scripts/upload-secrets.ts --network sepolia');
    console.log('  3. Call oracle.setSecretsConfig(slotId, version) with the returned values');
  }
  console.log('');
  console.log('  Add to frontend/.env.local:');
  console.log(`  NEXT_PUBLIC_CHAIN_ID=11155111`);
  console.log(`  NEXT_PUBLIC_EXPLORER_URL=https://sepolia.etherscan.io`);
  console.log(`  NEXT_PUBLIC_FUND_TOKEN_ADDRESS=${fundTokenAddr}`);
  console.log(`  NEXT_PUBLIC_FUND_VAULT_ADDRESS=${fundVaultAddr}`);
  console.log(`  NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${imAddr}`);
  console.log(`  NEXT_PUBLIC_OMNI_ORACLE_ADDRESS=${oracleAddr}`);
  console.log(`  NEXT_PUBLIC_AUDIT_TRAIL_ADDRESS=${auditTrailAddr}`);
  console.log(`  NEXT_PUBLIC_COMPUTE_TRAIL_ADDRESS=${computeTrailAddr}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error(err); process.exit(1); });
