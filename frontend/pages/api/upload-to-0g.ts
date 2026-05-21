/**
 * POST /api/upload-to-0g
 *
 * Uploads a pitch deck to 0G Storage and returns the Merkle root hash.
 * The root hash is used as the on-chain `commitHash` in submitProject().
 *
 * Request body (JSON):
 *   { data: string (base64), name: string }
 *
 * Response:
 *   { rootHash: `0x${string}`, uploaded: boolean, txHash?: string, error?: string }
 *
 * Environment variables (optional — rootHash computed even without them):
 *   ZG_RPC_URL      — 0G blockchain RPC  (e.g. https://evmrpc-testnet.0g.ai)
 *   ZG_INDEXER_URL  — storage indexer    (default: testnet standard)
 *   ZG_PRIVATE_KEY  — funded wallet for 0G storage fees
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb', // pitch decks can be large
    },
  },
};

const DEFAULT_INDEXER = 'https://indexer-storage-testnet-standard.0g.ai';
const DEFAULT_ZG_RPC  = 'https://evmrpc-testnet.0g.ai';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data, name } = req.body ?? {};
  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "data" (base64 string)' });
  }
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing "name"' });
  }

  const tmpPath = join(tmpdir(), `${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);

  try {
    // 1. Write temp file
    const buffer = Buffer.from(data, 'base64');
    await writeFile(tmpPath, buffer);

    // 2. Import 0G SDK (server-side only)
    const { ZgFile, Indexer } = await import('@0glabs/0g-ts-sdk' as any);

    // 3. Compute 0G Merkle root
    const zgFile = await ZgFile.fromFilePath(tmpPath);
    const [tree, treeErr] = await zgFile.merkleTree();
    if (treeErr || !tree) {
      await zgFile.close?.();
      return res.status(500).json({ error: `Merkle tree computation failed: ${treeErr}` });
    }

    const rootHash: string = tree.rootHash();
    if (!rootHash) {
      await zgFile.close?.();
      return res.status(500).json({ error: 'Empty Merkle root hash' });
    }

    // 4. Attempt actual 0G Storage upload (requires funded wallet)
    let uploaded = false;
    let txHash: string | undefined;

    const zgPrivKey  = process.env.ZG_PRIVATE_KEY;
    const zgRpc      = process.env.ZG_RPC_URL  ?? DEFAULT_ZG_RPC;
    const zgIndexer  = process.env.ZG_INDEXER_URL ?? DEFAULT_INDEXER;

    if (zgPrivKey) {
      try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(zgRpc);
        const signer   = new ethers.Wallet(zgPrivKey, provider);
        const indexer  = new Indexer(zgIndexer);

        const [result, uploadErr] = await indexer.upload(zgFile, zgRpc, signer);
        if (!uploadErr && result?.txHash) {
          uploaded = true;
          txHash   = result.txHash;
        } else if (uploadErr) {
          console.warn('[upload-to-0g] Upload failed (continuing with rootHash):', uploadErr);
        }
      } catch (uploadEx: any) {
        console.warn('[upload-to-0g] Upload exception (continuing with rootHash):', uploadEx?.message);
      }
    }

    await zgFile.close?.();
    return res.status(200).json({ rootHash, uploaded, txHash });
  } catch (err: any) {
    console.error('[upload-to-0g] Unhandled error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  } finally {
    // Always clean up temp file
    try { await unlink(tmpPath); } catch { /* ignore */ }
  }
}
