const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("NonFungibleAgent (NFA)", function () {
  let nfa, owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const F = await ethers.getContractFactory("NonFungibleAgent");
    nfa = await F.deploy();
  });

  // ── Minting ─────────────────────────────────────────────────────────────────

  it("mints token #1 to caller", async function () {
    await nfa.connect(alice).mint("github.com/org/agent", "https://api.agent.ai/v1", "claude-sonnet-4-6");
    expect(await nfa.ownerOf(1)).to.equal(alice.address);
  });

  it("increments tokenId sequentially", async function () {
    await nfa.connect(alice).mint("repo1", "ep1", "model1");
    await nfa.connect(bob).mint("repo2", "ep2", "model2");
    expect(await nfa.ownerOf(1)).to.equal(alice.address);
    expect(await nfa.ownerOf(2)).to.equal(bob.address);
  });

  it("stores metadata correctly", async function () {
    await nfa.connect(alice).mint("github.com/org/agent", "https://api.agent.ai/v1", "deepseek-v3");
    const meta = await nfa.getAgent(1);
    expect(meta.repo).to.equal("github.com/org/agent");
    expect(meta.apiEndpoint).to.equal("https://api.agent.ai/v1");
    expect(meta.model).to.equal("deepseek-v3");
    expect(meta.mintedAt).to.be.gt(0n);
  });

  it("totalSupply increments on each mint", async function () {
    expect(await nfa.totalSupply()).to.equal(0n);
    await nfa.connect(alice).mint("r", "e", "m");
    expect(await nfa.totalSupply()).to.equal(1n);
    await nfa.connect(bob).mint("r", "e", "m");
    expect(await nfa.totalSupply()).to.equal(2n);
  });

  it("emits AgentMinted with correct fields", async function () {
    const tx = nfa.connect(alice).mint("github.com/org/a", "https://ep.ai", "claude-sonnet-4-6");
    await expect(tx)
      .to.emit(nfa, "AgentMinted")
      .withArgs(
        1n,
        alice.address,
        await (async () => { await tx; return nfa.getDid(1); })(),
        "github.com/org/a",
        "claude-sonnet-4-6"
      );
  });

  // ── DID derivation ──────────────────────────────────────────────────────────

  it("getDid starts with did:nfa:", async function () {
    await nfa.connect(alice).mint("r", "e", "m");
    const did = await nfa.getDid(1);
    expect(did).to.match(/^did:nfa:\d+:0x[0-9a-f]{40}:1$/);
  });

  it("getDid contains chain ID", async function () {
    await nfa.connect(alice).mint("r", "e", "m");
    const did   = await nfa.getDid(1);
    const parts = did.split(":");
    // parts: ["did", "nfa", chainId, addr, tokenId]
    const network = await ethers.provider.getNetwork();
    expect(parts[2]).to.equal(network.chainId.toString());
  });

  it("getDid token suffix matches tokenId", async function () {
    await nfa.connect(alice).mint("r", "e", "m");
    await nfa.connect(bob).mint("r", "e", "m");
    const did2 = await nfa.getDid(2);
    expect(did2.endsWith(":2")).to.be.true;
  });

  it("getDid reverts for non-existent token", async function () {
    await expect(nfa.getDid(99)).to.be.reverted;
  });

  // ── getAgent guard ──────────────────────────────────────────────────────────

  it("getAgent reverts for non-existent token", async function () {
    await expect(nfa.getAgent(99)).to.be.reverted;
  });

  // ── tokensOfOwner ───────────────────────────────────────────────────────────

  it("tokensOfOwner returns correct token IDs", async function () {
    await nfa.connect(alice).mint("r", "e", "m"); // #1
    await nfa.connect(bob).mint("r", "e", "m");   // #2
    await nfa.connect(alice).mint("r", "e", "m"); // #3
    const aliceTokens = await nfa.tokensOfOwner(alice.address);
    expect(aliceTokens.map(x => Number(x))).to.deep.equal([1, 3]);
    const bobTokens = await nfa.tokensOfOwner(bob.address);
    expect(bobTokens.map(x => Number(x))).to.deep.equal([2]);
  });

  it("tokensOfOwner returns empty for wallet with no NFAs", async function () {
    const tokens = await nfa.tokensOfOwner(bob.address);
    expect(tokens.length).to.equal(0);
  });

  // ── Transfer ────────────────────────────────────────────────────────────────

  it("transfers agent ownership", async function () {
    await nfa.connect(alice).mint("r", "e", "m");
    await nfa.connect(alice).transferFrom(alice.address, bob.address, 1);
    expect(await nfa.ownerOf(1)).to.equal(bob.address);
    // metadata preserved after transfer
    const meta = await nfa.getAgent(1);
    expect(meta.repo).to.equal("r");
  });

  it("non-owner cannot transfer token", async function () {
    await nfa.connect(alice).mint("r", "e", "m");
    await expect(
      nfa.connect(bob).transferFrom(alice.address, bob.address, 1)
    ).to.be.reverted;
  });

  // ── ERC-721 metadata ────────────────────────────────────────────────────────

  it("name and symbol are correct", async function () {
    expect(await nfa.name()).to.equal("NonFungibleAgent");
    expect(await nfa.symbol()).to.equal("NFA");
  });
});
