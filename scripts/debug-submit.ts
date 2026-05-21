import { ethers } from 'hardhat';

const IM = '0x4f4882929d46588f6Ce366Fc791d6ADD40FcaBD1';

async function main() {
  const [signer] = await ethers.getSigners();
  const fakeHash = ethers.keccak256(ethers.toUtf8Bytes('demo-pitch'));

  const iface = new ethers.Interface([
    'function submitProject(bytes32,address,string,uint256) external returns (uint256)',
  ]);
  const calldata = iface.encodeFunctionData('submitProject', [
    fakeHash, signer.address, '', ethers.parseEther('0.01'),
  ]);

  try {
    await ethers.provider.call({ to: IM, data: calldata, from: signer.address });
  } catch(e: any) {
    // Get the full raw error data
    const raw = e.data || e.info?.error?.data || e.error?.data;
    console.log('Full revert data:', raw);
    console.log('Error keys:', Object.keys(e));
    if (e.info) console.log('Info:', JSON.stringify(e.info, null, 2).slice(0, 500));
  }
}
main().catch(console.error);
