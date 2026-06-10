/**
 * deploy-stylus.ts
 *
 * Deploys the ScoringEngine Stylus (Rust/Wasm) contract to Arbitrum Sepolia.
 *
 * Stylus deployment flow:
 *   1. Wrap Wasm bytecode in init-code and send as a contract-creation tx.
 *   2. Call ArbWasm.activateProgram(address) on the deployed contract.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-stylus.ts --network arbitrumSepolia
 */

import { ethers } from 'hardhat';
import { readFileSync, writeFileSync, readFileSync as rfs, existsSync } from 'fs';
import { join } from 'path';

// ArbWasm precompile — fixed address on all Arbitrum chains
const ARB_WASM_ADDRESS = '0x0000000000000000000000000000000000000071';

// ABI: only the function we need
const ARB_WASM_ABI = [
  'function activateProgram(address program) external payable returns (uint16 version, uint256 dataFee)',
  'function programVersion(address program) external view returns (uint16 version)',
];

// Path to the compiled Wasm binary
const WASM_PATH = join(
  __dirname,
  '../stylus/scoring-engine/target/wasm32-unknown-unknown/release/scoring_engine.wasm',
);

// (buildInitCode removed — initcode is now inlined in main())

async function main() {
  const [signer] = await ethers.getSigners();
  console.log('Deployer:', signer.address);

  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 421614) {
    throw new Error(`Wrong network: expected Arbitrum Sepolia (421614), got ${network.chainId}`);
  }
  console.log('Network: Arbitrum Sepolia (421614)');
  console.log('');

  // ── 1. Read Wasm binary ───────────────────────────────────────────────────
  if (!existsSync(WASM_PATH)) {
    throw new Error(
      `Wasm not found: ${WASM_PATH}\n` +
      `Run: cd stylus/scoring-engine && cargo build --release --target wasm32-unknown-unknown`,
    );
  }
  const wasmBytes = readFileSync(WASM_PATH);
  console.log(`Wasm size: ${wasmBytes.length} bytes (${(wasmBytes.length / 1024).toFixed(1)} KB)`);

  // ── 2. Brotli-compress Wasm and build deployment payload ─────────────────
  //
  // Arbitrum Stylus deployment format (EIP-3541 magic + Brotli-compressed Wasm):
  //   runtime bytecode = [0xEF, 0x00] + brotli_compress(wasm)
  //
  // The 0xEF 0x00 prefix (EIP-3541) marks this as a Stylus program.
  // ArbOS recognises it, stores it as-is, and activateProgram() decompresses
  // + validates it when called.
  //
  // The initcode stores this compressed payload as the runtime code.
  // EIP-170 24 KB limit doesn't apply to 0xEF-prefixed bytecode on Arbitrum.

  const { brotliCompressSync, constants: zlibConst } = require('zlib');
  const compressed: Buffer = brotliCompressSync(wasmBytes, {
    params: {
      [zlibConst.BROTLI_PARAM_QUALITY]: 11,
      [zlibConst.BROTLI_PARAM_LGWIN]:   24,
    },
  });
  console.log(`  Raw Wasm: ${wasmBytes.length} bytes → Brotli: ${compressed.length} bytes`);

  // Arbitrum Nitro recognizes Brotli-compressed Wasm by decompressing and checking
  // for the Wasm magic bytes (\x00asm). No EF prefix needed (EF prefix is blocked
  // by EIP-3541 in standard EVM; Nitro handles the compression-prefix internally).
  const runtimeCode = compressed;
  console.log(`  Runtime code: ${runtimeCode.length} bytes (${(runtimeCode.length / 1024).toFixed(1)} KB)`);

  // Build 14-byte initcode that copies runtimeCode to memory and RETURNs it:
  //   PUSH4 <rLen>  DUP1  PUSH1 0x0e  PUSH1 0x00  CODECOPY  PUSH1 0x00  RETURN
  const rLen = runtimeCode.length;
  const initcodeHdr = Buffer.from([
    0x63, (rLen>>>24)&0xff, (rLen>>>16)&0xff, (rLen>>>8)&0xff, rLen&0xff,
    0x80,
    0x60, 0x0e,
    0x60, 0x00,
    0x39,
    0x60, 0x00,
    0xf3,
  ]);

  // ── 2. Deploy Wasm as a contract ──────────────────────────────────────────
  console.log('\n1. Deploying Stylus program…');
  const deployData = Buffer.concat([initcodeHdr, runtimeCode]);

  const deployTx = await signer.sendTransaction({
    data: '0x' + deployData.toString('hex'),
    // Compressed runtime is ~13KB; gas cost is modest (no EIP-170 penalty for 0xEF).
    gasLimit: 5_000_000n,
  });
  console.log('  tx:', deployTx.hash);
  const deployReceipt = await deployTx.wait();
  if (!deployReceipt?.contractAddress) {
    throw new Error('Deployment failed — no contract address in receipt');
  }
  const contractAddress = deployReceipt.contractAddress;
  console.log('  ✓ Deployed at:', contractAddress);

  // ── 3. Activate via ArbWasm precompile ────────────────────────────────────
  console.log('\n2. Activating Stylus program via ArbWasm precompile…');
  const arbWasm = new ethers.Contract(ARB_WASM_ADDRESS, ARB_WASM_ABI, signer);

  // Estimate activation data fee first
  let dataFee = BigInt(0);
  try {
    const [, estimatedFee] = await arbWasm.activateProgram.staticCall(contractAddress, {
      value: ethers.parseEther('0.01'), // cover data fee estimate
    });
    dataFee = estimatedFee;
    console.log('  Estimated data fee:', ethers.formatEther(dataFee), 'ETH');
  } catch (e) {
    console.log('  Note: fee estimation failed, using 0.005 ETH as fallback');
    dataFee = ethers.parseEther('0.005');
  }

  const activateTx = await arbWasm.activateProgram(contractAddress, {
    value: dataFee * BigInt(120) / BigInt(100), // +20% buffer
  });
  console.log('  tx:', activateTx.hash);
  const activateReceipt = await activateTx.wait();
  console.log('  ✓ Activation tx mined (gas used:', activateReceipt?.gasUsed.toString(), ')');

  // Verify version
  const version = await arbWasm.programVersion(contractAddress);
  console.log('  ✓ Stylus program version:', version.toString());

  // ── 4. Update .env.local ──────────────────────────────────────────────────
  const envPath = join(__dirname, '../frontend/.env.local');
  let env = readFileSync(envPath, 'utf-8');
  if (env.includes('NEXT_PUBLIC_SCORING_ENGINE_ADDRESS')) {
    env = env.replace(/^NEXT_PUBLIC_SCORING_ENGINE_ADDRESS=.*/m,
      `NEXT_PUBLIC_SCORING_ENGINE_ADDRESS=${contractAddress}`);
  } else {
    env += `\nNEXT_PUBLIC_SCORING_ENGINE_ADDRESS=${contractAddress}\n`;
  }
  writeFileSync(envPath, env);
  console.log('\n3. Updated frontend/.env.local');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════');
  console.log('✅  ScoringEngine deployed and activated!');
  console.log('');
  console.log('Address:', contractAddress);
  console.log('Explorer:', `https://sepolia.arbiscan.io/address/${contractAddress}`);
  console.log('Wasm size:', `${wasmBytes.length} bytes`);
  console.log('Stylus version:', version.toString());
  console.log('════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
