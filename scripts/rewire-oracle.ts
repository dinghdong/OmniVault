import { ethers } from 'hardhat';

const NEW_ORACLE = '0x2FbbA381BB0d69f182ba2E91bC862688C90aCce6';
const NEW_IM     = '0x4444554C2483853970eaF00697Ae81E2ffee9434';

async function main() {
  const [signer] = await ethers.getSigners();

  const im = new ethers.Contract(NEW_IM,
    ['function setOracle(address) external'], signer);
  await (await im.setOracle(NEW_ORACLE)).wait();
  console.log('✓ NewIM.oracle =', NEW_ORACLE);

  const oracle = new ethers.Contract(NEW_ORACLE,
    ['function setInvestmentManager(address) external'], signer);
  await (await oracle.setInvestmentManager(NEW_IM)).wait();
  console.log('✓ NewOracle.investmentManager =', NEW_IM);
}
main().catch(console.error);
