import { ethers } from 'hardhat';

const ROUTER  = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';
const IM      = '0x4f4882929d46588f6Ce366Fc791d6ADD40FcaBD1';
const ORACLE  = '0x471806AA331c6D282cA13AbCcce2315E769389c5';
const LINK    = '0x779877A7B0D9E8603169DdbD7836e478b4624789';

async function main() {
  const provider = ethers.provider;
  const [signer] = await ethers.getSigners();

  // Wallet LINK balance
  const linkAbi = ['function balanceOf(address) view returns (uint256)'];
  const link = new ethers.Contract(LINK, linkAbi, provider);
  const walletLink = await link.balanceOf(signer.address);
  console.log('Wallet LINK remaining:', ethers.formatEther(walletLink));

  // Raw subscription balance (slot decode)
  const raw = await provider.call({
    to: ROUTER,
    data: '0xa47c7696' + ethers.AbiCoder.defaultAbiCoder().encode(['uint64'], [6554n]).slice(2),
  });
  const words = raw.slice(2).match(/.{64}/g) || [];
  if (words.length > 1) {
    const bal = BigInt('0x' + words[1]);
    console.log('Sub #6554 balance:', ethers.formatEther(bal), 'LINK');
  }

  // Check InvestmentManager oracle
  const imAbi = ['function oracle() view returns (address)'];
  const im = new ethers.Contract(IM, imAbi, provider);
  console.log('InvestmentManager.oracle:', await im.oracle());

  // Simulate submitProject
  const imAbi2 = [
    'function submitProject(bytes32,address,string,uint256) external returns (uint256)',
  ];
  const im2 = new ethers.Contract(IM, imAbi2, signer);
  const fakeHash = ethers.keccak256(ethers.toUtf8Bytes('demo-pitch'));
  try {
    const calldata = im2.interface.encodeFunctionData('submitProject', [
      fakeHash, signer.address, '', ethers.parseEther('0.01'),
    ]);
    await provider.call({ to: IM, data: calldata, from: signer.address });
    console.log('\n✓ submitProject simulation: PASS');
  } catch(e: any) {
    const data = e.data || e.info?.error?.data;
    if (data) {
      const sel = data.slice(0, 10);
      const errs: Record<string, string> = {
        '0xf4d678b8': 'InsufficientBalance()',
        '0x1d70f87a': 'GasLimitTooBig(uint32)',
        '0xa3cbd972': 'NotAllowedConsumer()',
        '0x00c1cfc0': 'EmptyRequestData()',
      };
      console.log('\n✗ submitProject reverts:', errs[sel] || sel);
    } else {
      console.log('\n✗ submitProject error:', e.shortMessage || e.message?.slice(0, 100));
    }
  }
}
main().catch(console.error);
