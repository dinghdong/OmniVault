const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

// Helper: ABI-encode the 160-byte response (5 × 32-byte words)
//   word0: finalScore (uint256)
//   word1: reliability (uint256)
//   word2: quality (uint256)
//   word3: marketFit (uint256)
//   word4: contentHash (bytes32)
function encode5D(finalScore, reliability, quality, marketFit, contentHash) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint256", "uint256", "bytes32"],
    [finalScore, reliability, quality, marketFit, contentHash]
  );
}

// Helper: legacy 64-byte response (finalScore + contentHash)
function encode2D(finalScore, contentHash) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes32"],
    [finalScore, contentHash]
  );
}

describe("OmniOracle — 3D score storage", function () {
  let oracle, owner;
  const FAKE_ROUTER    = "0x1234567890123456789012345678901234567890";
  const FAKE_REQUEST   = ethers.keccak256(ethers.toUtf8Bytes("req-1"));
  const PROJECT_ID     = 42n;
  const CONTENT_HASH   = ethers.keccak256(ethers.toUtf8Bytes("audit-log-hash"));
  const DON_ID         = ethers.encodeBytes32String("fun-arbitrum-sepolia-1");

  beforeEach(async function () {
    [owner] = await hre.ethers.getSigners();

    const HarnessF = await hre.ethers.getContractFactory("OmniOracleHarness");
    oracle = await HarnessF.deploy(FAKE_ROUTER, 1n, DON_ID);
    await oracle.waitForDeployment();

    // Plant a pending request so _fulfillRequest picks it up
    await oracle.exposed_setRequest(FAKE_REQUEST, PROJECT_ID);
  });

  // ─── Error path ────────────────────────────────────────────────────────────
  describe("error path", function () {
    it("sets fulfilledScore to MAX and emits AuditFailed when err is non-empty", async function () {
      const errBytes = ethers.toUtf8Bytes("DON execution failed");
      await expect(
        oracle.exposed_fulfillRequest(FAKE_REQUEST, "0x", errBytes)
      ).to.emit(oracle, "AuditFailed").withArgs(PROJECT_ID, FAKE_REQUEST, "DON execution failed");

      expect(await oracle.fulfilledScore(PROJECT_ID)).to.equal(ethers.MaxUint256);
    });

    it("sets fulfilledScore to MAX when response is too short (<32 bytes)", async function () {
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, "0xdeadbeef", "0x");
      expect(await oracle.fulfilledScore(PROJECT_ID)).to.equal(ethers.MaxUint256);
    });

    it("silently returns for unknown requestId", async function () {
      const unknownReq = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
      // Should not revert
      await oracle.exposed_fulfillRequest(unknownReq, "0x", "0x");
    });
  });

  // ─── 5-word (160-byte) response ────────────────────────────────────────────
  describe("5-word 160-byte response (new format)", function () {
    it("stores finalScore+1 in fulfilledScore", async function () {
      const response = encode5D(85n, 90n, 80n, 85n, CONTENT_HASH);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");
      expect(await oracle.fulfilledScore(PROJECT_ID)).to.equal(86n); // 85+1
    });

    it("stores 3D breakdown correctly via fulfilledScores()", async function () {
      const response = encode5D(85n, 90n, 80n, 85n, CONTENT_HASH);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");

      const [r, q, m] = await oracle.fulfilledScores(PROJECT_ID);
      expect(r).to.equal(90);
      expect(q).to.equal(80);
      expect(m).to.equal(85);
    });

    it("stores contentHash from word 4", async function () {
      const response = encode5D(85n, 90n, 80n, 85n, CONTENT_HASH);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");
      expect(await oracle.fulfilledHash(PROJECT_ID)).to.equal(CONTENT_HASH);
    });

    it("emits AuditFulfilled with all 3D fields", async function () {
      const response = encode5D(85n, 90n, 80n, 85n, CONTENT_HASH);
      await expect(oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x"))
        .to.emit(oracle, "AuditFulfilled")
        .withArgs(PROJECT_ID, FAKE_REQUEST, 85n, 90, 80, 85, CONTENT_HASH);
    });

    it("caps scores above 100 to 100", async function () {
      const response = encode5D(200n, 150n, 120n, 999n, CONTENT_HASH);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");

      // finalScore capped to 100 → stored as 101
      expect(await oracle.fulfilledScore(PROJECT_ID)).to.equal(101n);

      const [r, q, m] = await oracle.fulfilledScores(PROJECT_ID);
      expect(r).to.equal(100);
      expect(q).to.equal(100);
      expect(m).to.equal(100);
    });

    it("stores 0 scores correctly (rejected project)", async function () {
      const response = encode5D(0n, 0n, 0n, 0n, CONTENT_HASH);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");

      expect(await oracle.fulfilledScore(PROJECT_ID)).to.equal(1n); // 0+1 sentinel

      const [r, q, m] = await oracle.fulfilledScores(PROJECT_ID);
      expect(r).to.equal(0);
      expect(q).to.equal(0);
      expect(m).to.equal(0);
    });

    it("clears s_pendingRequest after fulfillment", async function () {
      const response = encode5D(85n, 90n, 80n, 85n, CONTENT_HASH);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");
      expect(await oracle.s_pendingRequest(PROJECT_ID)).to.equal(ethers.ZeroHash);
    });
  });

  // ─── Legacy 2-word (64-byte) backward-compatible response ──────────────────
  describe("legacy 2-word 64-byte response (backward compat)", function () {
    it("stores finalScore+1 and contentHash", async function () {
      const response = encode2D(70n, CONTENT_HASH);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");

      expect(await oracle.fulfilledScore(PROJECT_ID)).to.equal(71n);
      expect(await oracle.fulfilledHash(PROJECT_ID)).to.equal(CONTENT_HASH);
    });

    it("leaves 3D scores as zero when using legacy format", async function () {
      const response = encode2D(70n, CONTENT_HASH);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");

      const [r, q, m] = await oracle.fulfilledScores(PROJECT_ID);
      expect(r).to.equal(0);
      expect(q).to.equal(0);
      expect(m).to.equal(0);
    });

    it("emits AuditFulfilled with zero 3D fields for legacy response", async function () {
      const response = encode2D(70n, CONTENT_HASH);
      await expect(oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x"))
        .to.emit(oracle, "AuditFulfilled")
        .withArgs(PROJECT_ID, FAKE_REQUEST, 70n, 0, 0, 0, CONTENT_HASH);
    });
  });

  // ─── Score-only 32-byte response ───────────────────────────────────────────
  describe("32-byte score-only response", function () {
    it("stores finalScore+1, zero 3D scores, zero contentHash", async function () {
      // Encode just a uint256 (32 bytes)
      const response = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [55n]);
      await oracle.exposed_fulfillRequest(FAKE_REQUEST, response, "0x");

      expect(await oracle.fulfilledScore(PROJECT_ID)).to.equal(56n);
      expect(await oracle.fulfilledHash(PROJECT_ID)).to.equal(ethers.ZeroHash);
      const [r, q, m] = await oracle.fulfilledScores(PROJECT_ID);
      expect(r).to.equal(0);
      expect(q).to.equal(0);
      expect(m).to.equal(0);
    });
  });

  // ─── fulfilledScores view for unfulfilled project ──────────────────────────
  describe("fulfilledScores for unfulfilled project", function () {
    it("returns (0,0,0) for a project that has never been fulfilled", async function () {
      const [r, q, m] = await oracle.fulfilledScores(999n);
      expect(r).to.equal(0);
      expect(q).to.equal(0);
      expect(m).to.equal(0);
    });
  });
});
