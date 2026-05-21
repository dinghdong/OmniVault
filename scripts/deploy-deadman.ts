import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying DeadManSwitch with:', deployer.address);

  const DMS = await ethers.getContractFactory('DeadManSwitch');
  const dms = await DMS.deploy();
  await dms.waitForDeployment();

  const addr = await dms.getAddress();
  console.log('DeadManSwitch deployed to:', addr);
  console.log('\nAdd to ai-service .env:');
  console.log('DEAD_MAN_SWITCH_ADDRESS=' + addr);
  console.log('\nAdd to frontend .env.local:');
  console.log('NEXT_PUBLIC_DEAD_MAN_SWITCH_ADDRESS=' + addr);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
