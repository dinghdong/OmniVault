const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const COMMIT_HASH = "0x1234567812345678123456781234567812345678123456781234567812345678";
const CONTRACT_ADDR = "0x1234567890123456789012345678901234567890";
const THRESHOLD = 60n;
const EXECUTION_DELAY_SEC = 3 * 60; // 3 minutes (same as contract constant)

async function increaseTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

describe("InvestmentManager (AI Agent reform)", function () {
  let im, mockFV, mockOracle, ft, owner, applicant, riskAgent, lp, other;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner     = signers[0];
    applicant = signers[1];
    riskAgent = signers[2];
    lp        = signers[3];
    other     = signers[4];

    // FundToken
    const FundTokenF = await hre.ethers.getContractFactory("FundToken");
    ft = await FundTokenF.deploy();
    await ft.waitForDeployment();

    // MockFundVault
    const MockFVF = await hre.ethers.getContractFactory("MockFundVault");
    mockFV = await MockFVF.deploy(await ft.getAddress());
    await mockFV.waitForDeployment();

    // MockOmniOracleV2
    const MockOracleF = await hre.ethers.getContractFactory("MockOmniOracleV2");
    mockOracle = await MockOracleF.deploy();
    await mockOracle.waitForDeployment();

    // InvestmentManager
    const IMF = await hre.ethers.getContractFactory("InvestmentManager");
    im = await IMF.deploy(await mockFV.getAddress(), THRESHOLD);
    await im.waitForDeployment();

    // Set oracle
    await im.setOracle(await mockOracle.getAddress());

    // Roles
    await im.grantRole(await im.RISK_AGENT_ROLE(), riskAgent.address);
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  async function submitProject(signer = applicant) {
    const tx = await im.connect(signer).submitProject(
      COMMIT_HASH,
      CONTRACT_ADDR,
      "https://api.example.com",
      ethers.parseEther("0.5"),
      "did:example:agent1",
      "https://github.com/example/agent",
      "https://agent.example.com/api"
    );
    await tx.wait();
    return await im.projectCount();
  }

  async function fulfillApproval(pid, finalScore = 75n, rel = 80, qual = 75, mkt = 70) {
    // finalScore+1 sentinel
    await mockOracle.setResult(pid, BigInt(finalScore) + 1n, rel, qual, mkt, ZERO_HASH);
    await im.settleAudit(pid);
  }

  async function fulfillRejection(pid, finalScore = 30n) {
    await mockOracle.setResult(pid, BigInt(finalScore) + 1n, 30, 30, 30, ZERO_HASH);
    await im.settleAudit(pid);
  }

  // ── submitProject ───────────────────────────────────────────────────────────
  describe("submitProject", function () {
    it("increments projectCount", async function () {
      const before = await im.projectCount();
      await submitProject();
      expect(await im.projectCount()).to.equal(before + 1n);
    });

    it("sets status to Auditing", async function () {
      const pid = await submitProject();
      const p = await im.projects(pid);
      expect(p.status).to.equal(2); // Auditing
    });

    it("stores agentDid and agentRepo", async function () {
      const pid = await submitProject();
      const p = await im.projects(pid);
      expect(p.agentDid).to.equal("did:example:agent1");
      expect(p.agentRepo).to.equal("https://github.com/example/agent");
      expect(p.agentApiEndpoint).to.equal("https://agent.example.com/api");
    });

    it("reverts on zero commitHash", async function () {
      await expect(
        im.connect(applicant).submitProject(
          ZERO_HASH, CONTRACT_ADDR, "biz", 0n, "did", "repo", "api"
        )
      ).to.be.revertedWithCustomError(im, "ZeroAmount");
    });

    it("reverts on zero contractAddr", async function () {
      await expect(
        im.connect(applicant).submitProject(
          COMMIT_HASH, ethers.ZeroAddress, "biz", 0n, "did", "repo", "api"
        )
      ).to.be.revertedWithCustomError(im, "ZeroAmount");
    });

    it("emits ProjectSubmitted with agentDid", async function () {
      await expect(
        im.connect(applicant).submitProject(
          COMMIT_HASH, CONTRACT_ADDR, "biz", ethers.parseEther("0.1"),
          "did:example:agent99", "repo", "api"
        )
      ).to.emit(im, "ProjectSubmitted")
        .withArgs(1n, applicant.address, COMMIT_HASH, CONTRACT_ADDR,
                  ethers.parseEther("0.1"), "did:example:agent99");
    });
  });

  // ── settleAudit ─────────────────────────────────────────────────────────────
  describe("settleAudit", function () {
    it("approves project above threshold → PendingExecution", async function () {
      const pid = await submitProject();
      await fulfillApproval(pid, 75n);
      const p = await im.projects(pid);
      expect(p.status).to.equal(3); // PendingExecution
      expect(p.auditScore).to.equal(75);
    });

    it("stores 3D scores", async function () {
      const pid = await submitProject();
      await fulfillApproval(pid, 75n, 80, 75, 70);
      const p = await im.projects(pid);
      expect(p.reliabilityScore).to.equal(80);
      expect(p.qualityScore).to.equal(75);
      expect(p.marketFitScore).to.equal(70);
    });

    it("rejects project below threshold", async function () {
      const pid = await submitProject();
      await fulfillRejection(pid, 30n);
      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });

    it("marks failed audit as Rejected", async function () {
      const pid = await submitProject();
      await mockOracle.setResult(pid, ethers.MaxUint256, 0, 0, 0, ZERO_HASH);
      await im.settleAudit(pid);
      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });

    it("reverts if not yet fulfilled", async function () {
      const pid = await submitProject();
      // No oracle result set → fulfilledScore = 0
      await expect(im.settleAudit(pid)).to.be.revertedWith("Audit not yet fulfilled");
    });

    it("reverts if not in Auditing status", async function () {
      const pid = await submitProject();
      await fulfillApproval(pid, 75n);
      await expect(im.settleAudit(pid))
        .to.be.revertedWithCustomError(im, "InvalidStatus");
    });
  });

  // ── veto ────────────────────────────────────────────────────────────────────
  describe("veto", function () {
    it("LP can veto during timelock", async function () {
      await mockFV.setFakeBalance(ethers.parseEther("1")); // make lp appear as LP
      const pid = await submitProject();
      await fulfillApproval(pid, 75n);
      await im.connect(lp).veto(pid);
      const p = await im.projects(pid);
      expect(p.status).to.equal(9); // Vetoed
    });

    it("non-LP cannot veto", async function () {
      const pid = await submitProject();
      await fulfillApproval(pid, 75n);
      await expect(im.connect(other).veto(pid))
        .to.be.revertedWithCustomError(im, "NotLP");
    });

    it("cannot veto after timelock expires", async function () {
      await mockFV.setFakeBalance(ethers.parseEther("1"));
      const pid = await submitProject();
      await fulfillApproval(pid, 75n);
      await increaseTime(EXECUTION_DELAY_SEC + 1);
      await expect(im.connect(lp).veto(pid))
        .to.be.revertedWithCustomError(im, "TimelockExpired");
    });
  });

  // ── executeInvestment ───────────────────────────────────────────────────────
  describe("executeInvestment", function () {
    it("executes after timelock, sends upfront ETH to applicant", async function () {
      const investAmount = ethers.parseEther("0.5"); // == requestedAmount

      // Fund MockFundVault with ETH so divestForInvestment can send it
      await owner.sendTransaction({ to: await mockFV.getAddress(), value: investAmount });

      const pid = await submitProject();
      await fulfillApproval(pid, 80n);
      await increaseTime(EXECUTION_DELAY_SEC + 1);

      const before = await ethers.provider.getBalance(applicant.address);
      const tx = await im.executeInvestment(pid, investAmount, "0x");
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(applicant.address);

      const upfront = investAmount * 2000n / 10000n; // 20%
      expect(after - before).to.equal(upfront);

      const p = await im.projects(pid);
      expect(p.status).to.equal(5); // Active
      expect(p.investmentAmount).to.equal(investAmount);
    });

    it("reverts before timelock", async function () {
      const pid = await submitProject();
      await fulfillApproval(pid, 75n);
      await expect(im.executeInvestment(pid, ethers.parseEther("0.1"), "0x"))
        .to.be.revertedWithCustomError(im, "TimelockActive");
    });

    it("reverts if not PendingExecution", async function () {
      const pid = await submitProject();
      await increaseTime(EXECUTION_DELAY_SEC + 1);
      await expect(im.executeInvestment(pid, ethers.parseEther("0.1"), "0x"))
        .to.be.revertedWithCustomError(im, "InvalidStatus");
    });

    it("reverts when amount exceeds requestedAmount", async function () {
      await owner.sendTransaction({ to: await mockFV.getAddress(), value: ethers.parseEther("1") });
      const pid = await submitProject(); // requests 0.5 ETH
      await fulfillApproval(pid, 80n);
      await increaseTime(EXECUTION_DELAY_SEC + 1);
      await expect(im.executeInvestment(pid, ethers.parseEther("1"), "0x"))
        .to.be.revertedWithCustomError(im, "AmountExceedsRequested");
    });
  });

  // ── getAuditScores ──────────────────────────────────────────────────────────
  describe("getAuditScores", function () {
    it("returns all 4 score fields", async function () {
      const pid = await submitProject();
      await fulfillApproval(pid, 76n, 85, 72, 68);
      const [final, rel, qual, mkt] = await im.getAuditScores(pid);
      expect(final).to.equal(76);
      expect(rel).to.equal(85);
      expect(qual).to.equal(72);
      expect(mkt).to.equal(68);
    });
  });

  // ── circuit break ───────────────────────────────────────────────────────────
  describe("triggerCircuitBreak", function () {
    async function activeProject() {
      const investAmount = ethers.parseEther("0.5");
      await owner.sendTransaction({ to: await mockFV.getAddress(), value: investAmount });
      const pid = await submitProject();
      await fulfillApproval(pid, 75n);
      await increaseTime(EXECUTION_DELAY_SEC + 1);
      await im.executeInvestment(pid, investAmount, "0x");
      return pid;
    }

    it("only RISK_AGENT_ROLE can trigger", async function () {
      const pid = await activeProject();
      await expect(im.connect(other).triggerCircuitBreak(pid))
        .to.be.revertedWithCustomError(im, "AccessControlUnauthorizedAccount");
    });

    it("freezes vesting claims after circuit break", async function () {
      const pid = await activeProject();
      // Let some vesting accrue, confirm it is claimable while Active
      await increaseTime(7 * 24 * 3600);
      expect(await im.getClaimableAmount(pid)).to.be.gt(0n);

      await im.connect(riskAgent).triggerCircuitBreak(pid);

      expect(await im.getClaimableAmount(pid)).to.equal(0n);
      await expect(im.claimPayout(pid))
        .to.be.revertedWithCustomError(im, "InvalidStatus");
    });
  });

  // ── DeadManSwitch integration ───────────────────────────────────────────────
  describe("DeadManSwitch write-off wiring", function () {
    it("triggerDeadSwitch marks the project WriteOff in InvestmentManager", async function () {
      const investAmount = ethers.parseEther("0.5");
      await owner.sendTransaction({ to: await mockFV.getAddress(), value: investAmount });
      const pid = await submitProject();
      await fulfillApproval(pid, 75n);
      await increaseTime(EXECUTION_DELAY_SEC + 1);
      await im.executeInvestment(pid, investAmount, "0x");

      const DMSF = await hre.ethers.getContractFactory("DeadManSwitch");
      const dms = await DMSF.deploy();
      await dms.waitForDeployment();

      await dms.setInvestmentManager(await im.getAddress());
      await im.grantRole(await im.RISK_AGENT_ROLE(), await dms.getAddress());
      await dms.registerProject(pid);

      // Silent past PING_WINDOW (30d) + GRACE_PERIOD (30d)
      await increaseTime(61 * 24 * 3600);
      await dms.connect(other).triggerDeadSwitch(pid);

      const p = await im.projects(pid);
      expect(p.status).to.equal(8); // WriteOff
      expect((await dms.watches(pid)).active).to.equal(false);
    });
  });

  // ── setScoreThreshold ───────────────────────────────────────────────────────
  describe("setScoreThreshold", function () {
    it("updates threshold", async function () {
      await im.setScoreThreshold(70n);
      expect(await im.scoreThreshold()).to.equal(70n);
    });

    it("reverts for threshold > 100", async function () {
      await expect(im.setScoreThreshold(101n))
        .to.be.revertedWithCustomError(im, "InvalidThreshold");
    });
  });
});
