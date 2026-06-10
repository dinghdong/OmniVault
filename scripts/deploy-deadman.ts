import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying DeadManSwitch with:', deployer.address);

  const DMS = await ethers.getContractFactory('DeadManSwitch');
  const dms = await DMS.deploy();
  await dms.waitForDeployment();

  const addr = await dms.getAddress();
  console.log('DeadManSwitch deployed to:', addr);

  // Optional wiring: link InvestmentManager so triggerDeadSwitch() can
  // actually write off the project (requires RISK_AGENT_ROLE).
  const imAddr = process.env.INVESTMENT_MANAGER_ADDRESS;
  if (imAddr) {
    await (await dms.setInvestmentManager(imAddr)).wait();
    console.log('DeadManSwitch.investmentManager →', imAddr);

    const im = await ethers.getContractAt('InvestmentManager', imAddr);
    await (await im.grantRole(await im.RISK_AGENT_ROLE(), addr)).wait();
    console.log('InvestmentManager.RISK_AGENT_ROLE → DeadManSwitch');
  } else {
    console.log('\nINVESTMENT_MANAGER_ADDRESS not set — deployed standalone.');
    console.log('To wire write-off later:');
    console.log('  dms.setInvestmentManager(<im>)');
    console.log('  im.grantRole(RISK_AGENT_ROLE, ' + addr + ')');
  }

  console.log('\nAdd to ai-service .env:');
  console.log('DEAD_MAN_SWITCH_ADDRESS=' + addr);
  console.log('\nAdd to frontend .env.local:');
  console.log('NEXT_PUBLIC_DEAD_MAN_SWITCH_ADDRESS=' + addr);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
