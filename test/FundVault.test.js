const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("hardhat");

const toStr = (x) => x.toString();

describe("FundVault", function () {
  let fv, ft, weth, aavePool, aWeth, owner, lp, project;

  beforeEach(async function () {
    const signers = await hre.ethers.getSigners();
    owner = signers[0];
    lp = signers[1];
    project = signers[2];

    // 1. Mock WETH
    const MockWETH = await hre.ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();
    await weth.waitForDeployment();

    // 2. Mock AAVE Pool + aWETH
    const MockAavePool = await hre.ethers.getContractFactory("MockAavePool");
    aavePool = await MockAavePool.deploy();
    await aavePool.waitForDeployment();

    const MockAToken = await hre.ethers.getContractFactory("MockAToken");
    aWeth = await MockAToken.deploy(await aavePool.getAddress(), await weth.getAddress());
    await aWeth.waitForDeployment();

    await aavePool.setAToken(await weth.getAddress(), await aWeth.getAddress());

    // 3. FundToken
    const FundTokenF = await hre.ethers.getContractFactory("FundToken");
    ft = await FundTokenF.deploy();
    await ft.waitForDeployment();

    // 4. FundVault (ETH-only signature: weth, aavePool, aWeth, fundToken)
    const FundVaultF = await hre.ethers.getContractFactory("FundVault");
    fv = await FundVaultF.deploy(
      await weth.getAddress(),
      await aavePool.getAddress(),
      await aWeth.getAddress(),
      await ft.getAddress()
    );
    await fv.waitForDeployment();

    // 5. Roles
    await ft.grantRole(await ft.MINTER_ROLE(), await fv.getAddress());
    await ft.grantRole(await ft.BURNER_ROLE(), await fv.getAddress());
    await fv.grantRole(await fv.INVESTOR_ROLE(), owner.address);
  });

  describe("deposit", function () {
    it("reverts on zero value", async function () {
      await expect(
        fv.connect(lp).deposit({ value: 0 })
      ).to.be.revertedWithCustomError(fv, "ZeroAmount");
    });

    it("accepts ETH and mints FundToken shares", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });
      // At launch accrualFactor=1e18 → shares == amount
      expect(await ft.getShares(lp.address)).to.equal(amount);
      expect(await ft.balanceOf(lp.address)).to.equal(amount);
    });

    it("supplies ETH to AAVE as aWETH", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });
      // Vault holds aWETH 1:1 from MockAavePool
      expect(await aWeth.balanceOf(await fv.getAddress())).to.equal(amount);
    });
  });

  describe("redeem", function () {
    it("reverts on zero shares", async function () {
      await expect(fv.redeem(0)).to.be.revertedWithCustomError(fv, "ZeroAmount");
    });

    it("burns shares and returns ETH", async function () {
      const amount = ethers.parseEther("1");
      await fv.connect(lp).deposit({ value: amount });

      // Fund the vault with raw ETH so unwrap+send succeeds
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

      // LP should net ~1 ETH back (modulo gas)
      const received = ethAfter - ethBefore + gasCost;
      expect(received).to.equal(amount);
      expect(await ft.getShares(lp.address)).to.equal(0n);
    });
  });

  describe("access control", function () {
    it("only INVESTOR_ROLE can divest", async function () {
      const amount = ethers.parseEther("0.1");
      await expect(fv.connect(lp).divestForInvestment(amount))
        .to.be.revertedWithCustomError(fv, "AccessControlUnauthorizedAccount");
    });

    it("only INVESTOR_ROLE can addRealizedGains", async function () {
      await expect(fv.connect(lp).addRealizedGains(ethers.parseEther("0.1"), ethers.parseEther("0.08")))
        .to.be.revertedWithCustomError(fv, "AccessControlUnauthorizedAccount");
    });

    it("only INVESTOR_ROLE can addRealizedLoss", async function () {
      await expect(fv.connect(lp).addRealizedLoss(0n, ethers.parseEther("0.1")))
        .to.be.revertedWithCustomError(fv, "AccessControlUnauthorizedAccount");
    });
  });

  describe("balanceOf", function () {
    it("returns 0 for address with no balance", async function () {
      expect(toStr(await fv.balanceOf(lp.address))).to.equal("0");
    });

    it("reflects deposit amount", async function () {
      const amount = ethers.parseEther("0.5");
      await fv.connect(lp).deposit({ value: amount });
      expect(await fv.balanceOf(lp.address)).to.equal(amount);
    });
  });
});
