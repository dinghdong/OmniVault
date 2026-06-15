'use client';
import WalletButton from '../components/WalletButton';
import Modal from '../components/Modal';
import DepositModal from '../components/DepositModal';
import WithdrawModal from '../components/WithdrawModal';
import ProjectsSection from '../components/ProjectsSection';
import LPDashboard from '../components/LPDashboard';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useReadContract } from 'wagmi';
import { contractChainId, explorerUrl,
  fundVaultAddress, investmentManagerAddress, omniOracleAddress, nfaAddress } from '../hooks/contracts';
import { useState } from 'react';
import { formatUnits } from 'viem';
import { useVaultStats } from '../hooks/useVaultStats';
import { fundTokenAbi, fundTokenAddress } from '../hooks/contracts';

export default function Home() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const isWrongChain = isConnected && chainId !== contractChainId;
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const { tvl, tvlChange, projectCount, aiScoreThreshold, isLoading, isConfigured } = useVaultStats();

  // Real-time FundToken balance for connected wallet
  const { data: rawFtBalance } = useReadContract({
    address: fundTokenAddress,
    abi: fundTokenAbi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    chainId: contractChainId,
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const userFtBalance = rawFtBalance
    ? parseFloat(formatUnits(rawFtBalance as bigint, 18)).toFixed(4)
    : '0.0000';

  return (
    <main>
      {isWrongChain && (
        <div className="wrong-chain-topbar">
          ⚠️ Please switch to Arbitrum Sepolia (chainId {contractChainId}) to interact.
          <button onClick={() => switchChain({ chainId: contractChainId })}>
            Switch Network
          </button>
        </div>
      )}
      <nav className="nav">
        <div className="nav-content">
          <div className="logo">
            <img src="/logo.png" alt="OmniVault" width={32} height={32} style={{ borderRadius: 8 }} />
            <span>OmniVault</span>
          </div>
          <div className="nav-links">
            <a href="#portfolio">Portfolio</a>
            <a href="#pipeline">Pipeline</a>
            <a href="#features">Why OmniVault?</a>
            <a href="#how-it-works">How It Works</a>
          </div>
          <div className={`nav-connect${isConnected ? ' nav-connect--active' : ' nav-connect--idle'}`}>
            <WalletButton />
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <div className="badge">
            <span className="badge-dot"></span>
            A2A Protocol · Arbitrum · 0G · Chainlink
          </div>
          <h1 className="hero-title">
            The Future of<br />
            <span className="text-gradient">Web3 Investment</span>
          </h1>
          <p className="hero-subtitle">
            OmniVault is an autonomous AI agent network for decentralized venture capital.
            Non-Fungible Agents discover, evaluate, and fund Web3 projects 24/7 — fully on-chain.
          </p>
          <div className="hero-actions">
            <a href="#portfolio" className="btn-primary">Start Investing</a>
            <a href="/agent-sim" className="btn-secondary">Agent Hub</a>
          </div>
        </div>
        <div className="hero-visual">
          <div className="orb-container">
            <div className="orb"></div>
            <div className="orb-ring"></div>
            <div className="orb-ring-2"></div>
          </div>
        </div>
      </section>

      <section className="stats-section">
        <div className="stats-grid">

          {/* 1. TVL — from FundToken.totalSupply × accrualFactor */}
          <div className="stat-card">
            <div className="stat-value">{isLoading ? '...' : tvl}</div>
            <div className="stat-label">Total Value Locked</div>
            <div className="stat-change positive">{isLoading || !isConfigured ? '' : tvlChange}</div>
          </div>

          {/* 2. Projects Submitted — from InvestmentManager.projectCount */}
          <div className="stat-card">
            <div className="stat-value">{isLoading ? '...' : projectCount.toLocaleString()}</div>
            <div className="stat-label">Projects Submitted</div>
            <div className="stat-change positive">{isConfigured ? 'AI-audited pipeline' : ''}</div>
          </div>

          {/* 3. Cumulative Yield — from accrualFactor */}
          <div className="stat-card">
            <div className="stat-value">{isLoading ? '...' : !isConfigured ? '--' : tvlChange}</div>
            <div className="stat-label">Cumulative Yield</div>
            <div className="stat-change positive">{isConfigured ? 'investment rebasing' : ''}</div>
          </div>

          {/* 4. AI Approval Score — from InvestmentManager.SCORE_THRESHOLD */}
          <div className="stat-card">
            <div className="stat-value">{isLoading ? '...' : `${aiScoreThreshold}%`}</div>
            <div className="stat-label">AI Approval Bar</div>
            <div className="stat-change positive">{isConfigured ? 'Min. audit score' : ''}</div>
          </div>

        </div>
      </section>

      <section className="portfolio-section" id="portfolio">
        <div className="section-header">
          <h2 className="section-title">Your Portfolio</h2>
        </div>
        {isConnected ? (
          <div className="portfolio-connected">
            <div className="portfolio-hero">
              <div className="portfolio-hero-info">
                <div className="portfolio-hero-label">Your FundToken Balance</div>
                <div className="portfolio-hero-value">{userFtBalance}</div>
                <div className="portfolio-hero-sub">OVFT (rebasing ETH shares)</div>
              </div>
              <div className="portfolio-hero-actions">
                <button className="btn-primary" onClick={() => setDepositOpen(true)}>Deposit</button>
                <button className="btn-secondary" onClick={() => setWithdrawOpen(true)}>Withdraw</button>
              </div>
            </div>
            <LPDashboard />
          </div>
        ) : (
          <div className="wallet-prompt">
            <span>Connect your wallet to view portfolio</span>
            <div className="wallet-btn-wrapper">
              <WalletButton />
            </div>
          </div>
        )}
      </section>

      <section className="features-section" id="features">
        <div className="section-header centered">
          <h2 className="section-title">Why OmniVault?</h2>
          <p className="section-subtitle">The first autonomous A2A investment protocol on Arbitrum</p>
        </div>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon feature-icon-green">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>A2A Protocol</h3>
            <p>Autonomous AI agents with on-chain NFA identity discover and submit Web3 projects with no human gatekeepers. Agent-to-agent consensus via Chainlink Functions.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="11" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M7 11V7C7 4.79 9.24 3 12 3C14.76 3 17 4.79 17 7V11" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <h3>Secure Asset Management</h3>
            <p>ETH held directly in vault on Arbitrum. AI-managed investments with timelock and LP veto window. Smart contracts fully on-chain and verifiable.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-pink">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 8V12L15 15M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <h3>3D Scoring Engine</h3>
            <p>Reliability · Quality · Market Fit — three independent dimensions scored by Stylus smart contracts. Weighted consensus determines investment approval.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-blue">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M16 21V19C16 16.79 13.31 15 10 15H8C4.69 15 2 16.79 2 19V21M22 21V19C22 16.79 19.31 15 16 15H14L22 3V21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Fair LP Distribution</h3>
            <p>Rebasing FundToken model ensures yield distribution proportional to LP shareholding. Revenue share MasterChef-style per contributing agent.</p>
          </div>
        </div>
      </section>

      {/* ── AI Audit Pipeline ─────────────────────────────────────────────── */}
      <ProjectsSection />

      <section className="how-it-works" id="how-it-works">
        <div className="section-header centered">
          <h2 className="section-title">How It Works</h2>
          <p className="section-subtitle">Autonomous capital pipeline in 4 stages</p>
        </div>
        <div className="steps-timeline">
          <div className="timeline-track" aria-hidden="true">
            <div className="timeline-glow"></div>
          </div>

          <div className="step-node">
            <div className="step-pulse"></div>
            <div className="step-card">
              <div className="step-badge">01</div>
              <div className="step-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 7v12a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"/></svg>
              </div>
              <h3>Deposit ETH</h3>
              <p>Connect your wallet and deposit ETH. Your funds sit in the AI-managed vault, ready for allocation.</p>
            </div>
          </div>

          <div className="step-node">
            <div className="step-pulse"></div>
            <div className="step-card">
              <div className="step-badge">02</div>
              <div className="step-icon step-icon--cyan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
              </div>
              <h3>Agents Audit 24/7</h3>
              <p>Non-Fungible Agents scan the market, run audits in TEE enclaves, and submit proposals through the A2A Protocol.</p>
            </div>
          </div>

          <div className="step-node">
            <div className="step-pulse"></div>
            <div className="step-card">
              <div className="step-badge">03</div>
              <div className="step-icon step-icon--warn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
              </div>
              <h3>Investments Generate Returns</h3>
              <p>Approved bets and investments are executed on-chain. Gains flow back into the vault as they settle.</p>
            </div>
          </div>

          <div className="step-node">
            <div className="step-pulse"></div>
            <div className="step-card">
              <div className="step-badge">04</div>
              <div className="step-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <h3>Earn Rebasing Yield</h3>
              <p>Your FundToken balance auto-compounds as the vault grows. No claiming, no lock-ups — proportional to your share.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <img src="/logo.png" alt="OmniVault" width={32} height={32} style={{ borderRadius: 8 }} />
              <span>OmniVault</span>
            </div>
            <p>Autonomous A2A Investment Protocol · Arbitrum</p>
          </div>
          <div className="footer-links">
            <div className="footer-column">
              <h4>Contracts (Arb Sepolia)</h4>
              <a href={`${explorerUrl}/address/${fundVaultAddress}`} target="_blank" rel="noopener noreferrer">FundVault ↗</a>
              <a href={`${explorerUrl}/address/${investmentManagerAddress}`} target="_blank" rel="noopener noreferrer">InvestmentManager ↗</a>
              <a href={`${explorerUrl}/address/${omniOracleAddress}`} target="_blank" rel="noopener noreferrer">OmniOracle ↗</a>
              <a href={`${explorerUrl}/address/${nfaAddress}`} target="_blank" rel="noopener noreferrer">NonFungibleAgent ↗</a>
            </div>
            <div className="footer-column">
              <h4>Agents</h4>
              <a href="/agent-sim">Agent Hub ↗</a>
              <a href="https://github.com/dinghdong/OmniVault" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer">Twitter ↗</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2026 OmniVault. Built on <a href="https://arbitrum.io" target="_blank" rel="noopener noreferrer" style={{ color: '#00ff88' }}>Arbitrum</a> · <a href="https://0g.ai" target="_blank" rel="noopener noreferrer" style={{ color: '#00ff88' }}>0G</a> · <a href="https://chain.link" target="_blank" rel="noopener noreferrer" style={{ color: '#00ff88' }}>Chainlink</a> · Autonomous A2A protocol.</p>
        </div>
      </footer>

      <Modal isOpen={depositOpen} onClose={() => setDepositOpen(false)} title="Deposit ETH">
        <DepositModal />
      </Modal>

      <Modal isOpen={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Withdraw ETH">
        <WithdrawModal />
      </Modal>
    </main>
  );
}