import { ethers } from 'ethers';
import { logger } from '../logger.js';
import { auditScheduler } from './auditScheduler.js';

// Delay before executeInvestment can be called after fulfillAudit.
// Matches EXECUTION_DELAY constant in InvestmentManager.sol (72h).
// Override with EXECUTION_DELAY_MS env var for local testing.
const EXECUTION_DELAY_MS = process.env.EXECUTION_DELAY_MS
  ? parseInt(process.env.EXECUTION_DELAY_MS, 10)
  : 72 * 60 * 60 * 1000;

const INVESTMENT_MANAGER_ABI = [
  'event ProjectSubmitted(uint256 indexed projectId, address indexed applicant, bytes32 commitHash, address contractAddr)',
  'event ExecutionQueued(uint256 indexed projectId, uint256 unlocksAt, uint256 score)',
  'event ExecutionVetoed(uint256 indexed projectId, address indexed vetoer, uint256 reason)',
  'function projects(uint256) view returns (address applicant, bytes32 commitHash, address contractAddr, string bizApi, uint8 status, uint256 auditScore, uint256 auditScoreLow, uint256 auditScoreHigh, bytes32 auditReportHash, uint256 investmentAmount, uint256 releasedAmount, uint256 submittedAt, uint256 auditedAt, uint256 executionUnlocksAt, uint256 exitedAt, uint256 exitProceeds)',
  'function fulfillAudit(uint256 projectId, uint256 score, uint256 scoreLow, uint256 scoreHigh, bytes32 reportHash, bytes[] nodeSignatures)',
  'function executeInvestment(uint256 projectId, uint256 amount, bytes vestingSchedule)',
  'function SCORE_THRESHOLD() view returns (uint256)',
];

// ProjectStatus enum values (mirrors Solidity)
const ProjectStatus = {
  None: 0, Pending: 1, Auditing: 2, PendingExecution: 3,
  Rejected: 4, Active: 5, CircuitBroken: 6, Exited: 7, WriteOff: 8, Vetoed: 9,
};

class OnChainListener {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.isRunning = false;
    // Track pending timers so we can cancel on stop()
    this._pendingExecutions = new Map(); // projectId → timeoutId
  }

  async start() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
    const privateKey = process.env.ORACLE_PRIVATE_KEY;
    const contractAddress = process.env.INVESTMENT_MANAGER_ADDRESS;

    if (!privateKey || !contractAddress) {
      logger.warn('OnChainListener: ORACLE_PRIVATE_KEY or INVESTMENT_MANAGER_ADDRESS not configured — chain listener disabled');
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.signer = new ethers.Wallet(privateKey, this.provider);
      this.contract = new ethers.Contract(contractAddress, INVESTMENT_MANAGER_ABI, this.signer);

      const network = await this.provider.getNetwork();
      logger.info('OnChainListener: Connected to chain', {
        chainId: network.chainId.toString(),
        contractAddress,
        oracleAddress: this.signer.address,
        executionDelayMs: EXECUTION_DELAY_MS,
      });

      this.contract.on('ProjectSubmitted', this._handleProjectSubmitted.bind(this));
      // Listen for vetoes so we can cancel scheduled executions
      this.contract.on('ExecutionVetoed', this._handleExecutionVetoed.bind(this));

      this.isRunning = true;
      logger.info('OnChainListener: Listening for ProjectSubmitted events');
    } catch (err) {
      logger.error('OnChainListener: Failed to start', { error: err.message });
    }
  }

  async _handleProjectSubmitted(projectId, applicant, commitHash, contractAddr, event) {
    const pid = Number(projectId);
    logger.info('OnChainListener: ProjectSubmitted', { projectId: pid, applicant });

    try {
      const project = await this.contract.projects(projectId);

      await auditScheduler.queueAudit({
        projectId: pid,
        deckHash: commitHash,
        deckUrl: project.bizApi,
        projectName: `Project #${pid}`,
        applicant,
        onComplete: (result) => this._submitFulfillAudit(projectId, result),
      });
    } catch (err) {
      logger.error('OnChainListener: Failed to queue audit', {
        projectId: pid, error: err.message,
      });
    }
  }

  async _submitFulfillAudit(projectId, result) {
    const pid = Number(projectId);
    try {
      const reportHashBytes32 = '0x' + result.reportHash.substring(0, 64).padEnd(64, '0');

      logger.info('OnChainListener: Submitting fulfillAudit', {
        projectId: pid,
        score: result.score,
        scoreLow: result.scoreLow,
        scoreHigh: result.scoreHigh,
      });

      const tx = await this.contract.fulfillAudit(
        projectId,
        result.score,
        result.scoreLow,
        result.scoreHigh,
        reportHashBytes32,
        []
      );
      const receipt = await tx.wait();

      logger.info('OnChainListener: fulfillAudit confirmed', {
        projectId: pid, txHash: receipt.hash,
      });

      // If score passed threshold, schedule executeInvestment after the timelock.
      const scoreThreshold = await this.contract.SCORE_THRESHOLD();
      if (BigInt(result.score) >= scoreThreshold) {
        this._scheduleExecution(projectId, result);
      }
    } catch (err) {
      logger.error('OnChainListener: fulfillAudit failed', {
        projectId: pid, error: err.message,
      });
    }
  }

  _scheduleExecution(projectId, auditResult) {
    const pid = Number(projectId);

    // Add a small buffer (30s) on top of the on-chain delay to guarantee
    // the timelock has expired by the time we send the tx.
    const delayMs = EXECUTION_DELAY_MS + 30_000;

    logger.info('OnChainListener: Scheduling executeInvestment', {
      projectId: pid,
      score: auditResult.score,
      executeAfterMs: delayMs,
    });

    const timeoutId = setTimeout(async () => {
      this._pendingExecutions.delete(pid);
      await this._executeInvestment(projectId, auditResult);
    }, delayMs);

    this._pendingExecutions.set(pid, timeoutId);
  }

  async _executeInvestment(projectId, auditResult) {
    const pid = Number(projectId);
    try {
      // Verify status is still PendingExecution before sending tx
      const project = await this.contract.projects(projectId);
      if (Number(project.status) !== ProjectStatus.PendingExecution) {
        logger.info('OnChainListener: Skipping execution — project no longer PendingExecution', {
          projectId: pid, status: Number(project.status),
        });
        return;
      }

      // Default investment amount: 1 ETH (production: derive from vault TVL / governance)
      const investAmount = ethers.parseEther(process.env.INVESTMENT_AMOUNT_ETH || '1');

      logger.info('OnChainListener: Calling executeInvestment', {
        projectId: pid, amount: ethers.formatEther(investAmount),
      });

      const nonce = await this.provider.getTransactionCount(this.signer.address, 'latest');
      const tx = await this.contract.executeInvestment(
        projectId,
        investAmount,
        '0x',
        { nonce }
      );
      const receipt = await tx.wait();

      logger.info('OnChainListener: executeInvestment confirmed', {
        projectId: pid, txHash: receipt.hash,
        amount: ethers.formatEther(investAmount),
      });
    } catch (err) {
      logger.error('OnChainListener: executeInvestment failed', {
        projectId: pid, error: err.message,
      });
    }
  }

  _handleExecutionVetoed(projectId, vetoer, reason) {
    const pid = Number(projectId);
    logger.warn('OnChainListener: ExecutionVetoed — cancelling scheduled execution', {
      projectId: pid, vetoer, reason: Number(reason),
    });

    const timeoutId = this._pendingExecutions.get(pid);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      this._pendingExecutions.delete(pid);
    }
  }

  stop() {
    if (this.contract) this.contract.removeAllListeners();
    // Cancel all pending execution timers
    for (const [pid, timeoutId] of this._pendingExecutions) {
      clearTimeout(timeoutId);
      logger.info('OnChainListener: Cancelled pending execution on stop', { projectId: pid });
    }
    this._pendingExecutions.clear();
    this.isRunning = false;
    logger.info('OnChainListener: Stopped');
  }
}

export const onChainListener = new OnChainListener();
