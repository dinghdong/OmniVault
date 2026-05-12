import { logger } from '../logger.js';

/**
 * ConsensusEngine — aggregates three agent scores into a 0–10000 basis-point score.
 *
 * Weights (sum = 1.0):
 *   pitchDeckAnalysis  0.40  — primary investment signal
 *   riskAssessment     0.35  — risk is a major filter
 *   businessAnalysis   0.25  — tokenomics/sustainability
 *
 * Score derivation per agent:
 *   pitchDeckAnalysis  → overallScore (0-100, higher = better)
 *   riskAssessment     → 100 - overallRiskScore (inverted: lower risk = higher score)
 *   businessAnalysis   → sustainabilityScore (0-100, higher = better)
 *
 * Final score = weighted average × 100  (scales 0-100 range to 0-10000 basis points)
 * Red-flag penalty: -1500 bp if any pitch deck agent flags red_flags = true
 */
export class ConsensusEngine {
  constructor() {
    this.weights = {
      pitchDeckAnalysis: 0.40,
      riskAssessment: 0.35,
      businessAnalysis: 0.25,
    };
  }

  async reachConsensus(agentResults) {
    logger.info('ConsensusEngine: Aggregating agent results');

    const scores = [];
    let weightedSum = 0;
    let totalWeight = 0;
    let minScore = 100;
    let maxScore = 0;

    for (const [agentName, result] of Object.entries(agentResults)) {
      if (result.error) {
        logger.warn(`ConsensusEngine: Skipping ${agentName} (error)`);
        continue;
      }

      const agentScore = this._extractScore(agentName, result);
      const weight = this.weights[agentName] ?? 0.33;

      scores.push({ agent: agentName, score: agentScore, weight });
      weightedSum += agentScore * weight;
      totalWeight += weight;
      minScore = Math.min(minScore, agentScore);
      maxScore = Math.max(maxScore, agentScore);

      logger.info(`ConsensusEngine: ${agentName} → score=${agentScore}, weight=${weight}`);
    }

    if (scores.length === 0) {
      return { finalScore: 5000, scoreLow: 3500, scoreHigh: 6500, details: { error: 'No valid agent results' } };
    }

    // Weighted average scaled to basis points
    const baseScore = (weightedSum / totalWeight) * 100;

    // Confidence interval: wider spread between agents = wider interval
    const variance = maxScore - minScore;
    const spread = variance * 40;
    const scoreLow = Math.max(0, Math.round(baseScore - spread));
    const scoreHigh = Math.min(10000, Math.round(baseScore + spread));

    // Red-flag penalty
    const hasRedFlags = agentResults.pitchDeckAnalysis?.redFlags === true;
    const adjusted = hasRedFlags ? baseScore - 1500 : baseScore;
    const finalScore = Math.round(Math.max(0, Math.min(10000, adjusted)));

    logger.info('ConsensusEngine: Consensus reached', { finalScore, scoreLow, scoreHigh, hasRedFlags });

    return {
      finalScore,
      scoreLow,
      scoreHigh,
      details: { agentScores: scores, variance, hasRedFlags, baseScore: Math.round(baseScore) },
    };
  }

  _extractScore(agentName, result) {
    switch (agentName) {
      case 'pitchDeckAnalysis':
        return result.overallScore ?? 50;

      case 'riskAssessment':
        // Invert: high risk = low investment score
        return Math.max(0, 100 - (result.overallRiskScore ?? 50));

      case 'businessAnalysis':
        return result.sustainabilityScore ?? 50;

      default:
        return 50;
    }
  }
}
