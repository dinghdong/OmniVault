const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CONTRACT_ADDR = "0x1234567890123456789012345678901234567890";
const THRESHOLD = 60n;
const EXECUTION_DELAY_SEC = 3 * 60; // matches InvestmentManager.EXECUTION_DELAY
const WEEK = 7 * 24 * 3600;

async function increaseTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

describe("Cross-Contract Integration", function () {
  let ft, fv, im, pr, at, mockOracle;
  let owner, lp, applicant, oracle, riskAgent, other;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner     = signers[0];
    lp        = signers[1];
    applicant = signers[2];
    oracle    = signers[3];
    riskAgent = signers[4];
    other     = signers[5];

    const FundTokenF = await hre.ethers.getContractFactory("FundToken");
    ft = await FundTokenF.deploy();
    await ft.waitForDeployment();

    const FundVaultF = await hre.ethers.getContractFactory("FundVault");
    fv = await FundVaultF.deploy(await ft.getAddress());
    await fv.waitForDeployment();

    const MockOracleF = await hre.ethers.getContractFactory("MockOmniOracleV2");
    mockOracle = await MockOracleF.deploy();
    await mockOracle.waitForDeployment();

    const IMF = await hre.ethers.getContractFactory("InvestmentManager");
    im = await IMF.deploy(await fv.getAddress(), THRESHOLD);
    await im.waitForDeployment();
    await im.setOracle(await mockOracle.getAddress());

    const PR = await hre.ethers.getContractFactory("PromptRegistry");
    pr = await PR.deploy(owner.address);
    await pr.waitForDeployment();

    const AT = await hre.ethers.getContractFactory("AuditTrail");
    at = await AT.deploy();
    await at.waitForDeployment();

    // Roles
    await ft.grantRole(await ft.MINTER_ROLE(), await fv.getAddress());
    await ft.grantRole(await ft.BURNER_ROLE(), await fv.getAddress());
    await fv.grantRole(await fv.INVESTOR_ROLE(), await im.getAddress());
    await fv.grantRole(await fv.INVESTOR_ROLE(), owner.address); // P&L simulation
    await im.grantRole(await im.RISK_AGENT_ROLE(), riskAgent.address);
    await at.grantRole(await at.AI_ORACLE_ROLE(), oracle.address);
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  async function submitProject(suffix = "commit", requested = ethers.parseEther("0.5")) {
    await im.connect(applicant).submitProject(
      hre.ethers.id(suffix),
      CONTRACT_ADDR,
      "https://api.example.com",
      requested,
      "did:example:agent1",
      "https://github.com/example/agent",
      "https://agent.example.com/api"
    );
    return await im.projectCount();
  }

  async function approveProject(pid, score = 75n) {
    await mockOracle.setResult(pid, score + 1n, 80, 75, 70, ZERO_HASH);
    return im.settleAudit(pid);
  }

  async function rejectProject(pid, score = 30n) {
    await mockOracle.setResult(pid, score + 1n, 30, 30, 30, ZERO_HASH);
    return im.settleAudit(pid);
  }

  // ── LP Deposit & Yield Flow ─────────────────────────────────────────────────
  describe("Full LP Deposit Flow", function () {
    it("LP deposits ETH and receives FundToken shares 1:1 at launch", async function () {
      const depositAmount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: depositAmount });
      expect(await ft.balanceOf(lp.address)).to.equal(depositAmount);
      expect(await ft.getShares(lp.address)).to.equal(depositAmount);
    });

    it("Vault holds raw ETH after deposit (no AAVE wrapping)", async function () {
      const depositAmount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: depositAmount });
      expect(await fv.vaultBalance()).to.equal(depositAmount);
    });

    it("FundToken balance grows when realized gains apply", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });

      const gain = ethers.parseEther("0.1");
      await fv.connect(owner).addRealizedGains(gain, 0, { value: gain });

      // factor 1.0 → 1.1, balance 1 ETH → 1.1 ETH
      expect(await ft.balanceOf(lp.address)).to.equal(ethers.parseEther("1.1"));
    });

    it("FundToken balance shrinks when realized losses apply", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });

      await fv.connect(owner).addRealizedLoss(0, ethers.parseEther("0.2"));

      // factor 1.0 → 0.8
      expect(await ft.balanceOf(lp.address)).to.equal(ethers.parseEther("0.8"));
    });
  });

  // ── Project Audit Flow ──────────────────────────────────────────────────────
  describe("Project Application to Investment Flow", function () {
    it("Project submitted → Auditing status + oracle receives request", async function () {
      const pid = await submitProject();
      const p = await im.projects(pid);
      expect(p.status).to.equal(2); // Auditing
      expect(await mockOracle.lastRequestedProjectId()).to.equal(pid);
    });

    it("Oracle approves above threshold → PendingExecution + executionUnlocksAt set", async function () {
      const pid = await submitProject();
      const tx = await approveProject(pid, 85n);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const p = await im.projects(pid);
      expect(p.status).to.equal(3); // PendingExecution
      expect(p.auditScore).to.equal(85);
      expect(p.executionUnlocksAt).to.equal(BigInt(block.timestamp) + BigInt(EXECUTION_DELAY_SEC));
    });

    it("Score below threshold → Rejected", async function () {
      const pid = await submitProject();
      await rejectProject(pid, 30n);
      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });

    it("Oracle failure sentinel → Rejected with AuditFailed event", async function () {
      const pid = await submitProject();
      await mockOracle.setResult(pid, ethers.MaxUint256, 0, 0, 0, ZERO_HASH);
      await expect(im.settleAudit(pid)).to.emit(im, "AuditFailed").withArgs(pid);
      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });

    it("executeInvestment reverts before timelock expires", async function () {
      const pid = await submitProject();
      await approveProject(pid);
      await expect(
        im.executeInvestment(pid, ethers.parseEther("0.1"), "0x")
      ).to.be.revertedWithCustomError(im, "TimelockActive");
    });

    it("Rejected project cannot be executed even after timelock", async function () {
      const pid = await submitProject();
      await rejectProject(pid);
      await increaseTime(EXECUTION_DELAY_SEC + 1);
      await expect(
        im.executeInvestment(pid, ethers.parseEther("0.1"), "0x")
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });
  });

  // ── LP Veto Governance ──────────────────────────────────────────────────────
  describe("LP Veto Governance", function () {
    it("LP holding FundToken can veto during timelock → status = Vetoed", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });
      const pid = await submitProject();
      await approveProject(pid, 90n);

      await im.connect(lp).veto(pid);

      const p = await im.projects(pid);
      expect(p.status).to.equal(9); // Vetoed
    });

    it("Vetoed project cannot be executed after timelock", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });
      const pid = await submitProject();
      await approveProject(pid, 90n);
      await im.connect(lp).veto(pid);
      await increaseTime(EXECUTION_DELAY_SEC + 1);

      await expect(
        im.executeInvestment(pid, ethers.parseEther("0.5"), "0x")
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });

    it("Non-LP cannot veto", async function () {
      const pid = await submitProject();
      await approveProject(pid, 90n);
      await expect(im.connect(other).veto(pid))
        .to.be.revertedWithCustomError(im, "NotLP");
    });

    it("Cannot veto after timelock has expired", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });
      const pid = await submitProject();
      await approveProject(pid, 90n);
      await increaseTime(EXECUTION_DELAY_SEC + 1);

      await expect(im.connect(lp).veto(pid))
        .to.be.revertedWithCustomError(im, "TimelockExpired");
    });
  });

  // ── Full Investment Pipeline (E2E) ──────────────────────────────────────────
  describe("Full Investment Pipeline", function () {
    it("deposit → submit → approve → timelock → execute → vest → exit with profit", async function () {
      // 1. LP funds the vault
      await fv.connect(lp).deposit({ value: ethers.parseEther("2") });

      // 2. AI agent submits a project requesting 0.5 ETH
      const invest = ethers.parseEther("0.5");
      const pid = await submitProject("e2e", invest);
      await approveProject(pid, 80n);

      // 3. Timelock passes; anyone executes
      await increaseTime(EXECUTION_DELAY_SEC + 1);
      const applicantBefore = await ethers.provider.getBalance(applicant.address);
      await im.connect(other).executeInvestment(pid, invest, "0x");
      const applicantAfter = await ethers.provider.getBalance(applicant.address);

      // 20% upfront to applicant, vault drained by invest amount
      const upfront = invest * 2000n / 10000n;
      expect(applicantAfter - applicantBefore).to.equal(upfront);
      expect(await fv.vaultBalance()).to.equal(ethers.parseEther("1.5"));
      expect(await ethers.provider.getBalance(await im.getAddress())).to.equal(invest - upfront);
      expect((await im.projects(pid)).status).to.equal(5); // Active

      // 4. Half the vesting period passes → applicant claims linear vesting
      await increaseTime(26 * WEEK);
      const claimable = await im.getClaimableAmount(pid);
      // ~50% of linear part (0.4 × 0.5 = 0.2), small drift from elapsed blocks
      expect(claimable).to.be.closeTo(ethers.parseEther("0.2"), ethers.parseEther("0.001"));

      const beforeClaim = await ethers.provider.getBalance(applicant.address);
      await im.connect(other).claimPayout(pid); // permissionless, pays applicant
      const afterClaim = await ethers.provider.getBalance(applicant.address);
      expect(afterClaim - beforeClaim).to.be.closeTo(claimable, ethers.parseEther("0.001"));

      // 5. Admin records a profitable exit (+20%) → LP balances rebase upward
      const lpBefore = await ft.balanceOf(lp.address);
      await im.simulateExit(pid, 12000);
      const lpAfter = await ft.balanceOf(lp.address);

      expect((await im.projects(pid)).status).to.equal(7); // Exited
      expect(lpAfter).to.be.gt(lpBefore);
      // net gain 0.1 ETH over 2 ETH of shares → factor 1.05 → balance 2.1
      expect(lpAfter).to.equal(ethers.parseEther("2.1"));
    });

    it("amount above audited requestedAmount is rejected", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("2") });
      const pid = await submitProject("cap", ethers.parseEther("0.5"));
      await approveProject(pid);
      await increaseTime(EXECUTION_DELAY_SEC + 1);

      await expect(
        im.executeInvestment(pid, ethers.parseEther("1"), "0x")
      ).to.be.revertedWithCustomError(im, "AmountExceedsRequested");
    });
  });

  // ── Risk Management ─────────────────────────────────────────────────────────
  describe("Risk Management", function () {
    it("RiskAgent can trigger circuit break on Auditing project", async function () {
      const pid = await submitProject();
      await im.connect(riskAgent).triggerCircuitBreak(pid);
      expect((await im.projects(pid)).status).to.equal(6); // CircuitBroken
    });

    it("Circuit break on Active project freezes vesting claims", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });
      const pid = await submitProject();
      await approveProject(pid);
      await increaseTime(EXECUTION_DELAY_SEC + 1);
      await im.executeInvestment(pid, ethers.parseEther("0.5"), "0x");

      await increaseTime(4 * WEEK);
      expect(await im.getClaimableAmount(pid)).to.be.gt(0n);

      await im.connect(riskAgent).triggerCircuitBreak(pid);

      expect(await im.getClaimableAmount(pid)).to.equal(0n);
      await expect(im.claimPayout(pid))
        .to.be.revertedWithCustomError(im, "InvalidStatus");
    });
  });

  // ── AuditTrail Integration ──────────────────────────────────────────────────
  describe("AuditTrail Integration", function () {
    it("AI_ORACLE can record audit decisions", async function () {
      await at.connect(oracle).recordAudit(
        1,
        hre.ethers.id("input"),
        hre.ethers.id("output"),
        hre.ethers.id("nodes"),
        5
      );
      expect(await at.auditCount(1)).to.equal(1);
    });

    it("Audit records can be verified by hash", async function () {
      await at.connect(oracle).recordAudit(
        2,
        hre.ethers.id("prompt-input"),
        hre.ethers.id("prompt-output"),
        hre.ethers.id("node-hashes"),
        10
      );
      const result = await at.verifyAuditRecord(
        2, 0,
        hre.ethers.id("prompt-input"),
        hre.ethers.id("prompt-output")
      );
      expect(result).to.equal(true);
    });
  });

  // ── PromptRegistry Integration ──────────────────────────────────────────────
  describe("PromptRegistry Integration", function () {
    it("Owner can register and activate prompts", async function () {
      const promptId = hre.ethers.id("audit-prompt");
      await pr.connect(owner).registerPrompt(promptId, hre.ethers.id("QmHash"), "audit-v1");
      await pr.connect(owner).activatePrompt(promptId);

      const stored = await pr.prompts(promptId);
      expect(stored.isActive).to.equal(true);
      expect(stored.commitment).to.equal(hre.ethers.id("QmHash"));
    });
  });

  // ── Multi-Project Scenarios ─────────────────────────────────────────────────
  describe("Multi-Project Scenarios", function () {
    it("Multiple projects can be in different states simultaneously", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });

      // Project 1: PendingExecution
      const pid1 = await submitProject("commit1");
      await approveProject(pid1, 85n);

      // Project 2: Rejected
      const pid2 = await submitProject("commit2");
      await rejectProject(pid2, 40n);

      // Project 3: Auditing
      const pid3 = await submitProject("commit3");

      // Project 4: Vetoed
      const pid4 = await submitProject("commit4");
      await approveProject(pid4, 82n);
      await im.connect(lp).veto(pid4);

      expect((await im.projects(pid1)).status).to.equal(3); // PendingExecution
      expect((await im.projects(pid2)).status).to.equal(4); // Rejected
      expect((await im.projects(pid3)).status).to.equal(2); // Auditing
      expect((await im.projects(pid4)).status).to.equal(9); // Vetoed
    });
  });

  // ── End-to-End ETH Round Trip ───────────────────────────────────────────────
  describe("End-to-End ETH Round Trip", function () {
    it("LP deposit → vault holds ETH → LP redeems all → exact ETH returned", async function () {
      const depositAmount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: depositAmount });

      const shares = await ft.getShares(lp.address);
      const ethBefore = await ethers.provider.getBalance(lp.address);

      const tx = await fv.connect(lp).redeem(shares);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(lp.address);

      expect(ethAfter - ethBefore + gasCost).to.equal(depositAmount);
      expect(await ft.getShares(lp.address)).to.equal(0n);
    });

    it("LP redeems deposit plus realized yield", async function () {
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });

      const gain = ethers.parseEther("0.1");
      await fv.connect(owner).addRealizedGains(gain, 0, { value: gain });

      const shares = await ft.getShares(lp.address);
      const ethBefore = await ethers.provider.getBalance(lp.address);

      const tx = await fv.connect(lp).redeem(shares);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(lp.address);

      expect(ethAfter - ethBefore + gasCost).to.equal(ethers.parseEther("1.1"));
    });
  });
});
