const { expect } = require("chai");
const hre = require("hardhat");

const e18 = 10n ** 18n;

function bigNum(n) { return n; }

describe("FundToken", function () {
  let ft, owner, alice, bob;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner = signers[0];
    alice = signers[1];
    bob = signers[2];

    const FundToken = await hre.ethers.getContractFactory("FundToken");
    ft = await FundToken.deploy();
    await ft.waitForDeployment();

    const MINTER_ROLE = await ft.MINTER_ROLE();
    const BURNER_ROLE = await ft.BURNER_ROLE();
    await ft.grantRole(MINTER_ROLE, owner.address);
    await ft.grantRole(BURNER_ROLE, owner.address);
  });

  describe("basic accounting", function () {
    it("starts with accrualFactor = 1e18", async function () {
      expect(await ft.accrualFactor()).to.equal(bigNum(e18));
    });

    it("mints shares correctly at initial factor", async function () {
      const amount = bigNum(1000n * e18);
      await ft.mint(alice.address, amount);
      expect(await ft.shares(alice.address)).to.equal(amount);
      expect(await ft.balanceOf(alice.address)).to.equal(amount);
    });

    it("balanceOf reflects accrualFactor after yield", async function () {
      const amount = bigNum(1000n * e18);
      await ft.mint(alice.address, amount);
      await ft.applyYield(bigNum(50n * e18), amount);
      expect(await ft.balanceOf(alice.address)).to.equal(bigNum(1050n * e18));
      expect(await ft.cumulativeYield()).to.equal(bigNum(105n * 10n ** 16n));
    });

    it("applyLoss shrinks balance proportionally", async function () {
      const amount = bigNum(1000n * e18);
      await ft.mint(alice.address, amount);
      await ft.applyLoss(bigNum(200n * e18), amount);
      expect(await ft.balanceOf(alice.address)).to.equal(bigNum(800n * e18));
    });

    it("full loss reduces balance to zero", async function () {
      const amount = bigNum(1000n * e18);
      await ft.mint(alice.address, amount);
      await ft.applyLoss(amount, amount);
      expect(await ft.balanceOf(alice.address)).to.equal(bigNum(0n));
    });

    it("burn reduces shares correctly", async function () {
      const amount = bigNum(1000n * e18);
      await ft.mint(alice.address, amount);
      await ft.burn(alice.address, bigNum(400n * e18));
      expect(await ft.shares(alice.address)).to.equal(bigNum(600n * e18));
      expect(await ft.totalSupply()).to.equal(bigNum(600n * e18));
    });

    it("applyYield then applyLoss recovers correctly", async function () {
      const amount = bigNum(1000n * e18);
      await ft.mint(alice.address, amount);
      await ft.applyYield(bigNum(100n * e18), amount);
      // Factor: (1000 + 100) / 1000 = 1.1, so balance = 1.1 * 1000 = 1100e18
      const balanceAfterYield = await ft.balanceOf(alice.address);
      console.log("balanceAfterYield:", balanceAfterYield.toString());
      await ft.applyLoss(bigNum(50n * e18), amount);
      // Factor: (1100 - 50) / 1000 = 1.05, so balance = 1.05 * 1000 = 1050e18
      const balanceAfterLoss = await ft.balanceOf(alice.address);
      console.log("balanceAfterLoss:", balanceAfterLoss.toString());
      expect(balanceAfterLoss).to.equal(bigNum(1050n * e18));
    });

    it("handles zero yield gracefully", async function () {
      const amount = bigNum(1000n * e18);
      await ft.mint(alice.address, amount);
      await ft.applyYield(bigNum(0n), amount);
      expect(await ft.balanceOf(alice.address)).to.equal(amount);
    });

    it("handles zero totalShares gracefully", async function () {
      await ft.applyYield(bigNum(100n * e18), bigNum(0n));
      expect(await ft.accrualFactor()).to.equal(bigNum(e18));
    });

    it("handles zero loss gracefully", async function () {
      const amount = bigNum(1000n * e18);
      await ft.mint(alice.address, amount);
      await ft.applyLoss(bigNum(0n), amount);
      expect(await ft.balanceOf(alice.address)).to.equal(amount);
    });
  });

  describe("access control", function () {
    it("rejects mint from non-minter", async function () {
      await expect(
        ft.connect(alice).mint(alice.address, bigNum(1000n * e18))
      ).to.be.revertedWith("Not minter");
    });

    it("rejects burn from non-burner", async function () {
      await ft.mint(alice.address, bigNum(1000n * e18));
      await expect(
        ft.connect(alice).burn(alice.address, bigNum(100n * e18))
      ).to.be.revertedWith("Not burner");
    });

    it("rejects applyYield from non-minter", async function () {
      await expect(
        ft.connect(alice).applyYield(bigNum(100n * e18), bigNum(1000n * e18))
      ).to.be.revertedWith("Not minter");
    });

    it("rejects applyLoss from non-minter", async function () {
      await expect(
        ft.connect(alice).applyLoss(bigNum(100n * e18), bigNum(1000n * e18))
      ).to.be.revertedWith("Not minter");
    });
  });

  describe("accrualFactorHistory", function () {
    it("starts with one entry", async function () {
      expect(await ft.accrualFactorHistory(0)).to.equal(bigNum(e18));
    });

    it("adds entry on yield", async function () {
      await ft.applyYield(bigNum(100n * e18), bigNum(1000n * e18));
      expect(await ft.accrualFactorHistory(1)).to.equal(bigNum(11n * 10n ** 17n));
    });

    it("adds entry on loss", async function () {
      await ft.applyLoss(bigNum(100n * e18), bigNum(1000n * e18));
      expect(await ft.accrualFactorHistory(1)).to.equal(bigNum(9n * 10n ** 17n));
    });
  });

  describe("multiple LPs", function () {
    it("all balances grow proportionally on yield", async function () {
      await ft.mint(alice.address, bigNum(700n * e18));
      await ft.mint(bob.address, bigNum(300n * e18));
      await ft.applyYield(bigNum(100n * e18), bigNum(1000n * e18));
      expect(await ft.balanceOf(alice.address)).to.equal(bigNum(770n * e18));
      expect(await ft.balanceOf(bob.address)).to.equal(bigNum(330n * e18));
    });

    it("all balances shrink proportionally on loss", async function () {
      await ft.mint(alice.address, bigNum(700n * e18));
      await ft.mint(bob.address, bigNum(300n * e18));
      await ft.applyLoss(bigNum(200n * e18), bigNum(1000n * e18));
      expect(await ft.balanceOf(alice.address)).to.equal(bigNum(560n * e18));
      expect(await ft.balanceOf(bob.address)).to.equal(bigNum(240n * e18));
    });

    it("new LP gets fair share after yield", async function () {
      // Alice deposits 1000 shares, factor = 1e18
      await ft.mint(alice.address, bigNum(1000n * e18));
      // Yield: factor goes 1e18 → 1.1e18, Alice balance = 1100e18
      await ft.applyYield(bigNum(100n * e18), bigNum(1000n * e18));
      expect(await ft.balanceOf(alice.address)).to.equal(bigNum(1100n * e18));
      // Bob deposits 1100e18 shares directly. shares(bob) = 1100e18, balance(bob) = 1100 * 1.1 = 1210e18
      await ft.mint(bob.address, bigNum(1100n * e18));
      expect(await ft.shares(bob.address)).to.equal(bigNum(1100n * e18));
      expect(await ft.balanceOf(bob.address)).to.equal(bigNum(1210n * e18));
    });
  });

  describe("cumulativeYield", function () {
    it("returns 1e18 initially", async function () {
      expect(await ft.cumulativeYield()).to.equal(bigNum(e18));
    });

    it("returns correct multiplier after yield", async function () {
      await ft.applyYield(bigNum(50n * e18), bigNum(1000n * e18));
      // factor = 1e18 * (1000e18 + 50e18) / 1000e18 = 1.05e18 = 105 * 10^16
      expect(await ft.cumulativeYield()).to.equal(bigNum(105n * 10n ** 16n));
    });
  });
});
