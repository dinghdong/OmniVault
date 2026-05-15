/**
 * onChainListener.js — On-chain event listener + multi-agent voting orchestrator
 *
 * Architecture (AgentVoting governance flow):
 *
 *  ProjectSubmitted event
 *    │
 *    ├─► Run MultiAgentOrchestrator (3 specialist agents in parallel)
 *    │     PitchDeckAnalysisAgent  → score, 0G report hash
 *    │     RiskAssessmentAgent     → score, 0G report hash
 *    │     BusinessAnalysisAgent   → score, 0G report hash
 *    │
 *    └─► Each agent wallet independently calls AgentVoting.agentVote()
 *          approved      = (domain score >= AGENT_APPROVAL_THRESHOLD)
 *          reasoningHash = 0G Storage root hash of full sub-report
 *
 *  QuorumReached event (all agents approved)
 *    └─► Schedule triggerExecution() after 48 h community window + 30 s buffer
 *
 *  ExecutionQueued event (fulfillAudit passed, 72 h timelock starts)
 *    └─► Schedule executeInvestment() after timelock + 30 s buffer
 *
 *  ExecutionVetoed event
 *    └─► Cancel scheduled executeInvestment()
 */

import { ethers } from 'ethers';
import { logger } from '../logger.js';
import { MultiAgentOrchestrator } from '../agents/multiAgentOrchestrator.js';
import { uploadToZeroG } from '../utils/zgStorage.js';

// ─── Delays ────────────────────────────────────────────────────────────────
const COMMUNITY_WINDOW_MS = process.env.COMMUNITY_WINDOW_MS
  ? parseInt(process.env.COMMUNITY_WINDOW_MS, 10)
  : 48 * 60 * 60 * 1000;

const EXECUTION_DELAY_MS = process.env.EXECUTION_DELAY_MS
  ? parseInt(process.env.EXECUTION_DELAY_MS, 10)
  : 72 * 60 * 60 * 1000;

// Individual agent approval threshold (basis points, default 6000 = 60%)
const AGENT_APPROVAL_THRESHOLD = parseInt(process.env.AGENT_APPROVAL_THRESHOLD || '6000', 10);

// ─── ABIs ──────────────────────────────────────────────────────────────────
const INVESTMENT_MANAGER_ABI = [
  'event ProjectSubmitted(uint256 indexed projectId, address indexed applicant, bytes32 commitHash, address contractAddr)',
  'event ExecutionQueued(uint256 indexed projectId, uint256 unlocksAt, uint256 score)',
  'event ExecutionVetoed(uint256 indexed projectId, address indexed vetoer, uint256 reason)',
  'function projects(uint256) view returns (address applicant, bytes32 commitHash, address contractAddr, string bizApi, uint8 status, uint256 auditScore, uint256 auditScoreLow, uint256 auditScoreHigh, bytes32 auditReportHash, uint256 investmentAmount, uint256 releasedAmount, uint256 submittedAt, uint256 auditedAt, uint256 executionUnlocksAt, uint256 exitedAt, uint256 exitProceeds)',
  'function executeInvestment(uint256 projectId, uint256 amount, bytes vestingSchedule)',
];

const AGENT_VOTING_ABI = [
  'event QuorumReached(uint256 indexed projectId, uint256 communityWindowEnd, uint256 avgScore)',
  'function agentVote(uint256 projectId, bool approved, uint256 score, uint256 scoreLow, uint256 scoreHigh, bytes32 reasoningHash)',
  'function triggerExecution(uint256 projectId)',
];

// ─── Agent wallet config ───────────────────────────────────────────────────
// Each entry maps an env-var key to the orchestrator agent name it represents.
const AGENT_CONFIG = [
  { envKey: 'AGENT1_PRIVATE_KEY', name: 'pitchDeckAnalysis' },
  { envKey: 'AGENT2_PRIVATE_KEY', name: 'riskAssessment'    },
  { envKey: 'AGENT3_PRIVATE_KEY', name: 'businessAnalysis'  },
];

// ProjectStatus enum (mirrors InvestmentManager.sol)
const ProjectStatus = {
  None: 0, Pending: 1, Auditing: 2, PendingExecution: 3,
  Rejected: 4, Active: 5, CircuitBroken: 6, Exited: 7, WriteOff: 8, Vetoed: 9,
};

// ─── Listener class ────────────────────────────────────────────────────────
class OnChainListener {
  constructor() {
    this.provider     = null;
    this.imContract   = null;   // InvestmentManager (events + executeInvestment)
    this.avContract   = null;   // AgentVoting (events)
    this.agentSigners = [];     // [{ signer, name, avContract }]
    this._execSigner  = null;   // signer used for triggerExecution + executeInvestment
    this._imExec      = null;   // InvestmentManager connected to _execSigner
    this.orchestrator = new MultiAgentOrchestrator();
    this.isRunning    = false;

    this._pendingExecutions = new Map(); // projectId → timeoutId
    this._pendingTriggers   = new Map(); // projectId → timeoutId
  }

  // ─── Start ─────────────────────────────────────────────────────────────
  async start() {
    const rpcUrl    = process.env.RPC_URL                   || 'http://127.0.0.1:8545';
    const imAddress = process.env.INVESTMENT_MANAGER_ADDRESS;
    const avAddress = process.env.AGENT_VOTING_ADDRESS;

    if (!imAddress || !avAddress) {
      logger.warn('OnChainListener: INVESTMENT_MANAGER_ADDRESS or AGENT_VOTING_ADDRESS not configured — listener disabled');
      return;
    }

    const configuredAgents = AGENT_CONFIG.filter(a => process.env[a.envKey]);
    if (configuredAgents.length === 0) {
      logger.warn('OnChainListener: No AGENT*_PRIVATE_KEY env vars found — listener disabled');
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      const network = await this.provider.getNetwork();

      // Read-only contracts for event listening
      this.imContract = new ethers.Contract(imAddress, INVESTMENT_MANAGER_ABI, this.provider);
      this.avContract = new ethers.Contract(avAddress, AGENT_VOTING_ABI, this.provider);

      // Build one signed contract per agent wallet
      this.agentSigners = configuredAgents.map(({ envKey, name }) => {
        const signer   = new ethers.Wallet(process.env[envKey], this.provider);
        const avSigned = new ethers.Contract(avAddress, AGENT_VOTING_ABI, signer);
        return { signer, name, avContract: avSigned };
      });

      // First agent wallet handles triggerExecution + executeInvestment
      this._execSigner = this.agentSigners[0].signer;
      this._imExec     = new ethers.Contract(imAddress, INVESTMENT_MANAGER_ABI, this._execSigner);

      logger.info('OnChainListener: Connected', {
        chainId:          network.chainId.toString(),
        imAddress,
        avAddress,
        agents:           this.agentSigners.map(a => ({ name: a.name, address: a.signer.address })),
        communityWindowMs: COMMUNITY_WINDOW_MS,
        executionDelayMs:  EXECUTION_DELAY_MS,
      });

      this.imContract.on('ProjectSubmitted', this._handleProjectSubmitted.bind(this));
      this.imContract.on('ExecutionQueued',  this._handleExecutionQueued.bind(this));
      this.imContract.on('ExecutionVetoed',  this._handleExecutionVetoed.bind(this));
      this.avContract.on('QuorumReached',    this._handleQuorumReached.bind(this));

      this.isRunning = true;
      logger.info('OnChainListener: Listening for on-chain events');

    } catch (err) {
      logger.error('OnChainListener: Failed to start', { error: err.message });
    }
  }

  // ─── Event: ProjectSubmitted ──────────────────────────────────────────
  async _handleProjectSubmitted(projectId, applicant, commitHash) {
    const pid = Number(projectId);
    logger.info('OnChainListener: ProjectSubmitted', { projectId: pid, applicant });

    try {
      const project = await this.imContract.projects(projectId);

      // Run the full orchestrator — all 3 sub-agents in parallel internally
      const result = await this.orchestrator.runAudit({
        projectId:   pid,
        deckHash:    commitHash,
        deckUrl:     project.bizApi,
        projectName: `Project #${pid}`,
        applicant,
      });

      logger.info('OnChainListener: Orchestrator complete', {
        projectId: pid, finalScore: result.score,
      });

      // Each agent wallet votes independently (in parallel, best-effort)
      await Promise.allSettled(
        this.agentSigners.map(agent => this._submitAgentVote(agent, pid, result))
      );

    } catch (err) {
      logger.error('OnChainListener: Failed to handle ProjectSubmitted', {
        projectId: pid, error: err.message,
      });
    }
  }

  // ─── Per-agent vote ───────────────────────────────────────────────────
  async _submitAgentVote(agent, pid, orchestratorResult) {
    const { signer, name, avContract } = agent;

    try {
      const { score, scoreLow, scoreHigh } = this._extractAgentScore(name, orchestratorResult);
      const approved = score >= AGENT_APPROVAL_THRESHOLD;

      // Build and upload sub-report to 0G Storage
      const subReport = this._buildSubReport(name, pid, orchestratorResult);
      const { hash: reasoningHash, stored } = await uploadToZeroG(subReport, `${name}#${pid}`);

      logger.info('OnChainListener: Submitting agentVote', {
        projectId: pid, agent: name,
        address: signer.address, score, approved,
        reasoningHash, storedOn0G: stored,
      });

      const nonce = await this.provider.getTransactionCount(signer.address, 'latest');
      const tx    = await avContract.agentVote(pid, approved, score, scoreLow, scoreHigh, reasoningHash, { nonce });
      const receipt = await tx.wait();

      logger.info('OnChainListener: agentVote confirmed', {
        projectId: pid, agent: name, txHash: receipt.hash,
      });

    } catch (err) {
      logger.error('OnChainListener: agentVote failed', {
        projectId: pid, agent: name, error: err.message,
      });
    }
  }

  // ─── Event: QuorumReached ─────────────────────────────────────────────
  _handleQuorumReached(projectId, communityWindowEnd, avgScore) {
    const pid      = Number(projectId);
    const endMs    = Number(communityWindowEnd) * 1000;
    const delayMs  = Math.max(0, endMs - Date.now()) + 30_000;

    logger.info('OnChainListener: QuorumReached — scheduling triggerExecution', {
      projectId: pid,
      avgScore:  Number(avgScore),
      triggerIn: `${Math.round(delayMs / 1000)}s`,
    });

    const id = setTimeout(async () => {
      this._pendingTriggers.delete(pid);
      await this._callTriggerExecution(pid);
    }, delayMs);

    this._pendingTriggers.set(pid, id);
  }

  async _callTriggerExecution(pid) {
    try {
      logger.info('OnChainListener: Calling triggerExecution', { projectId: pid });
      const nonce = await this.provider.getTransactionCount(this._execSigner.address, 'latest');
      const avSigned = this.agentSigners[0].avContract;
      const tx = await avSigned.triggerExecution(pid, { nonce });
      const receipt = await tx.wait();
      logger.info('OnChainListener: triggerExecution confirmed', {
        projectId: pid, txHash: receipt.hash,
      });
    } catch (err) {
      logger.error('OnChainListener: triggerExecution failed', {
        projectId: pid, error: err.message,
      });
    }
  }

  // ─── Event: ExecutionQueued ───────────────────────────────────────────
  _handleExecutionQueued(projectId, unlocksAt, score) {
    const pid     = Number(projectId);
    const endMs   = Number(unlocksAt) * 1000;
    const delayMs = Math.max(0, endMs - Date.now()) + 30_000;

    logger.info('OnChainListener: ExecutionQueued — scheduling executeInvestment', {
      projectId: pid,
      score:     Number(score),
      executeIn: `${Math.round(delayMs / 1000)}s`,
    });

    const id = setTimeout(async () => {
      this._pendingExecutions.delete(pid);
      await this._callExecuteInvestment(pid);
    }, delayMs);

    this._pendingExecutions.set(pid, id);
  }

  async _callExecuteInvestment(pid) {
    try {
      const project = await this.imContract.projects(pid);
      if (Number(project.status) !== ProjectStatus.PendingExecution) {
        logger.info('OnChainListener: Skipping executeInvestment — not PendingExecution', {
          projectId: pid, status: Number(project.status),
        });
        return;
      }

      const amount = ethers.parseEther(process.env.INVESTMENT_AMOUNT_ETH || '1');
      logger.info('OnChainListener: Calling executeInvestment', {
        projectId: pid, amount: ethers.formatEther(amount),
      });

      const nonce   = await this.provider.getTransactionCount(this._execSigner.address, 'latest');
      const tx      = await this._imExec.executeInvestment(pid, amount, '0x', { nonce });
      const receipt = await tx.wait();

      logger.info('OnChainListener: executeInvestment confirmed', {
        projectId: pid, txHash: receipt.hash,
      });

    } catch (err) {
      logger.error('OnChainListener: executeInvestment failed', {
        projectId: pid, error: err.message,
      });
    }
  }

  // ─── Event: ExecutionVetoed ───────────────────────────────────────────
  _handleExecutionVetoed(projectId, vetoer, reason) {
    const pid = Number(projectId);
    logger.warn('OnChainListener: ExecutionVetoed — cancelling timers', {
      projectId: pid, vetoer, reason: Number(reason),
    });
    this._cancelTimers(pid);
  }

  // ─── Score helpers ────────────────────────────────────────────────────
  _extractAgentScore(agentName, result) {
    const r = result.agentResults?.[agentName] ?? {};

    let raw;
    switch (agentName) {
      case 'pitchDeckAnalysis': raw = r.overallScore     ?? 50; break;
      case 'riskAssessment':    raw = Math.max(0, 100 - (r.overallRiskScore ?? 50)); break;
      case 'businessAnalysis':  raw = r.sustainabilityScore ?? 50; break;
      default:                  raw = 50;
    }

    const score     = Math.round(Math.max(0, Math.min(100, raw)) * 100);
    const spread    = Math.round(score * 0.10);
    const scoreLow  = Math.max(0,     score - spread);
    const scoreHigh = Math.min(10000, score + spread);
    return { score, scoreLow, scoreHigh };
  }

  _buildSubReport(agentName, projectId, result) {
    return {
      agentName,
      projectId,
      generatedAt:    new Date().toISOString(),
      individualScore: this._extractAgentScore(agentName, result),
      agentResult:    result.agentResults?.[agentName] ?? {},
      consensusScore: result.score,
      methodology:    'OmniVault multi-agent AI audit v2 — stored on 0G Storage',
    };
  }

  // ─── Timer helpers ────────────────────────────────────────────────────
  _cancelTimers(pid) {
    const execId = this._pendingExecutions.get(pid);
    if (execId !== undefined) {
      clearTimeout(execId);
      this._pendingExecutions.delete(pid);
      logger.info('OnChainListener: Cancelled executeInvestment timer', { projectId: pid });
    }
    const triggerId = this._pendingTriggers.get(pid);
    if (triggerId !== undefined) {
      clearTimeout(triggerId);
      this._pendingTriggers.delete(pid);
      logger.info('OnChainListener: Cancelled triggerExecution timer', { projectId: pid });
    }
  }

  // ─── Stop ─────────────────────────────────────────────────────────────
  stop() {
    if (this.imContract) this.imContract.removeAllListeners();
    if (this.avContract) this.avContract.removeAllListeners();

    const allPids = new Set([
      ...this._pendingExecutions.keys(),
      ...this._pendingTriggers.keys(),
    ]);
    for (const pid of allPids) this._cancelTimers(pid);

    this.isRunning = false;
    logger.info('OnChainListener: Stopped');
  }
}

export const onChainListener = new OnChainListener();
