# OmniVault Demo Script
## 0G APAC Hackathon · May 2026 · Target runtime: 3–4 minutes

---

### Pre-recording setup checklist

- [ ] AI service running: `cd ai-service && node src/server.js`
- [ ] Frontend running: `cd frontend && npm run dev`
- [ ] MetaMask on **0G Galileo Testnet** (chainId 16602) with test OG tokens
- [ ] At least one project already submitted and audited (status Active) for the vesting demo
- [ ] Terminal visible in split screen for AI service logs
- [ ] Resolution: 1920×1080, browser at 100% zoom

---

## Scene 1 — Problem Statement (0:00–0:25)

**Narration (voice-over):**
> "Traditional venture capital is opaque, gatekept, and slow. Web3 needs a VC that is transparent, autonomous, and always on.
> Introducing OmniVault — the first decentralized VC fund where three AI agents debate every investment decision, every audit is stored immutably on 0G, and LP capital earns yield while it waits."

**Screen:** Show the OmniVault landing page. Pan down through the hero, stats, and features section.

---

## Scene 2 — LP Deposits ETH (0:25–0:55)

**Action:**
1. Click **"Start Investing"** → scrolls to portfolio section
2. Click **Deposit** button → DepositModal opens
3. Enter `0.01` ETH, click **Deposit ETH**
4. MetaMask confirmation pops up → approve

**Narration:**
> "LPs deposit ETH. The vault wraps it to WETH and supplies it to AAVE V3 — generating yield from the moment of deposit. In return, LPs receive FundToken (OVFT), a rebasing share token whose balance grows automatically as yield accrues."

**Screen:** Show the transaction confirming and the FundToken balance updating in the portfolio card.

---

## Scene 3 — Project Application (0:55–1:30)

**Action:**
1. Scroll down to **"Apply for Funding"** section
2. Fill in the form:
   - Commit Hash: paste any 32-byte hex
   - Contract Address: a valid EVM address
   - Business API: `https://example-project.xyz/api`
   - Requested Amount: `0.005` ETH
3. Click **Submit Application** → MetaMask → confirm

**Narration:**
> "A project team applies for funding. They submit their code commit hash, deployed contract address, and API endpoint. The requested amount is locked into the proposal — no negotiation, no phone calls."

**Screen:** Show the transaction confirming and the project appearing in the **AI Audit Pipeline** section with status `Pending`.

---

## Scene 4 — AI Debate (1:30–2:10)

**Screen split:** Browser left | Terminal (AI service logs) right

**Action:**
1. Watch terminal logs as `onChainListener` picks up the `ProjectSubmitted` event
2. Show logs: `DebateOrchestrator: Round 1 — parallel analysis`
3. Show logs: `Round 2 — cross-peer review`
4. Show logs: `Round 3 — final synthesis | score: 7800`
5. Show logs: `0G Storage upload: debate-r3-1 | root: 0x...`
6. Show logs: `Agent 1/2/3 voted on-chain`

**Narration:**
> "Three AI agents spring into action. Code Analysis, Risk Assessment, and Business Analysis each audit the project independently. Then they read each other's findings and debate — two more rounds of cross-review and synthesis. Every round is uploaded to 0G Storage for permanent, verifiable records."

**Screen (browser):** Refresh the pipeline section. Show the project card updating:
- Status badge changes to `Auditing` → `PendingExecution`
- Agent vote dots filling in (1/3 → 2/3 → 3/3)
- "Quorum Reached" badge appears
- Community veto countdown starts (48 h)

---

## Scene 5 — 0G Storage Proof (2:10–2:25)

**Screen:** Zoom into the project card's **"0G Storage proof"** row showing the truncated Merkle hash.

**Narration:**
> "The Merkle root of the final audit report is recorded on-chain. Anyone can verify the full report on 0G Storage — the AI's reasoning is public, permanent, and tamper-proof."

---

## Scene 6 — Community Veto Window (2:25–2:40)

**Screen:** Show the countdown timer on a PendingExecution project card.

**Narration:**
> "After AI consensus, LP holders get a 48-hour veto window. Any LP can call veto — a human safety net over the AI's decision. If the community stays silent, the investment executes automatically."

---

## Scene 7 — Vesting & Claim Payout (2:40–3:10)

**Action:**
1. Switch MetaMask to the applicant wallet
2. Scroll to the Active project card — the **Vesting Schedule** panel appears
3. Show: `42.3% vested`, progress bar, `Claimable: 0.0032 OG`
4. Click **Claim 0.0032 OG** → MetaMask → confirm
5. Watch "Claimed ✓" confirmation and Released amount update

**Narration:**
> "Approved projects receive 20% of their investment immediately. The remaining 80% vests linearly over 52 weeks. Applicants connect their wallet and claim their vested tranche anytime — no middle-men, no invoices, just smart contract math."

---

## Scene 8 — LP Dashboard (3:10–3:30)

**Action:**
1. Switch MetaMask back to LP wallet
2. Show the **LP Dashboard** cards: Holdings, TVL, Deployed Capital, Alerts
3. Pan across the sparkline and health bar

**Narration:**
> "LPs get a real-time view of their portfolio: compound yield over time, pool share percentage, and the health of every funded project. If a project triggers a circuit breaker, the dashboard surfaces the alert immediately."

---

## Scene 9 — Dead-Man Switch & Monitoring (3:30–3:50)

**Screen:** Show terminal logs of `monitoringAgent` running its 6-hour cycle and `deadManPinger` sending a heartbeat.

**Narration:**
> "Behind the scenes, two guardian services run continuously. The Monitoring Agent checks on-chain activity and GitHub commits every 6 hours — automatically circuit-breaking projects that go dark. The Dead-Man Pinger pings every funded project's heartbeat contract daily. If a project vanishes for 60 days, anyone can trigger fund recovery."

---

## Scene 10 — Closing (3:50–4:00)

**Screen:** Full-page landing, then fade to the OmniVault logo.

**Narration:**
> "OmniVault — transparent, autonomous, always on. AI agents that debate. 0G Storage that never forgets. LP capital that never stops earning. This is the future of decentralized venture capital."

---

## Recording tips

- Use **OBS Studio** or **Loom** for screen + voice capture
- Keep MetaMask transaction confirmations short — pre-approve gas limits
- For the AI debate scene: if a real submission takes too long, use a pre-recorded terminal log playback (`script` / `asciinema`)
- Add subtle background music (royalty-free lo-fi) at ~20% volume
- Export at 1080p30, H.264, for YouTube/Twitter compatibility
