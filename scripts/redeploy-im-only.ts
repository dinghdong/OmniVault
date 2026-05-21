/**
 * redeploy-im-only.ts
 *
 * Redeploys ONLY InvestmentManager (keeps existing OmniOracle, FundVault, FundToken).
 * Use after modifying InvestmentManager.sol (e.g. LP veto access control change).
 *
 * Usage:
 *   npx hardhat run scripts/redeploy-im-only.ts --network arbitrumSepolia
 *   npx hardhat run scripts/redeploy-im-only.ts --network sepolia
 *
 * After running, update frontend/.env.local:
 *   NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=<new address printed below>
 */
import { ethers } from 'hardhat';

// ── Already deployed (do NOT change) ───────────────────────────────────────────
const FUND_VAULT    = '0xB6f1b5052215eA305dc19d295e037226D949BE89';
const WETH          = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';
const OMNI_ORACLE   = '0x2FbbA381BB0d69f182ba2E91bC862688C90aCce6'; // keep existing oracle
const OLD_IM        = '0x4444554C2483853970eaF00697Ae81E2ffee9434'; // revoke role from this

// ── Parameters ─────────────────────────────────────────────────────────────────
const SCORE_THRESHOLD = 60;

// ── Minimal ABIs ────────────────────────────────────────────────────────────────
const FUND_VAULT_ABI = [
  'function grantRole(bytes32, address) external',
  'function revokeRole(bytes32, address) external',
  'function hasRole(bytes32, address) view returns (bool)',
];

const ORACLE_ABI = [
  'function setInvestmentManager(address) external',
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log('Deployer:', signer.address);
  console.log('Network: ', (await ethers.provider.getNetwork()).name);
  console.log('');

  const INVESTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('INVESTOR_ROLE'));

  // ── 1. Deploy new InvestmentManager ──────────────────────────────────────────
  console.log('1. Deploying InvestmentManager (LP veto)…');
  const IMFactory = await ethers.getContractFactory('InvestmentManager');
  const im = await IMFactory.deploy(FUND_VAULT, WETH, SCORE_THRESHOLD);
  await im.waitForDeployment();
  const newImAddr = await im.getAddress();
  console.log('   ✓ Deployed:', newImAddr);

  // ── 2. Set oracle reference on new IM ────────────────────────────────────────
  console.log('2. Wiring new IM → existing OmniOracle…');
  await (await im.setOracle(OMNI_ORACLE)).wait();
  console.log('   ✓ im.oracle =', OMNI_ORACLE);

  // ── 3. Wire OmniOracle → new IM ──────────────────────────────────────────────
  console.log('3. Wiring OmniOracle → new IM…');
  const oracle = new ethers.Contract(OMNI_ORACLE, ORACLE_ABI, signer);
  await (await oracle.setInvestmentManager(newImAddr)).wait();
  console.log('   ✓ oracle.investmentManager =', newImAddr);

  // ── 4. Grant INVESTOR_ROLE on FundVault ──────────────────────────────────────
  console.log('4. Granting INVESTOR_ROLE to new IM on FundVault…');
  const fundVault = new ethers.Contract(FUND_VAULT, FUND_VAULT_ABI, signer);
  await (await fundVault.grantRole(INVESTOR_ROLE, newImAddr)).wait();
  console.log('   ✓ INVESTOR_ROLE granted to', newImAddr);

  // ── 5. Revoke role from old IM ────────────────────────────────────────────────
  console.log('5. Revoking INVESTOR_ROLE from old IM…');
  try {
    const hasRole = await fundVault.hasRole(INVESTOR_ROLE, OLD_IM);
    if (hasRole) {
      await (await fundVault.revokeRole(INVESTOR_ROLE, OLD_IM)).wait();
      console.log('   ✓ INVESTOR_ROLE revoked from', OLD_IM);
    } else {
      console.log('   ℹ Old IM already does not have INVESTOR_ROLE');
    }
  } catch (e) {
    console.warn('   ⚠ Could not revoke from old IM (may not have role):', (e as Error).message);
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('✅  Redeployment complete!');
  console.log('');
  console.log('New InvestmentManager:', newImAddr);
  console.log('OmniOracle (unchanged):', OMNI_ORACLE);
  console.log('');
  console.log('Update frontend/.env.local:');
  console.log(`  NEXT_PUBLIC_INVESTMENT_MANAGER_ADDRESS=${newImAddr}`);
  console.log('══════════════════════════════════════════════════════');
}

main().catch((e) => { console.error(e); process.exit(1); });
