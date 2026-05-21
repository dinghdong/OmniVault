import { ethers } from 'hardhat';

const ORACLE = '0x471806AA331c6D282cA13AbCcce2315E769389c5';
const IM     = '0x4f4882929d46588f6Ce366Fc791d6ADD40FcaBD1';

async function main() {
  const [signer] = await ethers.getSigners();
  const oracle = new ethers.Contract(ORACLE, [
    'function setInvestmentManager(address _im) external',
    'function investmentManager() view returns (address)',
  ], signer);

  console.log('Current investmentManager:', await oracle.investmentManager());
  const tx = await oracle.setInvestmentManager(IM);
  await tx.wait();
  console.log('✓ Set. tx:', tx.hash);
  console.log('New investmentManager:', await oracle.investmentManager());
}
main().catch(console.error);
