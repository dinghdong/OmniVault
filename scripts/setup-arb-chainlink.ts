/**
 * setup-arb-chainlink.ts
 *
 * Continues Arbitrum Sepolia setup from already-deployed contracts.
 * Uses MockOmniOracle (no Chainlink ToS required) for demo / hackathon purposes.
 *
 * Already deployed:
 *   FundToken   0xB6f1b5052215eA305dc19d295e037226D949BE89
 *   FundVault   0x4Df38509eb380215DC1dC9Cf0226269c0Ad4B8Cf
 *   IM          0x4f4882929d46588f6Ce366Fc791d6ADD40FcaBD1
 *   AuditTrail  0x2A4deC60147916152A871B28E5C3D63512Fa1135
 *
 * Usage:
 *   npx hardhat run scripts/setup-arb-chainlink.ts --network arbitrumSepolia
 */
import { ethers } from 'hardhat';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// ── Already deployed on Arbitrum Sepolia ──────────────────────────────────────
const FUND_TOKEN   = '0xB6f1b5052215eA305dc19d295e037226D949BE89';
const FUND_VAULT   = '0x4Df38509eb380215DC1dC9Cf0226269c0Ad4B8Cf';
const IM           = '0x4f4882929d46588f6Ce366Fc791d6ADD40FcaBD1';
const AUDIT_TRAIL  = '0x2A4deC60147916152A871B28E5C3D63512Fa1135';

const INVESTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('INVESTOR_ROLE'));

const IM_ABI     = ['function setOracle(address) external'];
const ORACLE_ABI = ['function setInvestmentManager(address) external'];
const TOKEN_ABI  = ['function setVault(address) external'];
const VAULT_ABI  = ['function grantRole(bytes32, address) external'];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log('Signer:', signer.address);

  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 421614) {
    throw new Error(`Wrong network: expected Arbitrum Sepolia (421614), got ${network.chainId}`);
  }
  console.log('');

  // ── 1. Deploy MockOmniOracle ──────────────────────────────────────────────

  console.log('1. Deploying MockOmniOracle (no Chainlink ToS required)…');
  const OracleFactory = await ethers.getContractFactory('MockOmniOracle');
  const oracle = await OracleFactory.deploy();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log('  ✓ MockOmniOracle:', oracleAddr);

  // ── 2. Wire contracts ─────────────────────────────────────────────────────

  console.log('2. Wiring contracts…');

  const imContract     = new ethers.Contract(IM, IM_ABI, signer);
  const oracleContract = new ethers.Contract(oracleAddr, ORACLE_ABI, signer);
  const vaultContract  = new ethers.Contract(FUND_VAULT, VAULT_ABI, signer);
  const tokenContract  = new ethers.Contract(FUND_TOKEN, TOKEN_ABI, signer);

  await (await imContract.setOracle(oracleAddr)).wait();
  console.log('  ✓ IM.setOracle done');

  await (await oracleContract.setInvestmentManager(IM)).wait();
  console.log('  ✓ Oracle.setInvestmentManager done');

  await (await vaultContract.grantRole(INVESTOR_ROLE, IM)).wait();
  console.log('  ✓ FundVault INVESTOR_ROLE granted to IM');

  try {
    await (await tokenContract.setVault(FUND_VAULT)).wait();
    console.log('  ✓ FundToken.setVault done');
  } catch { console.log('  ℹ FundToken.setVault skipped (may not exist or already set)'); }

  // ── 3. Update frontend/.env.local ────────────────────────────────────────

  console.log('3. Updating frontend/.env.local…');
  const envPath = join(__dirname, '../frontend/.env.local');
  let env = readFileSync(envPath, 'utf-8');

  env = env
    .replace(/^NEXT_PUBLIC_CHAIN_ID=.*/m,                   'NEXT_PUBLIC_CHAIN_ID=421614')
    .replace(/^NEXT_PUBLIC_EXPLORER_URL=.*/m,               'NEXT_PUBLIC_EXPLORER_URL=https://sepolia.arbiscan.io')
    .replace(/^NEXT_PUBLIC_FUND_TOKEN_ADDRESS=.*/m,         `NEXT_PUBLIC_FUND_TOKEN_ADDRESS=${FUND_TOKEN}`)
    .replace(/^NEXT_PUBLIC_FUND_VAULT_ADDRESS=.*/m,         `NEXT_PUBLIC_FUND_VAULT_ADDRESS=${FUND_VAULT}`)
    .replace(/^NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=.*/m, `NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${IM}`)
    .replace(/^NEXT_PUBLIC_OMNI_ORACLE_ADDRESS=.*/m,        `NEXT_PUBLIC_OMNI_ORACLE_ADDRESS=${oracleAddr}`)
    .replace(/^NEXT_PUBLIC_AUDIT_TRAIL_ADDRESS=.*/m,        `NEXT_PUBLIC_AUDIT_TRAIL_ADDRESS=${AUDIT_TRAIL}`);

  writeFileSync(envPath, env);
  console.log('  ✓ .env.local updated');

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n════════════════════════════════════════════════');
  console.log('✅  Arbitrum Sepolia configured!');
  console.log('');
  console.log('Chain:              421614 (Arbitrum Sepolia)');
  console.log('FundToken:         ', FUND_TOKEN);
  console.log('FundVault:         ', FUND_VAULT);
  console.log('InvestmentManager: ', IM);
  console.log('MockOmniOracle:    ', oracleAddr);
  console.log('AuditTrail:        ', AUDIT_TRAIL);
  console.log('');
  console.log('Demo flow:');
  console.log('  1. submitProject() → project enters Auditing state');
  console.log('  2. call MockOmniOracle.autoApprove(projectId) to simulate AI result');
  console.log('  3. settleAudit(projectId) → PendingExecution + 72h timelock');
  console.log('  4. LP veto window active; executeInvestment() after timelock');
  console.log('════════════════════════════════════════════════');
  console.log('');
  console.log('Next: restart the frontend → cd frontend && npm run dev');
}

main().catch(e => { console.error(e); process.exit(1); });
