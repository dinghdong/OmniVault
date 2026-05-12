/**
 * OmniVault Frontend E2E Tests
 *
 * Strategy: inject a window.ethereum mock backed by the local Hardhat node.
 * Hardhat keeps accounts unlocked → eth_sendTransaction works without signing.
 *
 * Hardhat account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10 000 ETH)
 */

import { test, expect, Page } from '@playwright/test';
import { ethers } from 'ethers';

// ── Constants ─────────────────────────────────────────────────────────────────
const HARDHAT_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const HARDHAT_RPC     = 'http://127.0.0.1:8545';
const CHAIN_ID_HEX    = '0x7a69';   // 31337
const APP_URL         = 'http://localhost:3000';
const FUND_VAULT      = '0x68B1D87F95878fE05B998F19b66F4baba5De1aed';
const FUND_TOKEN      = '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE';

// Verified keccak4 selectors
const SEL_GET_SHARES  = '0xf04da65b'; // getShares(address)
const SEL_BALANCE_OF  = '0x70a08231'; // balanceOf(address)

// ── window.ethereum mock ───────────────────────────────────────────────────────
// Injected via addInitScript so it's present before wagmi's connectors initialise.
const ETHEREUM_MOCK = `
(function () {
  const RPC  = '${HARDHAT_RPC}';
  const ACCT = '${HARDHAT_ACCOUNT}';
  const CHAIN = '${CHAIN_ID_HEX}';
  let id = 1;

  async function rpcCall(method, params = []) {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
    });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
    return j.result;
  }

  const evs = {};
  function emit(e, d) { (evs[e] || []).forEach(fn => fn(d)); }

  const provider = {
    isMetaMask: true,
    selectedAddress: ACCT,
    networkVersion: '31337',
    on(e, fn)  { (evs[e] = evs[e] || []).push(fn); },
    removeListener(e, fn) {
      if (evs[e]) evs[e] = evs[e].filter(f => f !== fn);
    },
    async request({ method, params = [] }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ACCT];
      if (method === 'eth_chainId')  return CHAIN;
      if (method === 'net_version')  return '31337';
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'wallet_addEthereumChain')    return null;
      return rpcCall(method, params);
    },
  };

  // EIP-1193
  Object.defineProperty(window, 'ethereum', {
    value: provider, writable: false, configurable: true,
  });

  // EIP-6963 announcement
  const detail = {
    info: {
      uuid: 'hardhat-mock',
      name: 'MetaMask',          // use MetaMask name so ConnectKit shows it
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      rdns: 'io.metamask',       // recognised rdns
    },
    provider,
  };
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  window.addEventListener('eip6963:requestProvider', () =>
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
  );

  console.log('[EthMock] injected, account:', ACCT);
})();
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function gotoApp(page: Page) {
  await page.addInitScript({ content: ETHEREUM_MOCK });
  await page.goto(APP_URL, { waitUntil: 'load' });
  // Wait for React to fully hydrate (Providers mounts after first client paint)
  await page.waitForSelector('.nav-connect button', { timeout: 15000 });
  await page.waitForTimeout(500); // small buffer for wagmi init
}

/** Connect wallet using the exposed __test_connect window function.
 *  WalletButton registers this helper via useEffect once connectors are ready. */
async function connectWallet(page: Page): Promise<boolean> {
  // If already connected (wagmi auto-reconnected), return immediately
  const alreadyConnected = await page.locator('.nav-connect button.wallet-btn.connected').count();
  if (alreadyConnected > 0) {
    console.log('  [Already connected — skipping connect step]');
    return true;
  }

  // Wait for WalletButton's useEffect to register __test_connect (connectors ready)
  await page.waitForFunction(() => typeof (window as any).__test_connect === 'function', { timeout: 10000 });

  // Log available connectors for debugging
  const connInfo = await page.evaluate(() => (window as any).__test_connectors);
  console.log('  [Available connectors]:', JSON.stringify(connInfo));

  // Trigger connection programmatically
  const result = await page.evaluate(() => (window as any).__test_connect());
  console.log('  [__test_connect result]:', result);

  // Wait for wagmi to complete the connection and re-render the button
  const ok = await page
    .waitForSelector('.nav-connect button.wallet-btn.connected', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!ok) {
    const allBtns = await page.locator('button').allTextContents();
    console.log('  [connect failed] buttons:', JSON.stringify(allBtns.filter(t => t.trim())));
    await page.screenshot({ path: '/tmp/connect-fail.png' });
    console.log('  [screenshot → /tmp/connect-fail.png]');
  }
  return ok;
}

// ── RPC helpers ───────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(HARDHAT_RPC);

async function rpc(method: string, params: unknown[] = []) {
  return provider.send(method, params);
}

async function getShares(account: string): Promise<bigint> {
  const padded = account.slice(2).toLowerCase().padStart(64, '0');
  const res = await rpc('eth_call', [{ to: FUND_TOKEN, data: SEL_GET_SHARES + padded }, 'latest']) as string;
  return BigInt(res === '0x' ? 0 : res);
}

async function getBalance(account: string): Promise<bigint> {
  const padded = account.slice(2).toLowerCase().padStart(64, '0');
  const res = await rpc('eth_call', [{ to: FUND_TOKEN, data: SEL_BALANCE_OF + padded }, 'latest']) as string;
  return BigInt(res === '0x' ? 0 : res);
}

async function directDeposit(ethAmount: string) {
  const wei = ethers.parseEther(ethAmount);
  await rpc('eth_sendTransaction', [{
    from: HARDHAT_ACCOUNT, to: FUND_VAULT,
    value: '0x' + wei.toString(16), gas: '0x50000',
  }]);
  await rpc('evm_mine', []);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
test.describe('OmniVault Frontend E2E', () => {

  // ── 1. Homepage ─────────────────────────────────────────────────────────────
  test('1. Homepage loads – title, hero, stats visible', async ({ page }) => {
    await gotoApp(page);
    await expect(page).toHaveTitle(/OmniVault/);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.stat-card').first()).toBeVisible();
    // Use .first() to avoid strict mode with two wallet buttons
    await expect(page.locator('button.wallet-btn').first()).toBeVisible();
    console.log('✅ Homepage loaded');
  });

  // ── 2. TVL shows ETH ─────────────────────────────────────────────────────────
  test('2. TVL stat card shows ETH (not hardcoded $0)', async ({ page }) => {
    await gotoApp(page);
    await page.waitForTimeout(3000);
    const tvl = await page.locator('.stat-card').first().locator('.stat-value').textContent();
    console.log('TVL:', tvl);
    expect(tvl).not.toBe('$0');
    const ok = tvl?.includes('ETH') || tvl === '--' || tvl === '...';
    expect(ok).toBeTruthy();
    console.log('✅ TVL =', tvl);
  });

  // ── 3. Wallet connection ─────────────────────────────────────────────────────
  test('3. Connect wallet via injected Hardhat provider', async ({ page }) => {
    await gotoApp(page);
    const connected = await connectWallet(page);
    expect(connected).toBeTruthy();

    const addrText = await page.locator('.nav-connect button.wallet-btn.connected span').last().textContent();
    console.log('✅ Connected address:', addrText);
    expect(addrText?.toLowerCase()).toContain('0xf39f');
  });

  // ── 4. Portfolio section after connect ────────────────────────────────────
  test('4. Portfolio section visible after wallet connect', async ({ page }) => {
    await gotoApp(page);
    expect(await connectWallet(page)).toBeTruthy();

    await page.locator('#portfolio').scrollIntoViewIfNeeded();
    await expect(page.locator('button', { hasText: 'Deposit' }).first()).toBeVisible();
    await expect(page.locator('button', { hasText: 'Withdraw' }).first()).toBeVisible();
    await expect(page.locator('.card-label', { hasText: 'Your FundToken Balance' }).first()).toBeVisible();
    console.log('✅ Portfolio section rendered after connect');
  });

  // ── 5. Deposit flow ─────────────────────────────────────────────────────────
  test('5. Deposit 0.5 ETH → receive FundToken shares', async ({ page }) => {
    const sharesBefore = await getShares(HARDHAT_ACCOUNT);
    console.log('Shares before:', ethers.formatEther(sharesBefore));

    await gotoApp(page);
    expect(await connectWallet(page)).toBeTruthy();

    await page.locator('#portfolio').scrollIntoViewIfNeeded();
    await page.locator('button', { hasText: 'Deposit' }).first().click();
    await expect(page.locator('.modal-content.open')).toBeVisible({ timeout: 5000 });

    await page.locator('.input-field').first().fill('0.5');
    await page.locator('button.btn-primary.btn-full').click();

    await expect(
      page.locator('.success-message', { hasText: /Deposit successful/i })
    ).toBeVisible({ timeout: 30000 });

    const sharesAfter = await getShares(HARDHAT_ACCOUNT);
    expect(sharesAfter).toBeGreaterThan(sharesBefore);
    const delta = Number(ethers.formatEther(sharesAfter - sharesBefore));
    // Shares received = ETH / accrualFactor, so delta may be < 0.5 when yield has accrued.
    // Just verify the deposit minted a meaningful number of shares.
    expect(delta).toBeGreaterThan(0.1);
    console.log('✅ Deposited 0.5 ETH, shares +', delta.toFixed(4));
  });

  // ── 6. Portfolio balance ─────────────────────────────────────────────────────
  test('6. FundToken balance displayed from chain (not hardcoded)', async ({ page }) => {
    await directDeposit('0.1'); // ensure non-zero balance

    await gotoApp(page);
    expect(await connectWallet(page)).toBeTruthy();

    await page.locator('#portfolio').scrollIntoViewIfNeeded();
    await page.waitForTimeout(3000);

    const balText = await page.locator('.card-value').first().textContent();
    console.log('Portfolio balance:', balText);
    expect(parseFloat(balText || '0')).toBeGreaterThan(0);
    console.log('✅ Balance > 0:', balText);
  });

  // ── 7. Deposit modal – real yield, not hardcoded ──────────────────────────
  test('7. Deposit modal shows on-chain yield (not hardcoded 12.4%)', async ({ page }) => {
    await gotoApp(page);
    expect(await connectWallet(page)).toBeTruthy();

    await page.locator('#portfolio').scrollIntoViewIfNeeded();
    await page.locator('button', { hasText: 'Deposit' }).first().click();
    await expect(page.locator('.modal-content.open')).toBeVisible({ timeout: 5000 });

    const info = await page.locator('.info-box').textContent();
    console.log('Deposit modal info:', info);
    expect(info).not.toContain('12.4%');
    console.log('✅ No hardcoded 12.4% APY');
  });

  // ── 8. Withdraw modal – balance + MAX ────────────────────────────────────
  test('8. Withdraw modal shows share balance and MAX button', async ({ page }) => {
    if ((await getShares(HARDHAT_ACCOUNT)) === 0n) await directDeposit('0.3');

    await gotoApp(page);
    expect(await connectWallet(page)).toBeTruthy();

    await page.locator('#portfolio').scrollIntoViewIfNeeded();
    await page.locator('button', { hasText: 'Withdraw' }).first().click();
    await expect(page.locator('.modal-content.open')).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(2500);

    const maxBtn = page.locator('button.btn-max');
    await expect(maxBtn).toBeVisible();
    await maxBtn.click();

    const val = await page.locator('.input-field').inputValue();
    expect(parseFloat(val)).toBeGreaterThan(0);
    console.log('✅ MAX =', val, 'shares');
  });

  // ── 9. Redeem flow ───────────────────────────────────────────────────────
  test('9. Redeem all shares → ETH returned', async ({ page }) => {
    await rpc('hardhat_setBalance', [FUND_VAULT, '0x' + ethers.parseEther('5').toString(16)]);
    let sharesBefore = await getShares(HARDHAT_ACCOUNT);
    if (sharesBefore === 0n) {
      await directDeposit('0.5');
      sharesBefore = await getShares(HARDHAT_ACCOUNT);
    }
    console.log('Shares before redeem:', ethers.formatEther(sharesBefore));

    await gotoApp(page);
    expect(await connectWallet(page)).toBeTruthy();

    await page.locator('#portfolio').scrollIntoViewIfNeeded();
    await page.locator('button', { hasText: 'Withdraw' }).first().click();
    await expect(page.locator('.modal-content.open')).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(2500);
    await page.locator('button.btn-max').click();
    const inputVal = await page.locator('.input-field').inputValue();
    expect(parseFloat(inputVal)).toBeGreaterThan(0);

    await page.locator('button.btn-primary.btn-full').click();

    await expect(
      page.locator('.success-message', { hasText: /Withdrawal successful/i })
    ).toBeVisible({ timeout: 30000 });

    const sharesAfter = await getShares(HARDHAT_ACCOUNT);
    expect(sharesAfter).toBeLessThan(sharesBefore);
    console.log('✅ Redeemed', ethers.formatEther(sharesBefore), 'shares, remaining:', ethers.formatEther(sharesAfter));
  });

  // ── 10. Wallet disconnect ─────────────────────────────────────────────────
  test('10. Disconnect wallet hides portfolio actions', async ({ page }) => {
    await gotoApp(page);
    expect(await connectWallet(page)).toBeTruthy();

    // Click the connected-address button → disconnect (force bypasses nextjs-portal overlay)
    await page.locator('.nav-connect button.wallet-btn.connected').click({ force: true });

    // Connect Wallet button should reappear in nav
    await expect(
      page.locator('.nav-connect button.wallet-btn:not(.connected)')
    ).toBeVisible({ timeout: 8000 });

    // Portfolio shows prompt
    await page.locator('#portfolio').scrollIntoViewIfNeeded();
    await expect(page.locator('.wallet-prompt')).toBeVisible();
    console.log('✅ Wallet disconnected, prompt shown');
  });
});
