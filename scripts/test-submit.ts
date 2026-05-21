import { ethers } from 'hardhat';

const IM_ADDR  = '0x4f4882929d46588f6Ce366Fc791d6ADD40FcaBD1';
const IM_ABI = [
  'function submitProject(bytes32 commitHash, address applicant, string calldata bizApi, uint256 requestedAmount) external returns (uint256)',
  'function oracle() view returns (address)',
  'function projectCount() view returns (uint256)',
  'function scoreThreshold() view returns (uint256)',
];

async function main() {
  const [signer] = await ethers.getSigners();
  const im = new ethers.Contract(IM_ADDR, IM_ABI, signer);

  console.log('Oracle:', await im.oracle());
  console.log('projectCount:', (await im.projectCount()).toString());
  console.log('scoreThreshold:', (await im.scoreThreshold()).toString());

  const fakeHash = ethers.keccak256(ethers.toUtf8Bytes('test'));
  const reqAmount = ethers.parseEther('0.01');

  // Use eth_call directly to get raw revert data
  console.log('\nSimulating submitProject via eth_call...');
  try {
    const calldata = im.interface.encodeFunctionData('submitProject', [fakeHash, signer.address, '', reqAmount]);
    await ethers.provider.call({ to: IM_ADDR, data: calldata, from: signer.address });
    console.log('✓ No revert');
  } catch(e: any) {
    const data = e.data || e.info?.error?.data;
    console.log('Revert data:', data);
    if (data && data.length > 10) {
      // Try to decode as GasLimitTooBig(uint32)
      const selector = data.slice(0, 10);
      console.log('Selector:', selector);
      // GasLimitTooBig = keccak256("GasLimitTooBig(uint32)")[0:4]
      console.log('GasLimitTooBig selector:', ethers.id('GasLimitTooBig(uint32)').slice(0, 10));
      console.log('InsufficientBalance selector:', ethers.id('InsufficientBalance()').slice(0, 10));
      console.log('NotAllowedConsumer selector:', ethers.id('NotAllowedConsumer()').slice(0, 10));

      if (data.length > 10) {
        const val = BigInt('0x' + data.slice(10).padEnd(64, '0').slice(0, 64));
        console.log('First param:', val.toString(), '(0x' + val.toString(16) + ')');
      }
    }
    console.log('Short message:', e.shortMessage || e.message?.slice(0, 200));
  }
}
main().catch(console.error);
