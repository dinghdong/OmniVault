/**
 * zgStorage.js — 0G Storage upload wrapper
 *
 * Uploads audit report data to 0G decentralised storage.
 * Returns the Merkle root hash (bytes32) to be committed on-chain as
 * the `reasoningHash` argument of AgentVoting.agentVote().
 *
 * Falls back to a local SHA-256 hash if:
 *   • The SDK is not installed
 *   • ZG_STORAGE_PRIVATE_KEY is not configured
 *   • The upload fails for any reason
 *
 * This lets the rest of the system run without 0G credentials during
 * local development, while producing a real 0G root hash in production.
 */

import { createHash } from 'crypto';
import { ethers } from 'ethers';
import { logger } from '../logger.js';

const ZG_EVM_RPC     = process.env.ZG_EVM_RPC     || 'https://evmrpc-testnet.0g.ai';
const ZG_INDEXER_RPC = process.env.ZG_INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai';

// Singleton SDK reference — loaded once, cached
let _sdk = null;

async function _loadSdk() {
  if (_sdk !== null) return _sdk;
  try {
    _sdk = await import('@0gfoundation/0g-storage-ts-sdk');
    logger.info('zgStorage: 0G Storage SDK loaded');
  } catch (err) {
    _sdk = false;
    logger.warn('zgStorage: SDK not available — using local hash fallback', { error: err.message });
  }
  return _sdk;
}

/**
 * Build a 0G-signer from ZG_STORAGE_PRIVATE_KEY env var.
 * Returns null if the key is absent (triggers fallback).
 */
function _buildZgSigner() {
  const key = process.env.ZG_STORAGE_PRIVATE_KEY;
  if (!key) return null;
  try {
    const provider = new ethers.JsonRpcProvider(ZG_EVM_RPC);
    return new ethers.Wallet(key, provider);
  } catch (err) {
    logger.warn('zgStorage: Could not create 0G signer', { error: err.message });
    return null;
  }
}

/**
 * Convert any raw root hash string to a padded bytes32 hex string.
 * Handles both "0x..." and plain hex strings.
 */
function _toBytes32(raw) {
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  return '0x' + hex.padEnd(64, '0').slice(0, 64);
}

/**
 * Local SHA-256 fallback hash (bytes32 format).
 */
function _localHash(buf) {
  return '0x' + createHash('sha256').update(buf).digest('hex');
}

/**
 * Upload data to 0G Storage.
 *
 * @param {object|string|Buffer} data - Content to store.
 * @param {string} label             - Human-readable label for logs.
 * @returns {{ hash: string, stored: boolean }}
 *   hash   — bytes32 root hash (0G Merkle root, or SHA-256 fallback)
 *   stored — true if successfully stored on 0G network
 */
export async function uploadToZeroG(data, label = 'data') {
  const buf = Buffer.isBuffer(data)
    ? data
    : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');

  const fallback = { hash: _localHash(buf), stored: false };

  // ── 1. Load SDK ──────────────────────────────────────────────────────────
  const sdk = await _loadSdk();
  if (!sdk) return fallback;

  // ── 2. Build signer ──────────────────────────────────────────────────────
  const signer = _buildZgSigner();
  if (!signer) {
    logger.warn('zgStorage: ZG_STORAGE_PRIVATE_KEY not set — using local hash', { label });
    return fallback;
  }

  // ── 3. Upload ─────────────────────────────────────────────────────────────
  try {
    const { MemData, Indexer } = sdk;

    const file = new MemData(buf);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr) throw new Error(`merkleTree: ${treeErr}`);

    const rootHash = _toBytes32(tree.rootHash());

    logger.info('zgStorage: Uploading to 0G Storage', { label, bytes: buf.length, rootHash });

    const indexer = new Indexer([ZG_INDEXER_RPC]);
    const [, uploadErr] = await indexer.upload(file, ZG_EVM_RPC, signer);
    if (uploadErr) throw new Error(`upload: ${uploadErr}`);

    logger.info('zgStorage: Upload successful', { label, rootHash });
    return { hash: rootHash, stored: true };

  } catch (err) {
    logger.error('zgStorage: Upload failed — using local hash fallback', {
      label,
      error: err.message,
    });
    return fallback;
  }
}
