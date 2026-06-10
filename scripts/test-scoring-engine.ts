/**
 * test-scoring-engine.ts
 *
 * On-chain integration test for the deployed Stylus ScoringEngine.
 * Run: npx hardhat run scripts/test-scoring-engine.ts --network arbitrumSepolia
 */

import { ethers } from 'hardhat';

const SCORING_ENGINE_ADDRESS = '0xeb07843c0423208a087460bcc1ee6ec9de8d6566';

const ABI = [
  'function computeScore(uint8 r, uint8 q, uint8 m) external view returns (uint8 finalScore, bool approved)',
  'function computeScoreWeighted(uint8 r, uint8 q, uint8 m, uint256 wR, uint256 wQ, uint256 wM, uint8 threshold) external view returns (uint8 finalScore, bool approved)',
  'function defaultConfig() external view returns (uint256 wReliability, uint256 wQuality, uint256 wMarketFit, uint8 threshold)',
];

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 421614) {
    throw new Error(`Wrong network: expected Arbitrum Sepolia (421614), got ${network.chainId}`);
  }

  const contract = await ethers.getContractAt(ABI, SCORING_ENGINE_ADDRESS);

  console.log('\n=== ScoringEngine On-Chain Integration Tests ===');
  console.log(`Contract: ${SCORING_ENGINE_ADDRESS}`);
  console.log('');

  // 1. defaultConfig
  console.log('1. defaultConfig():');
  const [wR, wQ, wM, threshold] = await contract.defaultConfig();
  assert(Number(wR) === 4_000, 'wReliability = 4000');
  assert(Number(wQ) === 3_000, 'wQuality = 3000');
  assert(Number(wM) === 3_000, 'wMarketFit = 3000');
  assert(Number(threshold) === 60, 'threshold = 60');

  // 2. computeScore basic cases
  console.log('\n2. computeScore — basic cases:');
  {
    const [s, approved] = await contract.computeScore(0, 0, 0);
    assert(Number(s) === 0 && !approved, 'all-zero → 0, rejected');
  }
  {
    const [s, approved] = await contract.computeScore(100, 100, 100);
    assert(Number(s) === 100 && approved, 'all-100 → 100, approved');
  }
  {
    const [s, approved] = await contract.computeScore(60, 60, 60);
    assert(Number(s) === 60 && approved, 'all-60 → 60, approved (boundary)');
  }

  // 3. weight breakdown
  console.log('\n3. weight breakdown (single dimension at 100):');
  {
    const [s] = await contract.computeScore(100, 0, 0);
    assert(Number(s) === 40, 'reliability=100, rest=0 → 40 (40% weight)');
  }
  {
    const [s] = await contract.computeScore(0, 100, 0);
    assert(Number(s) === 30, 'quality=100, rest=0 → 30 (30% weight)');
  }
  {
    const [s] = await contract.computeScore(0, 0, 100);
    assert(Number(s) === 30, 'marketFit=100, rest=0 → 30 (30% weight)');
  }

  // 4. realistic AI agent scenarios
  console.log('\n4. realistic AI agent scenarios:');
  {
    // (90×4000 + 85×3000 + 80×3000)/10000 = 85
    const [s, approved] = await contract.computeScore(90, 85, 80);
    assert(Number(s) === 85 && approved, 'high-quality agent (90,85,80) → 85, approved');
  }
  {
    // (50×4000 + 70×3000 + 65×3000)/10000 = 60 — barely approved
    const [s, approved] = await contract.computeScore(50, 70, 65);
    assert(Number(s) === 60 && approved, 'borderline agent (50,70,65) → 60, barely approved');
  }
  {
    // (30×4000 + 50×3000 + 40×3000)/10000 = 39
    const [s, approved] = await contract.computeScore(30, 50, 40);
    assert(Number(s) === 39 && !approved, 'rejected agent (30,50,40) → 39, rejected');
  }

  // 5. computeScoreWeighted
  console.log('\n5. computeScoreWeighted — custom weights:');
  {
    // (80×3333 + 60×3333 + 40×3334)/10000 = 59
    const [s, approved] = await contract.computeScoreWeighted(80, 60, 40, 3333, 3333, 3334, 60);
    assert(Number(s) === 59 && !approved, 'equal-split (80,60,40) → 59, rejected');
  }
  {
    // reliability-dominant: (90×6000 + 50×2000 + 50×2000)/10000 = 74
    const [s, approved] = await contract.computeScoreWeighted(90, 50, 50, 6000, 2000, 2000, 70);
    assert(Number(s) === 74 && approved, 'reliability-dominant (90,50,50 w=60/20/20) → 74, approved');
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('✅  All ScoringEngine on-chain tests passed!');
  console.log(`Explorer: https://sepolia.arbiscan.io/address/${SCORING_ENGINE_ADDRESS}`);
  console.log('════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
