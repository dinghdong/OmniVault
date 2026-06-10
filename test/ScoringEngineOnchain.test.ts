/**
 * ScoringEngineOnchain.test.ts
 *
 * Integration test — calls the deployed Stylus ScoringEngine on Arbitrum Sepolia
 * and verifies the weighted-score logic matches expected values.
 *
 * Run with:
 *   npx hardhat run scripts/test-scoring-engine.ts --network arbitrumSepolia
 * OR (Mocha, needs RPC_URL in env):
 *   HARDHAT_NETWORK=arbitrumSepolia npx hardhat test test/ScoringEngineOnchain.test.ts
 */

import { ethers } from 'hardhat';
import { expect } from 'chai';

// Deployed on Arbitrum Sepolia — update if re-deployed
const SCORING_ENGINE_ADDRESS = '0xeb07843c0423208a087460bcc1ee6ec9de8d6566';

const ABI = [
  'function computeScore(uint8 r, uint8 q, uint8 m) external view returns (uint8 finalScore, bool approved)',
  'function computeScoreWeighted(uint8 r, uint8 q, uint8 m, uint256 wR, uint256 wQ, uint256 wM, uint8 threshold) external view returns (uint8 finalScore, bool approved)',
  'function defaultConfig() external view returns (uint256 wReliability, uint256 wQuality, uint256 wMarketFit, uint8 threshold)',
];

describe('ScoringEngine (Arbitrum Sepolia — live contract)', function () {
  // Live network calls can be slow
  this.timeout(60_000);

  let contract: ReturnType<typeof ethers.getContractAt> extends Promise<infer T> ? T : never;

  before(async function () {
    // Skip if not on Arbitrum Sepolia
    const network = await ethers.provider.getNetwork();
    if (Number(network.chainId) !== 421614) {
      this.skip(); // Only run on Arbitrum Sepolia
    }
    contract = await ethers.getContractAt(ABI, SCORING_ENGINE_ADDRESS);
  });

  it('defaultConfig returns 4000/3000/3000/60', async function () {
    const [wR, wQ, wM, threshold] = await contract.defaultConfig();
    expect(Number(wR)).to.equal(4_000);
    expect(Number(wQ)).to.equal(3_000);
    expect(Number(wM)).to.equal(3_000);
    expect(Number(threshold)).to.equal(60);
  });

  it('all-zero scores return 0, not approved', async function () {
    const [score, approved] = await contract.computeScore(0, 0, 0);
    expect(Number(score)).to.equal(0);
    expect(approved).to.equal(false);
  });

  it('all-100 scores return 100, approved', async function () {
    const [score, approved] = await contract.computeScore(100, 100, 100);
    expect(Number(score)).to.equal(100);
    expect(approved).to.equal(true);
  });

  it('high-quality agent (90,85,80) returns 85, approved', async function () {
    // (90×4000 + 85×3000 + 80×3000)/10000 = 85
    const [score, approved] = await contract.computeScore(90, 85, 80);
    expect(Number(score)).to.equal(85);
    expect(approved).to.equal(true);
  });

  it('borderline agent (50,70,65) returns 60, approved', async function () {
    // (50×4000 + 70×3000 + 65×3000)/10000 = 60 — barely approved
    const [score, approved] = await contract.computeScore(50, 70, 65);
    expect(Number(score)).to.equal(60);
    expect(approved).to.equal(true);
  });

  it('rejected agent (30,50,40) returns 39, rejected', async function () {
    // (30×4000 + 50×3000 + 40×3000)/10000 = 39
    const [score, approved] = await contract.computeScore(30, 50, 40);
    expect(Number(score)).to.equal(39);
    expect(approved).to.equal(false);
  });

  it('computeScoreWeighted with equal 1/3 split returns correct score', async function () {
    // (80×3333 + 60×3333 + 40×3334)/10000 = 59
    const [score, approved] = await contract.computeScoreWeighted(
      80, 60, 40,
      3_333n, 3_333n, 3_334n,
      60,
    );
    expect(Number(score)).to.equal(59);
    expect(approved).to.equal(false);
  });

  it('reliability-dominant weights (60/20/20) for high-reliability agent', async function () {
    // (90×6000 + 50×2000 + 50×2000)/10000 = 74
    const [score, approved] = await contract.computeScoreWeighted(
      90, 50, 50,
      6_000n, 2_000n, 2_000n,
      70,
    );
    expect(Number(score)).to.equal(74);
    expect(approved).to.equal(true);
  });
});
