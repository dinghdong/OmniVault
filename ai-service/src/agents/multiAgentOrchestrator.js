import { logger } from '../logger.js';
import { fetchPitchDeck } from '../utils/pitchDeckFetcher.js';
import { PitchDeckAnalysisAgent } from './pitchDeckAnalysisAgent.js';
import { RiskAssessmentAgent } from './riskAssessmentAgent.js';
import { BusinessAnalysisAgent } from './businessAnalysisAgent.js';
import { ConsensusEngine } from './consensusEngine.js';
import { ReportGenerator } from './reportGenerator.js';

/**
 * MultiAgentOrchestrator — pitch deck audit flow:
 *
 * 1. Fetch pitch deck content (shared across agents)
 * 2. Run three agents in parallel:
 *    - PitchDeckAnalysisAgent  → investment potential across 6 dimensions
 *    - RiskAssessmentAgent     → risk profile across 5 risk categories
 *    - BusinessAnalysisAgent   → tokenomics & business model sustainability
 * 3. ConsensusEngine aggregates into a 0-10000 basis-point score
 * 4. ReportGenerator produces a hashed audit report for on-chain storage
 */
export class MultiAgentOrchestrator {
  constructor() {
    this.agents = {
      pitchDeckAnalysis: new PitchDeckAnalysisAgent(),
      riskAssessment: new RiskAssessmentAgent(),
      businessAnalysis: new BusinessAnalysisAgent(),
    };
    this.consensus = new ConsensusEngine();
    this.reportGenerator = new ReportGenerator();
  }

  async runAudit({ deckHash, deckUrl, projectId, projectName, applicant, _deckText }) {
    logger.info('MultiAgentOrchestrator: Starting pitch deck audit', { projectId, projectName });
    const startTime = Date.now();

    // ── Pre-fetch deck content once; share summary across agents ──────────────
    // _deckText can be injected directly (useful in tests to avoid network fetches)
    const deck = _deckText ? { text: _deckText } : await fetchPitchDeck(deckUrl);
    const deckSummary = deck.text.slice(0, 6000) || null;

    // ── Phase 1: Parallel agent analysis ─────────────────────────────────────
    logger.info('Phase 1: Parallel agent analysis', { projectId });

    const [deckResult, riskResult, businessResult] = await Promise.allSettled([
      this.agents.pitchDeckAnalysis.analyze({ deckUrl, deckHash, projectId, _deckText }),
      this.agents.riskAssessment.assess({ deckSummary, projectId }),
      this.agents.businessAnalysis.analyze({ deckSummary, projectId }),
    ]);

    const agentResults = {};
    const agentsUsed = [];

    for (const [key, settled] of [
      ['pitchDeckAnalysis', deckResult],
      ['riskAssessment', riskResult],
      ['businessAnalysis', businessResult],
    ]) {
      if (settled.status === 'fulfilled') {
        agentResults[key] = settled.value;
        agentsUsed.push(key);
      } else {
        logger.error(`Agent ${key} failed`, { error: settled.reason?.message });
        agentResults[key] = { error: settled.reason?.message };
      }
    }

    // ── Phase 2: Consensus scoring ─────────────────────────────────────────────
    logger.info('Phase 2: Consensus engine', { projectId });
    const consensusResult = await this.consensus.reachConsensus(agentResults);

    // ── Phase 3: Report generation ─────────────────────────────────────────────
    logger.info('Phase 3: Report generation', { projectId });
    const report = await this.reportGenerator.generate({
      projectId,
      projectName,
      applicant,
      deckUrl,
      agentResults,
      consensusResult,
      executionTimeMs: Date.now() - startTime,
    });

    logger.info('MultiAgentOrchestrator: Audit complete', {
      projectId,
      finalScore: consensusResult.finalScore,
      executionTimeMs: Date.now() - startTime,
    });

    return {
      score: consensusResult.finalScore,
      scoreLow: consensusResult.scoreLow,
      scoreHigh: consensusResult.scoreHigh,
      reportHash: report.hash,
      report: report.content,
      agentsUsed,
      agentResults,
      consensusDetails: consensusResult.details,
      completedAt: new Date().toISOString(),
    };
  }
}
