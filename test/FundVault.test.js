const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

const toStr = (x) => x.toString();

// Helper: fund the vault with raw ETH (simulates returned investment proceeds)
async function fundVault(vaultAddr, amountEth) {
  await hre.network.provider.request({
    method: "hardhat_setBalance",
    params: [vaultAddr, "0x" + ethers.parseEther(amountEth).toString(16)],
  });
}

describe("FundVault (AAVE-free ETH vault)", function () {
  let fv, ft, owner, lp, lp2, investor;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner = signers[0];
    lp = signers[1];
    lp2 = signers[2];
    investor = signers[3];

    // 1. FundToken
    const FundTokenF = await hre.ethers.getContractFactory("FundToken");
    ft = await FundTokenF.deploy();
    await ft.waitForDeployment();

    // 2. FundVault (simple ETH vault, no AAVE)
    const FundVaultF = await hre.ethers.getContractFactory("FundVault");
    fv = await FundVaultF.deploy(await ft.getAddress());
    await fv.waitForDeployment();

    // 3. Roles
    await ft.grantRole(await ft.MINTER_ROLE(), await fv.getAddress());
    await ft.grantRole(await ft.BURNER_ROLE(), await fv.getAddress());
    await fv.grantRole(await fv.INVESTOR_ROLE(), investor.address);
  });

  // ─── Deposit ─────────────────────────────────────────────────────────────────
  describe("deposit", function () {
    it("reverts on zero ETH", async function () {
      await expect(
        fv.connect(lp).deposit({ value: 0 })
      ).to.be.revertedWithCustomError(fv, "ZeroAmount");
    });

    it("mints shares equal to ETH at accrualFactor=1e18", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });
      expect(await ft.getShares(lp.address)).to.equal(amount);
      expect(await ft.balanceOf(lp.address)).to.equal(amount);
    });

    it("ETH is held in the vault", async function () {
      const amount = ethers.parseEther("2");
      await fv.connect(lp).deposit({ value: amount });
      expect(await fv.vaultBalance()).to.be.gte(amount);
    });

    it("emits Deposited event", async function () {
      const amount = ethers.parseEther("0.5");
      await expect(fv.connect(lp).deposit({ value: amount }))
        .to.emit(fv, "Deposited")
        .withArgs(lp.address, amount, amount); // shares == amount when factor=1
    });
  });

  // ─── Redeem ──────────────────────────────────────────────────────────────────
  describe("redeem", function () {
    it("reverts on zero shares", async function () {
      await expect(fv.redeem(0)).to.be.revertedWithCustomError(fv, "ZeroAmount");
    });

    it("burns shares and returns ETH to LP", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });

      const vaultAddr = await fv.getAddress();
      await fundVault(vaultAddr, "5"); // ensure vault has ETH

      const shares = await ft.getShares(lp.address);
      const ethBefore = await ethers.provider.getBalance(lp.address);
      const tx = await fv.connect(lp).redeem(shares);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(lp.address);

      const received = ethAfter - ethBefore + gasCost;
      expect(received).to.equal(amount);
      expect(await ft.getShares(lp.address)).to.equal(0n);
    });

    it("reverts when vault lacks ETH", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });

      // Drain the vault
      const vaultAddr = await fv.getAddress();
      await hre.network.provider.request({
        method: "hardhat_setBalance",
        params: [vaultAddr, "0x0"],
      });

      const shares = await ft.getShares(lp.address);
      await expect(fv.connect(lp).redeem(shares))
        .to.be.revertedWithCustomError(fv, "InsufficientVaultBalance");
    });
  });

  // ─── Investment Operations ────────────────────────────────────────────────────
  describe("divestForInvestment", function () {
    it("only INVESTOR_ROLE can divest", async function () {
      await expect(fv.connect(lp).divestForInvestment(ethers.parseEther("0.1")))
        .to.be.revertedWithCustomError(fv, "AccessControlUnauthorizedAccount");
    });

    it("sends ETH to caller (INVESTOR_ROLE)", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });

      const before = await ethers.provider.getBalance(investor.address);
      const tx = await fv.connect(investor).divestForInvestment(amount);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(investor.address);

      expect(after + gasCost - before).to.equal(amount);
    });

    it("reverts when vault lacks ETH", async function () {
      await expect(fv.connect(investor).divestForInvestment(ethers.parseEther("1")))
        .to.be.revertedWithCustomError(fv, "InsufficientVaultBalance");
    });
  });

  // ─── Gain/Loss Accounting ─────────────────────────────────────────────────────
  describe("addRealizedGains", function () {
    it("only INVESTOR_ROLE can call", async function () {
      await expect(fv.connect(lp).addRealizedGains(1n, 1n))
        .to.be.revertedWithCustomError(fv, "AccessControlUnauthorizedAccount");
    });

    it("increases accrualFactor, raising LP balances", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });

      const gain = ethers.parseEther("0.1"); // +10%
      await fv.connect(investor).addRealizedGains(gain, amount, { value: gain });

      const balance = await fv.balanceOf(lp.address);
      expect(balance).to.be.gt(amount);
      expect(balance).to.be.closeTo(ethers.parseEther("1.1"), ethers.parseEther("0.001"));
    });
  });

  describe("addRealizedLoss", function () {
    it("only INVESTOR_ROLE can call", async function () {
      await expect(fv.connect(lp).addRealizedLoss(0n, ethers.parseEther("0.1")))
        .to.be.revertedWithCustomError(fv, "AccessControlUnauthorizedAccount");
    });

    it("decreases accrualFactor, reducing LP balances", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });

      const recovered = ethers.parseEther("0.9"); // lost 0.1
      await fv.connect(investor).addRealizedLoss(recovered, amount);

      const balance = await fv.balanceOf(lp.address);
      expect(balance).to.be.lt(amount);
      expect(balance).to.be.closeTo(ethers.parseEther("0.9"), ethers.parseEther("0.001"));
    });
  });

  // ─── Access Control ───────────────────────────────────────────────────────────
  describe("access control — all role-protected functions", function () {
    it("only INVESTOR_ROLE can call addRealizedGains", async function () {
      await expect(fv.connect(lp).addRealizedGains(1n, 1n))
        .to.be.revertedWithCustomError(fv, "AccessControlUnauthorizedAccount");
    });
    it("only INVESTOR_ROLE can call addRealizedLoss", async function () {
      await expect(fv.connect(lp).addRealizedLoss(0n, 1n))
        .to.be.revertedWithCustomError(fv, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── balanceOf / vaultBalance ─────────────────────────────────────────────────
  describe("view helpers", function () {
    it("balanceOf returns 0 for new address", async function () {
      expect(await fv.balanceOf(lp.address)).to.equal(0n);
    });

    it("balanceOf reflects deposit", async function () {
      const amount = ethers.parseEther("0.5");
      await fv.connect(lp).deposit({ value: amount });
      expect(await fv.balanceOf(lp.address)).to.equal(amount);
    });

    it("vaultBalance reflects deposited ETH", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });
      expect(await fv.vaultBalance()).to.be.gte(amount);
    });
  });
});
