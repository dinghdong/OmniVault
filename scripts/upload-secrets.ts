/**
 * upload-secrets.ts — Upload DON-hosted secrets for Chainlink Functions
 *
 * This script encrypts ZG_API_KEY and ZG_BASE_URL with the DON's public key
 * and uploads them to the Chainlink DON. It prints the slotId and version
 * needed for OmniOracle.setSecretsConfig().
 *
 * Usage:
 *   npx hardhat run scripts/upload-secrets.ts --network sepolia
 *
 * Prerequisites:
 *   npm install @chainlink/functions-toolkit (already in package.json)
 *
 * Environment variables needed (in .env):
 *   PRIVATE_KEY     — deployer private key
 *   ZG_API_KEY      — 0G Compute API key
 *   ZG_BASE_URL     — 0G Compute base URL (optional, has default)
 *
 * Output: prints CHAINLINK_SECRETS_SLOT_ID and CHAINLINK_SECRETS_VERSION
 *         → copy these into .env before running deploy-sepolia.ts
 */

import { SecretsManager } from '@chainlink/functions-toolkit';
import { ethers } from 'hardhat';

const SEPOLIA_ROUTER  = '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0';
const SEPOLIA_DON_ID  = 'fun-ethereum-sepolia-1';
const SLOT_ID         = 0;   // Slot 0–2 available; change if you need multiple secrets versions
const EXPIRATION_MIN  = 1440; // 24 hours; max allowed by Chainlink is 4320 (3 days)

async function main() {
  const [signer] = await ethers.getSigners();
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  OmniVault — Upload DON-Hosted Secrets');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Signer  : ${signer.address}`);
  console.log(`  Network : Sepolia`);
  console.log('');

  const zgApiKey  = process.env.ZG_API_KEY;
  const zgBaseUrl = process.env.ZG_BASE_URL || 'https://router-api-testnet.integratenetwork.work/v1';

  if (!zgApiKey) {
    throw new Error('ZG_API_KEY is not set in .env');
  }

  console.log(`  0G Base URL : ${zgBaseUrl}`);
  console.log(`  0G API Key  : ${zgApiKey.slice(0, 8)}…`);
  console.log('');

  // ── Build secrets object ──────────────────────────────────────────────────
  const secrets: Record<string, string> = {
    ZG_API_KEY:  zgApiKey,
    ZG_BASE_URL: zgBaseUrl,
  };

  // ── Initialize SecretsManager ─────────────────────────────────────────────
  const secretsManager = new SecretsManager({
    signer:          signer as any,
    functionsRouterAddress: SEPOLIA_ROUTER,
    donId:           SEPOLIA_DON_ID,
  });
  await secretsManager.initialize();

  // ── Encrypt secrets ───────────────────────────────────────────────────────
  console.log('Encrypting secrets with DON public key…');
  const { encryptedSecrets } = await secretsManager.encryptSecrets(secrets);

  // ── Upload to DON ─────────────────────────────────────────────────────────
  console.log(`Uploading to DON slot ${SLOT_ID} (expiry: ${EXPIRATION_MIN} min)…`);
  const { version, success } = await secretsManager.uploadEncryptedSecretsToDON({
    encryptedSecretsHexstring: encryptedSecrets,
    gatewayUrls: [
      'https://01.functions-gateway.testnet.chain.link/',
      'https://02.functions-gateway.testnet.chain.link/',
    ],
    slotId:     SLOT_ID,
    minutesUntilExpiration: EXPIRATION_MIN,
  });

  if (!success) {
    throw new Error('DON secrets upload failed — check gateway connectivity');
  }

  console.log('\n✓ Secrets uploaded successfully!');
  console.log('');
  console.log('┌─────────────────────────────────────────────┐');
  console.log(`│  Slot ID  : ${SLOT_ID}`);
  console.log(`│  Version  : ${version}`);
  console.log('└─────────────────────────────────────────────┘');
  console.log('');
  console.log('Add these to your .env file:');
  console.log(`  CHAINLINK_SECRETS_SLOT_ID=${SLOT_ID}`);
  console.log(`  CHAINLINK_SECRETS_VERSION=${version}`);
  console.log('');
  console.log('Then call OmniOracle.setSecretsConfig() on-chain:');
  console.log(`  oracle.setSecretsConfig(${SLOT_ID}, ${version})`);
  console.log('');
  console.log('⚠  Secrets expire in 24h. Re-run this script before they expire.');
  console.log('   Or increase EXPIRATION_MIN (max: 4320 = 3 days).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
