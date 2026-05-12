const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const DELAY = 72 * 3600;
const COMMUNITY_WINDOW = 48 * 3600;

async function increaseTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

describe("AgentRegistry", function () {
  let registry, owner, agent1, agent2, other;

  beforeEach(async function () {
    [owner, agent1, agent2, other] = await hre.ethers.getSigners();
    const R = await hre.ethers.getContractFactory("AgentRegistry");
    registry = await R.deploy();
    await registry.waitForDeployment();
  });

  it("starts with zero agents", async function () {
    expect(await registry.agentCount()).to.equal(0);
  });

  it("admin can add an agent", async function () {
    await registry.addAgent(agent1.address);
    expect(await registry.isRegistered(agent1.address)).to.be.true;
    expect(await registry.agentCount()).to.equal(1);
  });

  it("emits AgentAdded", async function () {
    await expect(registry.addAgent(agent1.address))
      .to.emit(registry, "AgentAdded")
      .withArgs(agent1.address);
  });

  it("reverts on duplicate add", async function () {
    await registry.addAgent(agent1.address);
    await expect(registry.addAgent(agent1.address))
      .to.be.revertedWithCustomError(registry, "AlreadyRegistered");
  });

  it("admin can remove an agent", async function () {
    await registry.addAgent(agent1.address);
    await registry.removeAgent(agent1.address);
    expect(await registry.isRegistered(agent1.address)).to.be.false;
    expect(await registry.agentCount()).to.equal(0);
  });

  it("emits AgentRemoved", async function () {
    await registry.addAgent(agent1.address);
    await expect(registry.removeAgent(agent1.address))
      .to.emit(registry, "AgentRemoved")
      .withArgs(agent1.address);
  });

  it("reverts removing non-existent agent", async function () {
    await expect(registry.removeAgent(agent1.address))
      .to.be.revertedWithCustomError(registry, "NotRegistered");
  });

  it("non-admin cannot add agent", async function () {
    await expect(registry.connect(other).addAgent(agent1.address))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  it("getAgents() returns correct list after add/remove", async function () {
    await registry.addAgent(agent1.address);
    await registry.addAgent(agent2.address);
    await registry.removeAgent(agent1.address);
    const agents = await registry.getAgents();
    expect(agents.length).to.equal(1);
    expect(agents[0]).to.equal(agent2.address);
  });
});

describe("AgentVoting", function () {
  let registry, av, im, ft, fv, weth, aavePool, aWeth;
  let owner, lp, applicant, agent1, agent2, agent3, other;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner     = signers[0];
    lp        = signers[1];
    applicant = signers[2];
    agent1    = signers[3];
    agent2    = signers[4];
    agent3    = signers[5];
    other     = signers[6];

    // Deploy WETH + Aave mocks + vault
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

    const FT = await hre.ethers.getContractFactory("FundToken");
    ft = await FT.deploy();
    await ft.waitForDeployment();

    const FV = await hre.ethers.getContractFactory("FundVault");
    fv = await FV.deploy(
      await weth.getAddress(),
      await aavePool.getAddress(),
      await aWeth.getAddress(),
      await ft.getAddress()
    );
    await fv.waitForDeployment();

    // InvestmentManager
    const IM = await hre.ethers.getContractFactory("InvestmentManager");
    im = await IM.deploy(await fv.getAddress(), await weth.getAddress());
    await im.waitForDeployment();

    // AgentRegistry
    const R = await hre.ethers.getContractFactory("AgentRegistry");
    registry = await R.deploy();
    await registry.waitForDeployment();

    // AgentVoting
    const AV = await hre.ethers.getContractFactory("AgentVoting");
    av = await AV.deploy(
      await registry.getAddress(),
      await im.getAddress(),
      await ft.getAddress()
    );
    await av.waitForDeployment();

    // Grant AgentVoting the AI_ORACLE_ROLE on InvestmentManager
    await im.grantRole(await im.AI_ORACLE_ROLE(), await av.getAddress());

    // Register 3 agents
    await registry.addAgent(agent1.address);
    await registry.addAgent(agent2.address);
    await registry.addAgent(agent3.address);

    // FundVault roles
    await ft.grantRole(await ft.MINTER_ROLE(), await fv.getAddress());
    await ft.grantRole(await ft.BURNER_ROLE(), await fv.getAddress());
    await fv.grantRole(await fv.INVESTOR_ROLE(), await im.getAddress());
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  async function submitProject() {
    await im.connect(applicant).submitProject(
      hre.ethers.id("commit"),
      "0x1234567890123456789012345678901234567890",
      "https://api.example.com"
    );
    return await im.projectCount();
  }

  async function allAgentsVoteApprove(projectId, score = 8500) {
    const hash = hre.ethers.id("reasoning");
    await av.connect(agent1).agentVote(projectId, true, score, score - 500, score + 500, hash);
    await av.connect(agent2).agentVote(projectId, true, score, score - 500, score + 500, hash);
    await av.connect(agent3).agentVote(projectId, true, score, score - 500, score + 500, hash);
  }

  // ── agentVote ──────────────────────────────────────────────────────────────
  describe("agentVote", function () {
    it("non-agent cannot vote", async function () {
      const pid = await submitProject();
      await expect(
        av.connect(other).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH)
      ).to.be.revertedWithCustomError(av, "NotRegisteredAgent");
    });

    it("agent cannot vote twice", async function () {
      const pid = await submitProject();
      await av.connect(agent1).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH);
      await expect(
        av.connect(agent1).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH)
      ).to.be.revertedWithCustomError(av, "AlreadyVoted");
    });

    it("emits AgentVoted", async function () {
      const pid = await submitProject();
      await expect(
        av.connect(agent1).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH)
      ).to.emit(av, "AgentVoted").withArgs(pid, agent1.address, true, 8500, ZERO_HASH);
    });

    it("single agent approve does not reach quorum (3 agents)", async function () {
      const pid = await submitProject();
      await av.connect(agent1).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH);
      const pv = await av.projectVotings(pid);
      expect(pv.quorumReached).to.be.false;
    });

    it("all 3 agents approve → QuorumReached emitted, community window set", async function () {
      const pid = await submitProject();
      await av.connect(agent1).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH);
      await av.connect(agent2).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH);
      await expect(
        av.connect(agent3).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH)
      ).to.emit(av, "QuorumReached");

      const pv = await av.projectVotings(pid);
      expect(pv.quorumReached).to.be.true;
      expect(pv.communityWindowEnd).to.be.gt(0);
    });

    it("any agent reject → ProjectRejected emitted + IM status = Rejected", async function () {
      const pid = await submitProject();
      await av.connect(agent1).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH);
      await expect(
        av.connect(agent2).agentVote(pid, false, 5000, 4500, 5500, ZERO_HASH)
      ).to.emit(av, "ProjectRejected").withArgs(pid, agent2.address);

      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected
    });

    it("cannot vote after project is already finalized (rejected)", async function () {
      const pid = await submitProject();
      await av.connect(agent1).agentVote(pid, false, 4000, 3500, 4500, ZERO_HASH);
      await expect(
        av.connect(agent2).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH)
      ).to.be.revertedWithCustomError(av, "AlreadyExecuted");
    });
  });

  // ── communityVeto ──────────────────────────────────────────────────────────
  describe("communityVeto", function () {
    it("reverts before quorum is reached", async function () {
      const pid = await submitProject();
      await expect(av.connect(lp).communityVeto(pid))
        .to.be.revertedWithCustomError(av, "QuorumNotReached");
    });

    it("reverts if LP has < 1% supply", async function () {
      const pid = await submitProject();
      // lp has no FundToken → 0% supply
      await allAgentsVoteApprove(pid);
      await expect(av.connect(lp).communityVeto(pid))
        .to.be.revertedWithCustomError(av, "InsufficientVotingPower");
    });

    it("LP with ≥ 1% can communityVeto during window", async function () {
      const pid = await submitProject();
      // LP deposits to get FundToken
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });

      await allAgentsVoteApprove(pid);

      await expect(av.connect(lp).communityVeto(pid))
        .to.emit(av, "CommunityVetoed").withArgs(pid, lp.address);

      const p = await im.projects(pid);
      expect(p.status).to.equal(4); // Rejected (via fulfillAuditFailure)
    });

    it("reverts after 48 h window closes", async function () {
      const pid = await submitProject();
      await fv.connect(lp).deposit({ value: ethers.parseEther("1") });
      await allAgentsVoteApprove(pid);

      await increaseTime(COMMUNITY_WINDOW + 1);

      await expect(av.connect(lp).communityVeto(pid))
        .to.be.revertedWithCustomError(av, "CommunityWindowClosed");
    });
  });

  // ── triggerExecution ───────────────────────────────────────────────────────
  describe("triggerExecution", function () {
    it("reverts before quorum", async function () {
      const pid = await submitProject();
      await expect(av.triggerExecution(pid))
        .to.be.revertedWithCustomError(av, "QuorumNotReached");
    });

    it("reverts while community window is open", async function () {
      const pid = await submitProject();
      await allAgentsVoteApprove(pid);
      await expect(av.triggerExecution(pid))
        .to.be.revertedWithCustomError(av, "CommunityWindowOpen");
    });

    it("anyone can trigger after window closes → VotingExecuted emitted", async function () {
      const pid = await submitProject();
      await allAgentsVoteApprove(pid, 9000);
      await increaseTime(COMMUNITY_WINDOW + 1);

      await expect(av.connect(other).triggerExecution(pid))
        .to.emit(av, "VotingExecuted");
    });

    it("after triggerExecution: IM status = PendingExecution with averaged score", async function () {
      const pid = await submitProject();
      // agent1=8000, agent2=9000, agent3=8500 → avg=8500
      await av.connect(agent1).agentVote(pid, true, 8000, 7500, 8500, ZERO_HASH);
      await av.connect(agent2).agentVote(pid, true, 9000, 8500, 9500, ZERO_HASH);
      await av.connect(agent3).agentVote(pid, true, 8500, 8000, 9000, ZERO_HASH);

      await increaseTime(COMMUNITY_WINDOW + 1);
      await av.triggerExecution(pid);

      const p = await im.projects(pid);
      expect(p.status).to.equal(3);        // PendingExecution
      expect(p.auditScore).to.equal(8500); // (8000+9000+8500)/3 = 8500
    });

    it("reverts if called twice", async function () {
      const pid = await submitProject();
      await allAgentsVoteApprove(pid);
      await increaseTime(COMMUNITY_WINDOW + 1);
      await av.triggerExecution(pid);

      await expect(av.triggerExecution(pid))
        .to.be.revertedWithCustomError(av, "AlreadyExecuted");
    });
  });

  // ── Full flow: approve → community window → PendingExecution → executeInvestment ──
  describe("Full happy-path flow", function () {
    it("3 agents approve → 48 h window → triggerExecution → 72 h → executeInvestment", async function () {
      // Fund the vault so executeInvestment can transfer ETH
      await fv.connect(lp).deposit({ value: ethers.parseEther("5") });
      await hre.network.provider.request({
        method: "hardhat_setBalance",
        params: [await fv.getAddress(), "0x" + ethers.parseEther("10").toString(16)],
      });

      const pid = await submitProject();
      await allAgentsVoteApprove(pid, 9000);

      // Community window passes without veto
      await increaseTime(COMMUNITY_WINDOW + 1);
      await av.triggerExecution(pid);

      let p = await im.projects(pid);
      expect(p.status).to.equal(3); // PendingExecution

      // 72 h timelock passes
      await increaseTime(DELAY + 1);

      // Anyone executes (permissionless)
      await im.connect(other).executeInvestment(pid, ethers.parseEther("1"), "0x");

      p = await im.projects(pid);
      expect(p.status).to.equal(5); // Active
    });
  });
});
