/**
 * Layer 3: pitchDeckFetcher standalone test (no OpenAI cost)
 * Usage: node scripts/test-fetcher.js <url>
 *
 * Tests URL resolution, fetching, and text extraction.
 * Works with PDF, HTML, plain text, Google Drive, Dropbox links.
 */
import 'dotenv/config';
import { fetchPitchDeck } from '../src/utils/pitchDeckFetcher.js';

const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const CYAN  = '\x1b[36m';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.log(`${BOLD}Usage:${RESET} node scripts/test-fetcher.js <url>`);
    console.log('\nExample URLs to try:');
    console.log('  https://www.w3.org/WAI/WCAG21/wcag21.pdf');
    console.log('  https://example.com');
    console.log('  https://drive.google.com/file/d/YOUR_FILE_ID/view');
    process.exit(0);
  }

  console.log(`\n${BOLD}pitchDeckFetcher Test${RESET}`);
  console.log(`URL: ${url}\n`);

  const t0 = Date.now();
  const result = await fetchPitchDeck(url);
  const ms = Date.now() - t0;

  if (result.error) {
    console.log(`${RED}✗ Fetch failed: ${result.error}${RESET}`);
  } else {
    console.log(`${GREEN}✓ Fetch succeeded${RESET}`);
  }

  console.log(`  Content-Type : ${result.contentType}`);
  console.log(`  Chars fetched: ${result.text.length}`);
  console.log(`  Truncated    : ${result.truncated}`);
  console.log(`  Time         : ${ms}ms`);

  if (result.text.length > 0) {
    console.log(`\n${BOLD}${CYAN}── First 500 chars ──${RESET}`);
    console.log(result.text.slice(0, 500));
    console.log(`${CYAN}──────────────────────${RESET}`);
  }
}

main();
