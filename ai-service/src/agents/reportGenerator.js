import { createHash } from 'crypto';
import { logger } from '../logger.js';

export class ReportGenerator {
  async generate({ projectId, projectName, applicant, deckUrl, agentResults, consensusResult, executionTimeMs }) {
    logger.info('ReportGenerator: Generating audit report', { projectId });

    const pitchResult = agentResults.pitchDeckAnalysis ?? {};
    const riskResult = agentResults.riskAssessment ?? {};
    const bizResult = agentResults.businessAnalysis ?? {};

    const report = {
      version: '2.0',
      projectId,
      projectName,
      applicant,
      deckUrl,
      generatedAt: new Date().toISOString(),
      executionTimeMs,
      summary: {
        overallScore: consensusResult.finalScore,
        scoreLow: consensusResult.scoreLow,
        scoreHigh: consensusResult.scoreHigh,
        recommendation: this._getRecommendation(consensusResult.finalScore),
        redFlags: pitchResult.redFlags ?? false,
      },
      pitchDeckAnalysis: {
        overallScore: pitchResult.overallScore,
        scores: pitchResult.scores,
        strengths: pitchResult.strengths,
        concerns: pitchResult.concerns,
        summary: pitchResult.summary,
        deckFetched: pitchResult.deckFetched,
      },
      riskAssessment: {
        overallRiskScore: riskResult.overallRiskScore,
        riskLevel: riskResult.riskLevel,
        categories: riskResult.categories,
        topRisks: riskResult.topRisks,
      },
      businessAnalysis: {
        sustainabilityScore: bizResult.sustainabilityScore,
        dimensions: bizResult.dimensions,
        highlights: bizResult.highlights,
      },
      consensusDetails: consensusResult.details,
      methodology: {
        agents: ['PitchDeckAnalysisAgent', 'RiskAssessmentAgent', 'BusinessAnalysisAgent'],
        weights: { pitchDeckAnalysis: 0.40, riskAssessment: 0.35, businessAnalysis: 0.25 },
        consensusMechanism: 'Weighted average with variance-based confidence interval',
        scoreScale: '0–10000 basis points (8000 = 80% approval threshold)',
        redFlagPenalty: '-1500 bp if pitch deck agent flags red_flags',
      },
      disclaimers: [
        'This is an AI-generated analysis and should not be used as the sole basis for investment decisions.',
        'AI models can hallucinate or misinterpret content — always verify findings independently.',
        'Past AI audit accuracy does not guarantee future performance.',
      ],
    };

    const reportHash = this._generateHash(report);

    logger.info('ReportGenerator: Report ready', {
      projectId,
      recommendation: report.summary.recommendation,
      reportHash: reportHash.substring(0, 16) + '…',
    });

    return {
      content: JSON.stringify(report, null, 2),
      hash: reportHash,
      summary: report.summary,
    };
  }

  _getRecommendation(score) {
    if (score >= 8000) return 'APPROVED';
    if (score >= 6000) return 'REVIEW_REQUIRED';
    if (score >= 4000) return 'CONDITIONAL_APPROVAL';
    return 'REJECTED';
  }

  _generateHash(report) {
    const content = JSON.stringify(report, Object.keys(report).sort());
    return createHash('sha256').update(content).digest('hex');
  }
}
