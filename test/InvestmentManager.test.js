const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

const e18 = 10n ** 18n;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const DELAY = 72 * 3600; // seconds — matches EXECUTION_DELAY constant

async function increaseTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

describe("InvestmentManager", function () {
  let im, mockFV, weth, ft, owner, applicant, oracle, riskAgent, other;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner     = signers[0];
    applicant = signers[1];
    oracle    = signers[2];
    riskAgent = signers[3];
    other     = signers[4];

    const MockWETH = await hre.ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();
    await weth.waitForDeployment();

    const FundTokenF = await hre.ethers.getContractFactory("FundToken");
    ft = await FundTokenF.deploy();
    await ft.waitForDeployment();

    const MockFundVault = await hre.ethers.getContractFactory("MockFundVault");
    mockFV = await MockFundVault.deploy(
      await ft.getAddress(),
      await weth.getAddress()
    );
    await mockFV.waitForDeployment();

    const IM = await hre.ethers.getContractFactory("InvestmentManager");
    im = await IM.deploy(
      await mockFV.getAddress(),
      await weth.getAddress()
    );
    await im.waitForDeployment();

    await im.grantRole(await im.AI_ORACLE_ROLE(),  oracle.address);
    await im.grantRole(await im.RISK_AGENT_ROLE(), riskAgent.address);
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  async function submitProject() {
    await im.connect(applicant).submitProject(
      hre.ethers.id("commit"),
      "0x1234567890123456789012345678901234567890",
      "https://api.example.com",
    );
    return await im.projectCount();
  }

  async function approveProject(pid) {
    await im.connect(oracle).fulfillAudit(pid, 8500, 8000, 9000, ZERO_HASH, []);
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

    it("reverts on zero commitHash", async function () {
      await expect(
        im.connect(applicant).submitProject(
          ZERO_HASH,
          "0x1234567890123456789012345678901234567890",
          "https://api.example.com"
        )
      ).to.be.revertedWithCustomError(im, "ZeroAmount");
    });

    it("reverts on zero contractAddr", async function () {
      await expect(
        im.connect(applicant).submitProject(
          hre.ethers.id("commit"),
          hre.ethers.ZeroAddress,
          "https://api.example.com"
        )
      ).to.be.revertedWithCustomError(im, "ZeroAmount");
    });
  });

  // ── fulfillAudit ────────────────────────────────────────────────────────────
  describe("fulfillAudit", function () {
    it("sets PendingExecution + executionUnlocksAt when score >= 8000", async function () {
      const pid = await submitProject();
      const tx  = await im.connect(oracle).fulfillAudit(pid, 8500, 8000, 9000, ZERO_HASH, []);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const p = await im.projects(pid);
      expect(p.status).to.equal(3); // PendingExecution
      expect(p.auditScore).to.equal(8500);
      expect(p.executionUnlocksAt).to.equal(BigInt(block.timestamp) + BigInt(DELAY));
    });

    it("emits ExecutionQueued event on approval", async function () {
      const pid = await submitProject();
      await expect(
        im.connect(oracle).fulfillAudit(pid, 8500, 8000, 9000, ZERO_HASH, [])
      ).to.emit(im, "ExecutionQueued").withArgs(
        pid,
        anyValue, // unlocksAt — block-dependent
        8500
      );
    });

    it("sets Rejected when score < 8000", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAudit(pid, 7500, 7000, 8000, ZERO_HASH, []);
      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });

    it("reverts if caller lacks AI_ORACLE_ROLE", async function () {
      const pid = await submitProject();
      await expect(
        im.connect(other).fulfillAudit(pid, 8500, 8000, 9000, ZERO_HASH, [])
      ).to.be.revertedWithCustomError(im, "AccessControlUnauthorizedAccount");
    });

    it("reverts if status is not Auditing", async function () {
      await expect(
        im.connect(oracle).fulfillAudit(999, 8500, 8000, 9000, ZERO_HASH, [])
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });
  });

  // ── fulfillAuditFailure ────────────────────────────────────────────────────
  describe("fulfillAuditFailure", function () {
    it("sets status to Rejected", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAuditFailure(pid, 1);
      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });
  });

  // ── veto ───────────────────────────────────────────────────────────────────
  describe("veto", function () {
    it("RISK_AGENT can veto during timelock window", async function () {
      const pid = await submitProject();
      await approveProject(pid);

      await im.connect(riskAgent).veto(pid, 1);

      const p = await im.projects(pid);
      expect(p.status).to.equal(9); // Vetoed
    });

    it("emits ExecutionVetoed event", async function () {
      const pid = await submitProject();
      await approveProject(pid);

      await expect(im.connect(riskAgent).veto(pid, 2))
        .to.emit(im, "ExecutionVetoed")
        .withArgs(pid, riskAgent.address, 2);
    });

    it("reverts if caller lacks RISK_AGENT_ROLE", async function () {
      const pid = await submitProject();
      await approveProject(pid);

      await expect(
        im.connect(other).veto(pid, 1)
      ).to.be.revertedWithCustomError(im, "AccessControlUnauthorizedAccount");
    });

    it("reverts if project is not PendingExecution", async function () {
      const pid = await submitProject();
      // Still in Auditing
      await expect(
        im.connect(riskAgent).veto(pid, 1)
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });

    it("reverts after timelock has expired", async function () {
      const pid = await submitProject();
      await approveProject(pid);

      await increaseTime(DELAY + 1);

      await expect(
        im.connect(riskAgent).veto(pid, 1)
      ).to.be.revertedWithCustomError(im, "TimelockExpired");
    });

    it("vetoed project cannot be executed", async function () {
      const pid = await submitProject();
      await approveProject(pid);
      await im.connect(riskAgent).veto(pid, 1);
      await increaseTime(DELAY + 1);

      await expect(
        im.connect(oracle).executeInvestment(pid, ethers.parseEther("1"), "0x")
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });
  });

  // ── executeInvestment ──────────────────────────────────────────────────────
  // executeInvestment is now permissionless — anyone can call it after timelock.
  describe("executeInvestment", function () {
    it("reverts if timelock has not yet expired", async function () {
      const pid = await submitProject();
      await approveProject(pid);

      await expect(
        im.connect(other).executeInvestment(pid, ethers.parseEther("1"), "0x")
      ).to.be.revertedWithCustomError(im, "TimelockActive");
    });

    it("reverts on zero amount (after timelock)", async function () {
      const pid = await submitProject();
      await approveProject(pid);
      await increaseTime(DELAY + 1);

      await expect(
        im.connect(other).executeInvestment(pid, 0, "0x")
      ).to.be.revertedWithCustomError(im, "ZeroAmount");
    });

    it("reverts if project is Rejected (not PendingExecution)", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAudit(pid, 6000, 5500, 6500, ZERO_HASH, []);
      await increaseTime(DELAY + 1);

      await expect(
        im.connect(other).executeInvestment(pid, ethers.parseEther("1"), "0x")
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });

    it("non-oracle can call executeInvestment after timelock (permissionless)", async function () {
      const pid = await submitProject();
      await approveProject(pid);
      await increaseTime(DELAY + 1);
      // Verify no AccessControl revert — may revert on WETH.withdraw in mock, but not on role check.
      await expect(
        im.connect(other).executeInvestment(pid, ethers.parseEther("1"), "0x")
      ).to.not.be.revertedWithCustomError(im, "AccessControlUnauthorizedAccount");
    });
  });

  // ── triggerCircuitBreak ────────────────────────────────────────────────────
  describe("triggerCircuitBreak", function () {
    it("requires RISK_AGENT_ROLE", async function () {
      const pid = await submitProject();
      await expect(
        im.connect(oracle).triggerCircuitBreak(pid, 1)
      ).to.be.revertedWithCustomError(im, "AccessControlUnauthorizedAccount");
    });
  });

  // ── markExit ───────────────────────────────────────────────────────────────
  describe("markExit", function () {
    it("reverts if status is not Active or CircuitBroken", async function () {
      const pid = await submitProject();
      await expect(
        im.connect(applicant).markExit(pid, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });
  });
});

// chai's anyValue matcher — works with hardhat-chai-matchers
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
