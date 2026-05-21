import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Existing contracts (unchanged)
const IM_ADDRESS = '0x4BdD5CeF85A36124992eC588952A7EFf057a3Ac8';
const LINK_TOKEN = '0x779877A7B0D9E8603169DdbD7836e478b4624789'; // Sepolia LINK

// Chainlink Functions (Sepolia)
const FUNCTIONS_ROUTER = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';
const DON_ID           = ethers.encodeBytes32String('fun-ethereum-sepolia-1');
const SUB_ID           = 6554n;
const CALLBACK_GAS     = 300_000;

const IM_ABI = [
  'function setOracle(address _oracle) external',
  'function oracle() view returns (address)',
];
const ROUTER_ABI = [
  'function addConsumer(uint64 subscriptionId, address consumer) external',
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log('Deployer:', signer.address);

  // 1. Deploy new OmniOracle
  const OmniOracle = await ethers.getContractFactory('OmniOracle');
  console.log('\nDeploying OmniOracle...');
  const oracle = await OmniOracle.deploy(FUNCTIONS_ROUTER, SUB_ID, DON_ID);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log('✓ OmniOracle deployed:', oracleAddr);

  // 2. Set callback gas limit
  console.log('Setting callbackGasLimit to', CALLBACK_GAS, '...');
  await (await oracle.setCallbackGasLimit(CALLBACK_GAS)).wait();
  console.log('✓ Gas limit set');

  // 3. Upload audit source
  const sourcePath = path.join(__dirname, '../chainlink/audit-source.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  console.log('Uploading audit source...');
  await (await oracle.setAuditSource(source)).wait();
  console.log('✓ Audit source uploaded');

  // 4. Link to InvestmentManager (bidirectional)
  console.log('Setting oracle in InvestmentManager...');
  const im = new ethers.Contract(IM_ADDRESS, IM_ABI, signer);
  await (await im.setOracle(oracleAddr)).wait();
  console.log('✓ InvestmentManager.oracle =', oracleAddr);

  console.log('Setting investmentManager in OmniOracle...');
  await (await oracle.setInvestmentManager(IM_ADDRESS)).wait();
  console.log('✓ OmniOracle.investmentManager =', IM_ADDRESS);

  // 5. Add as Chainlink consumer
  console.log('Adding OmniOracle as Chainlink consumer...');
  const router = new ethers.Contract(FUNCTIONS_ROUTER, ROUTER_ABI, signer);
  await (await router.addConsumer(SUB_ID, oracleAddr)).wait();
  console.log('✓ Consumer added to subscription', SUB_ID.toString());

  console.log('\n══════════════════════════════════════════');
  console.log('New OmniOracle address:', oracleAddr);
  console.log('Update frontend/.env.local:');
  console.log(`NEXT_PUBLIC_OMNI_ORACLE_ADDRESS=${oracleAddr}`);
  console.log('══════════════════════════════════════════');
}

main().catch(console.error);
