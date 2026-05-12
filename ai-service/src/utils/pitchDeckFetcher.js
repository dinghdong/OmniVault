import axios from 'axios';
import { createRequire } from 'module';
import { logger } from '../logger.js';

const require = createRequire(import.meta.url);

const MAX_TEXT_LENGTH = 12000; // chars sent to LLM (~3k tokens)
const FETCH_TIMEOUT_MS = 20000;

/**
 * Normalise common sharing URLs to direct-download form where possible.
 */
function resolveDownloadUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    // Google Drive: /file/d/{id}/view → /uc?export=download&id={id}
    const driveMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
    if (url.hostname.includes('drive.google.com') && driveMatch) {
      return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
    }

    // Dropbox: ?dl=0 → ?dl=1
    if (url.hostname.includes('dropbox.com')) {
      url.searchParams.set('dl', '1');
      return url.toString();
    }

    // IPFS gateway pass-through
    if (url.hostname.includes('ipfs.io') || url.hostname.includes('cloudflare-ipfs.com')) {
      return rawUrl;
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * Strip HTML tags and collapse whitespace.
 */
function extractTextFromHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Parse PDF buffer → plain text using pdf-parse (CJS compat via createRequire).
 */
async function parsePdf(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (err) {
    logger.warn('pitchDeckFetcher: pdf-parse failed', { error: err.message });
    return '';
  }
}

/**
 * Fetch a pitch deck URL and return extracted plain text.
 * Returns an object: { text, contentType, url, fetchedAt, truncated }
 */
export async function fetchPitchDeck(rawUrl) {
  if (!rawUrl) {
    return { text: '', contentType: 'none', url: rawUrl, fetchedAt: new Date().toISOString(), truncated: false };
  }

  const downloadUrl = resolveDownloadUrl(rawUrl);

  try {
    const response = await axios.get(downloadUrl, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: 20 * 1024 * 1024, // 20 MB cap
      headers: {
        'User-Agent': 'OmniVault-AuditBot/1.0',
        'Accept': 'application/pdf,text/html,text/plain,*/*',
      },
    });

    const contentType = response.headers['content-type'] || '';
    const buffer = Buffer.from(response.data);

    let text = '';

    if (contentType.includes('pdf') || downloadUrl.toLowerCase().includes('.pdf')) {
      text = await parsePdf(buffer);
    } else if (contentType.includes('html')) {
      text = extractTextFromHtml(buffer.toString('utf-8'));
    } else {
      // Plain text, Markdown, or unknown
      text = buffer.toString('utf-8');
    }

    const truncated = text.length > MAX_TEXT_LENGTH;
    const finalText = text.slice(0, MAX_TEXT_LENGTH);

    logger.info('pitchDeckFetcher: Fetched deck', {
      url: rawUrl,
      contentType,
      chars: finalText.length,
      truncated,
    });

    return {
      text: finalText,
      contentType,
      url: rawUrl,
      fetchedAt: new Date().toISOString(),
      truncated,
    };

  } catch (err) {
    logger.warn('pitchDeckFetcher: Could not fetch deck', { url: rawUrl, error: err.message });
    return {
      text: '',
      contentType: 'error',
      url: rawUrl,
      fetchedAt: new Date().toISOString(),
      truncated: false,
      error: err.message,
    };
  }
}
