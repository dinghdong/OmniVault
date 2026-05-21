import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying ComputeAuditTrail with:', deployer.address);

  const factory = await ethers.getContractFactory('ComputeAuditTrail');
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('ComputeAuditTrail deployed to:', address);
  console.log('\nAdd to ai-service/.env:');
  console.log(`COMPUTE_TRAIL_ADDRESS=${address}`);
}

main().catch(err => { console.error(err); process.exit(1); });
