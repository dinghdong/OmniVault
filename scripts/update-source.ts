import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ORACLE = '0x471806AA331c6D282cA13AbCcce2315E769389c5';
const ABI = ['function setAuditSource(string calldata source) external'];

async function main() {
  const [signer] = await ethers.getSigners();
  const oracle = new ethers.Contract(ORACLE, ABI, signer);
  const source = fs.readFileSync(path.join(__dirname, '../chainlink/audit-source.js'), 'utf8');
  console.log(`Source length: ${source.length} bytes`);
  const tx = await oracle.setAuditSource(source);
  await tx.wait();
  console.log('✓ Audit source updated. tx:', tx.hash);
}
main().catch(console.error);
