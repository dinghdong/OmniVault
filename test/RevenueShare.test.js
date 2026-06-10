const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

describe("RevenueShare", function () {
  let rs, owner, agent1, agent2, agent3, other;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner  = signers[0];
    agent1 = signers[1];
    agent2 = signers[2];
    agent3 = signers[3];
    other  = signers[4];

    const RSF = await hre.ethers.getContractFactory("RevenueShare");
    rs = await RSF.deploy();
    await rs.waitForDeployment();
  });

  async function registerAgents() {
    // Register 4 agents with 30/30/25/15 weights
    await rs.registerAgent("did:code-analysis", "CodeAnalysisAgent", 3000n, agent1.address);
    await rs.registerAgent("did:risk-assess", "RiskAssessmentAgent", 3000n, agent2.address);
    await rs.registerAgent("did:biz-analysis", "BusinessAnalysisAgent", 2500n, agent3.address);
    await rs.registerAgent("did:arbiter", "ArbiterAgent", 1500n, other.address);
  }

  // ─── registerAgent ─────────────────────────────────────────────────────────
  describe("registerAgent", function () {
    it("registers an agent and updates totalWeight", async function () {
      await rs.registerAgent("did:agent1", "Agent1", 3000n, agent1.address);
      expect(await rs.totalWeight()).to.equal(3000n);
      expect(await rs.agentCount()).to.equal(1n);
    });

    it("reverts on zero weight", async function () {
      await expect(rs.registerAgent("did:agent1", "Agent1", 0n, agent1.address))
        .to.be.revertedWithCustomError(rs, "InvalidWeight");
    });

    it("reverts on zero address", async function () {
      await expect(rs.registerAgent("did:agent1", "Agent1", 3000n, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(rs, "ZeroAddress");
    });

    it("reverts when total weight would exceed 10 000", async function () {
      await rs.registerAgent("did:a1", "A1", 6000n, agent1.address);
      await rs.registerAgent("did:a2", "A2", 3000n, agent2.address);
      await expect(rs.registerAgent("did:a3", "A3", 1001n, agent3.address))
        .to.be.revertedWithCustomError(rs, "WeightExceedsMax");
    });

    it("only DEFAULT_ADMIN can register", async function () {
      await expect(rs.connect(other).registerAgent("did:x", "X", 1000n, other.address))
        .to.be.revertedWithCustomError(rs, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── depositRevenue ─────────────────────────────────────────────────────────
  describe("depositRevenue", function () {
    it("reverts when no agents registered", async function () {
      await expect(
        rs.depositRevenue({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(rs, "InvalidWeight");
    });

    it("reverts on zero value", async function () {
      await rs.registerAgent("did:a", "A", 1000n, agent1.address);
      await expect(rs.depositRevenue({ value: 0 }))
        .to.be.revertedWithCustomError(rs, "ZeroAmount");
    });

    it("increases totalDeposited", async function () {
      await registerAgents();
      const amount = ethers.parseEther("1");
      await rs.depositRevenue({ value: amount });
      expect(await rs.totalDeposited()).to.equal(amount);
    });

    it("emits RevenueDeposited", async function () {
      await registerAgents();
      const amount = ethers.parseEther("0.5");
      await expect(rs.depositRevenue({ value: amount }))
        .to.emit(rs, "RevenueDeposited");
    });
  });

  // ─── pendingRevenue + claim ─────────────────────────────────────────────────
  describe("pendingRevenue and claim", function () {
    it("correctly distributes proportionally (30/30/25/15 weights)", async function () {
      await registerAgents();
      const deposit = ethers.parseEther("1");
      await rs.depositRevenue({ value: deposit });

      // Agent 1: 30% of 1 ETH = 0.3 ETH
      expect(await rs.pendingRevenue(1n)).to.be.closeTo(
        ethers.parseEther("0.3"), ethers.parseEther("0.0001")
      );
      // Agent 2: 30% of 1 ETH = 0.3 ETH
      expect(await rs.pendingRevenue(2n)).to.be.closeTo(
        ethers.parseEther("0.3"), ethers.parseEther("0.0001")
      );
      // Agent 3: 25% of 1 ETH = 0.25 ETH
      expect(await rs.pendingRevenue(3n)).to.be.closeTo(
        ethers.parseEther("0.25"), ethers.parseEther("0.0001")
      );
      // Agent 4: 15% of 1 ETH = 0.15 ETH
      expect(await rs.pendingRevenue(4n)).to.be.closeTo(
        ethers.parseEther("0.15"), ethers.parseEther("0.0001")
      );
    });

    it("claim sends ETH to agent wallet", async function () {
      await registerAgents();
      const deposit = ethers.parseEther("1");
      await rs.depositRevenue({ value: deposit });

      const before = await ethers.provider.getBalance(agent1.address);
      await rs.claim(1n); // claim for agent 1
      const after = await ethers.provider.getBalance(agent1.address);

      // agent1 should receive ~0.3 ETH
      expect(after - before).to.be.closeTo(
        ethers.parseEther("0.3"), ethers.parseEther("0.001")
      );
    });

    it("pendingRevenue is 0 after claim, then accrues on new deposit", async function () {
      await registerAgents();
      await rs.depositRevenue({ value: ethers.parseEther("1") });
      await rs.claim(1n);

      expect(await rs.pendingRevenue(1n)).to.equal(0n);

      // New deposit
      await rs.depositRevenue({ value: ethers.parseEther("0.5") });
      const pending = await rs.pendingRevenue(1n);
      expect(pending).to.be.closeTo(
        ethers.parseEther("0.15"), ethers.parseEther("0.001") // 30% of 0.5
      );
    });

    it("reverts claim when nothing pending", async function () {
      await registerAgents();
      await expect(rs.claim(1n))
        .to.be.revertedWithCustomError(rs, "NothingToClaim");
    });

    it("reverts claim for invalid agentId", async function () {
      await expect(rs.claim(99n))
        .to.be.revertedWithCustomError(rs, "AgentNotFound");
    });
  });

  // ─── late-registration ──────────────────────────────────────────────────────
  describe("late registration (agent doesn't get past revenue)", function () {
    it("late agent gets no revenue from deposits before their registration", async function () {
      // Register agent1 only (100%), deposit 1 ETH
      await rs.registerAgent("did:a1", "A1", 5000n, agent1.address);
      await rs.registerAgent("did:a2", "A2", 5000n, agent2.address);
      await rs.depositRevenue({ value: ethers.parseEther("1") });

      // Claim for agent1 first, then add a 3rd agent
      await rs.claim(1n);
      await rs.claim(2n);

      // Register agent3 AFTER both deposits are settled (gets nothing from previous deposit)
      // Need room: reduce agent2 weight first
      await rs.updateWeight(2n, 3000n);
      await rs.registerAgent("did:a3", "A3", 2000n, agent3.address);

      expect(await rs.pendingRevenue(3n)).to.equal(0n); // agent3 gets nothing retroactively

      // New deposit — agents 1, 2, 3 share
      await rs.depositRevenue({ value: ethers.parseEther("1") });
      const p3 = await rs.pendingRevenue(3n);
      // agent3 has 2000/10000 = 20% of 1 ETH = 0.2 ETH
      expect(p3).to.be.closeTo(ethers.parseEther("0.2"), ethers.parseEther("0.001"));
    });
  });

  // ─── multiple deposits ──────────────────────────────────────────────────────
  describe("multiple deposits accumulate correctly", function () {
    it("3 deposits sum correctly for agent1", async function () {
      await rs.registerAgent("did:a1", "A1", 5000n, agent1.address);
      await rs.registerAgent("did:a2", "A2", 5000n, agent2.address);

      await rs.depositRevenue({ value: ethers.parseEther("1") });
      await rs.depositRevenue({ value: ethers.parseEther("0.5") });
      await rs.depositRevenue({ value: ethers.parseEther("0.5") });

      // Total 2 ETH, agent1 = 50% = 1 ETH
      const pending = await rs.pendingRevenue(1n);
      expect(pending).to.be.closeTo(
        ethers.parseEther("1"), ethers.parseEther("0.001")
      );
    });
  });

  // ─── contractBalance ──────────────────────────────────────────────────────
  describe("contractBalance", function () {
    it("reflects deposited ETH minus claimed", async function () {
      await registerAgents();
      const deposit = ethers.parseEther("1");
      await rs.depositRevenue({ value: deposit });

      const balBefore = await rs.contractBalance();
      expect(balBefore).to.equal(deposit);

      await rs.claim(1n); // agent1 claims ~0.3 ETH
      const balAfter = await rs.contractBalance();
      expect(balAfter).to.be.lt(deposit);
    });
  });
});
