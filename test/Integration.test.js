const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

const e18 = 10n ** 18n;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const DELAY = 72 * 3600;          // seconds — matches EXECUTION_DELAY constant
const COMMUNITY_WINDOW = 48 * 3600; // AgentVoting community veto window

async function increaseTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

describe("Cross-Contract Integration", function () {
  let ft, fv, im, pr, at, weth, aavePool, aWeth;
  let owner, lp, applicant, oracle, riskAgent;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner     = signers[0];
    lp        = signers[1];
    applicant = signers[2];
    oracle    = signers[3];
    riskAgent = signers[4];

    const MockWETH = await hre.ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();
    await weth.waitForDeployment();

    const MockAavePool = await hre.ethers.getContractFactory("MockAavePool");
    aavePool = await MockAavePool.deploy();
    await aavePool.waitForDeployment();

    const MockAToken = await hre.ethers.getContractFactory("MockAToken");
    aWeth = await MockAToken.deploy(await aavePool.getAddress(), await weth.getAddress());
    await aWeth.waitForDeployment();
    await aavePool.setAToken(await weth.getAddress(), await aWeth.getAddress());

    const FundTokenF = await hre.ethers.getContractFactory("FundToken");
    ft = await FundTokenF.deploy();
    await ft.waitForDeployment();

    const FundVaultF = await hre.ethers.getContractFactory("FundVault");
    fv = await FundVaultF.deploy(
      await weth.getAddress(),
      await aavePool.getAddress(),
      await aWeth.getAddress(),
      await ft.getAddress()
    );
    await fv.waitForDeployment();

    const IM = await hre.ethers.getContractFactory("InvestmentManager");
    im = await IM.deploy(await fv.getAddress(), await weth.getAddress());
    await im.waitForDeployment();

    const PR = await hre.ethers.getContractFactory("PromptRegistry");
    pr = await PR.deploy(owner.address);
    await pr.waitForDeployment();

    const AT = await hre.ethers.getContractFactory("AuditTrail");
    at = await AT.deploy();
    await at.waitForDeployment();

    // Roles
    await ft.grantRole(await ft.MINTER_ROLE(), await fv.getAddress());
    await ft.grantRole(await ft.BURNER_ROLE(), await fv.getAddress());
    await fv.grantRole(await fv.INVESTOR_ROLE(), owner.address);
    await fv.grantRole(await fv.INVESTOR_ROLE(), oracle.address);
    await fv.grantRole(await fv.INVESTOR_ROLE(), await im.getAddress());
    await im.grantRole(await im.AI_ORACLE_ROLE(),  oracle.address);
    await im.grantRole(await im.RISK_AGENT_ROLE(), riskAgent.address);
    await at.grantRole(await at.AI_ORACLE_ROLE(), oracle.address);
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  async function submitProject(commitSuffix = "commit") {
    await im.connect(applicant).submitProject(
      hre.ethers.id(commitSuffix),
      "0x1234567890123456789012345678901234567890",
      "https://api.example.com",
    );
    return await im.projectCount();
  }

  // ── LP Deposit Flow ─────────────────────────────────────────────────────────
  describe("Full LP Deposit Flow", function () {
    it("LP deposits ETH and receives FundToken shares", async function () {
      const depositAmount = ethers.parseEther("1");
      const ftBefore = await ft.balanceOf(lp.address);
      await fv.connect(lp).deposit({ value: depositAmount });
      const ftAfter = await ft.balanceOf(lp.address);

      expect(ftAfter).to.be.gt(ftBefore);
      expect(ftAfter).to.equal(depositAmount); // 1:1 at launch
    });

    it("Vault holds aWETH after deposit", async function () {
      const depositAmount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: depositAmount });
      expect(await aWeth.balanceOf(await fv.getAddress())).to.equal(depositAmount);
    });

    it("FundToken balance grows when realized gains apply", async function () {
      const depositAmount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: depositAmount });

      const balanceBefore = await ft.balanceOf(lp.address);
      await fv.connect(owner).addRealizedGains(ethers.parseEther("0.1"), 0);
      const balanceAfter = await ft.balanceOf(lp.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  // ── Project Audit Flow ──────────────────────────────────────────────────────
  describe("Project Application to Investment Flow", function () {
    it("Project submitted → Auditing status", async function () {
      const pid = await submitProject();
      const p = await im.projects(pid);
      expect(p.status).to.equal(2); // Auditing
    });

    it("Oracle fulfills with score >= 8000 → PendingExecution + executionUnlocksAt set", async function () {
      const pid = await submitProject();
      const tx = await im.connect(oracle).fulfillAudit(pid, 8500, 8000, 9000, ZERO_HASH, []);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const p = await im.projects(pid);
      expect(p.status).to.equal(3); // PendingExecution
      expect(p.auditScore).to.equal(8500);
      expect(p.executionUnlocksAt).to.equal(BigInt(block.timestamp) + BigInt(DELAY));
    });

    it("Rejected project cannot be executed even after timelock", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAudit(pid, 7500, 7000, 8000, ZERO_HASH, []);
      await increaseTime(DELAY + 1);

      await expect(
        im.connect(oracle).executeInvestment(pid, ethers.parseEther("0.1"), "0x")
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });

    it("executeInvestment reverts before timelock expires", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAudit(pid, 8500, 8000, 9000, ZERO_HASH, []);

      await expect(
        im.connect(oracle).executeInvestment(pid, ethers.parseEther("0.1"), "0x")
      ).to.be.revertedWithCustomError(im, "TimelockActive");
    });
  });

  // ── Veto Governance ─────────────────────────────────────────────────────────
  describe("Veto Governance", function () {
    it("RISK_AGENT vetoes during window → status = Vetoed", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAudit(pid, 9000, 8500, 9500, ZERO_HASH, []);

      await im.connect(riskAgent).veto(pid, 1); // reason: prompt injection

      const p = await im.projects(pid);
      expect(p.status).to.equal(9); // Vetoed
    });

    it("Vetoed project cannot be executed after timelock", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAudit(pid, 9000, 8500, 9500, ZERO_HASH, []);
      await im.connect(riskAgent).veto(pid, 1);
      await increaseTime(DELAY + 1);

      await expect(
        im.connect(oracle).executeInvestment(pid, ethers.parseEther("1"), "0x")
      ).to.be.revertedWithCustomError(im, "InvalidStatus");
    });

    it("Cannot veto after timelock has expired", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAudit(pid, 9000, 8500, 9500, ZERO_HASH, []);
      await increaseTime(DELAY + 1);

      await expect(
        im.connect(riskAgent).veto(pid, 1)
      ).to.be.revertedWithCustomError(im, "TimelockExpired");
    });

    it("Non-RISK_AGENT cannot veto", async function () {
      const pid = await submitProject();
      await im.connect(oracle).fulfillAudit(pid, 9000, 8500, 9500, ZERO_HASH, []);

      await expect(
        im.connect(applicant).veto(pid, 1)
      ).to.be.revertedWithCustomError(im, "AccessControlUnauthorizedAccount");
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
      // Project 1: PendingExecution (score >= 8000)
      const pid1 = await submitProject("commit1");
      await im.connect(oracle).fulfillAudit(pid1, 8500, 8000, 9000, ZERO_HASH, []);

      // Project 2: Rejected
      const pid2 = await submitProject("commit2");
      await im.connect(oracle).fulfillAudit(pid2, 6000, 5500, 6500, ZERO_HASH, []);

      // Project 3: Auditing
      const pid3 = await submitProject("commit3");

      // Project 4: Vetoed
      const pid4 = await submitProject("commit4");
      await im.connect(oracle).fulfillAudit(pid4, 8200, 7800, 8600, ZERO_HASH, []);
      await im.connect(riskAgent).veto(pid4, 2);

      const p1 = await im.projects(pid1);
      const p2 = await im.projects(pid2);
      const p3 = await im.projects(pid3);
      const p4 = await im.projects(pid4);

      expect(p1.status).to.equal(3); // PendingExecution
      expect(p2.status).to.equal(4); // Rejected
      expect(p3.status).to.equal(2); // Auditing
      expect(p4.status).to.equal(9); // Vetoed
    });
  });

  // ── Risk Management ─────────────────────────────────────────────────────────
  describe("Risk Management", function () {
    it("RiskAgent can trigger circuit break on Auditing project", async function () {
      const pid = await submitProject();
      await im.connect(riskAgent).triggerCircuitBreak(pid, 1);

      const p = await im.projects(pid);
      expect(p.status).to.equal(6); // CircuitBroken
    });
  });

  // ── AgentVoting Integration ──────────────────────────────────────────────────
  describe("AgentVoting Integration", function () {
    let registry, av, agent1, agent2, agent3;

    beforeEach(async function () {
      const signers = await hre.ethers.getSigners();
      agent1 = signers[5];
      agent2 = signers[6];
      agent3 = signers[7];

      const R = await hre.ethers.getContractFactory("AgentRegistry");
      registry = await R.deploy();
      await registry.waitForDeployment();
      await registry.addAgent(agent1.address);
      await registry.addAgent(agent2.address);
      await registry.addAgent(agent3.address);

      const AV = await hre.ethers.getContractFactory("AgentVoting");
      av = await AV.deploy(
        await registry.getAddress(),
        await im.getAddress(),
        await ft.getAddress()
      );
      await av.waitForDeployment();

      // Grant AgentVoting the AI_ORACLE_ROLE
      await im.grantRole(await im.AI_ORACLE_ROLE(), await av.getAddress());
    });

    async function submitProject(suffix = "commit") {
      await im.connect(applicant).submitProject(
        hre.ethers.id(suffix),
        "0x1234567890123456789012345678901234567890",
        "https://api.example.com"
      );
      return await im.projectCount();
    }

    it("unanimous approve + community window passes → PendingExecution", async function () {
      const pid = await submitProject("av-approve");
      const h = hre.ethers.id("reasoning");

      await av.connect(agent1).agentVote(pid, true, 8500, 8000, 9000, h);
      await av.connect(agent2).agentVote(pid, true, 8500, 8000, 9000, h);
      await av.connect(agent3).agentVote(pid, true, 8500, 8000, 9000, h);

      await increaseTime(COMMUNITY_WINDOW + 1);
      await av.triggerExecution(pid);

      const p = await im.projects(pid);
      expect(p.status).to.equal(3); // PendingExecution
    });

    it("any agent rejects → Rejected immediately", async function () {
      const pid = await submitProject("av-reject");
      const h = hre.ethers.id("reasoning");

      await av.connect(agent1).agentVote(pid, true, 8500, 8000, 9000, h);
      await av.connect(agent2).agentVote(pid, false, 4000, 3500, 4500, h);

      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });

    it("LP community veto → Rejected", async function () {
      const pid = await submitProject("av-community");
      const h = hre.ethers.id("reasoning");

      // LP gets >1% FundToken
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });

      await av.connect(agent1).agentVote(pid, true, 9000, 8500, 9500, h);
      await av.connect(agent2).agentVote(pid, true, 9000, 8500, 9500, h);
      await av.connect(agent3).agentVote(pid, true, 9000, 8500, 9500, h);

      await av.connect(lp).communityVeto(pid);

      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });

    it("full pipeline: 3 agents → window → PendingExecution → 72h → executeInvestment", async function () {
      const pid = await submitProject("av-full");
      const h = hre.ethers.id("reasoning");

      // Fund vault
      await fv.connect(lp).deposit({ value: ethers.parseEther("5") });
      await hre.network.provider.request({
        method: "hardhat_setBalance",
        params: [await fv.getAddress(), "0x" + ethers.parseEther("10").toString(16)],
      });

      await av.connect(agent1).agentVote(pid, true, 9000, 8500, 9500, h);
      await av.connect(agent2).agentVote(pid, true, 9000, 8500, 9500, h);
      await av.connect(agent3).agentVote(pid, true, 9000, 8500, 9500, h);

      await increaseTime(COMMUNITY_WINDOW + 1);
      await av.triggerExecution(pid);

      await increaseTime(DELAY + 1);
      // Permissionless — owner (anyone) calls it
      await im.connect(owner).executeInvestment(pid, ethers.parseEther("1"), "0x");

      const p = await im.projects(pid);
      expect(p.status).to.equal(5); // Active
    });
  });

  // ── End-to-End ETH Round Trip ───────────────────────────────────────────────
  describe("End-to-End ETH Round Trip", function () {
    it("LP deposit → vault holds aWETH → LP redeems all → ETH returned", async function () {
      const depositAmount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: depositAmount });

      const vaultAddr = await fv.getAddress();
      await hre.network.provider.request({
        method: "hardhat_setBalance",
        params: [vaultAddr, "0x" + ethers.parseEther("5").toString(16)],
      });

      const shares = await ft.getShares(lp.address);
      const ethBefore = await ethers.provider.getBalance(lp.address);

      const tx = await fv.connect(lp).redeem(shares);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(lp.address);

      const received = ethAfter - ethBefore + gasCost;
      expect(received).to.equal(depositAmount);
      expect(await ft.getShares(lp.address)).to.equal(0n);
    });
  });
});
