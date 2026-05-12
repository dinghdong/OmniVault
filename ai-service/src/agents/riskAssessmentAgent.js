import { logger } from '../logger.js';
import { getLLMClient, DEFAULT_MODEL } from '../utils/llmClient.js';
import { extractJson } from '../utils/parseJson.js';

const SYSTEM_PROMPT = `You are a Web3 investment risk analyst assessing startup risk from a pitch deck summary.

Evaluate risk across five categories (each scored 0–100, where 100 = highest risk):
1. team_risk         — Anonymous team, no LinkedIn, unverifiable claims, single founder without track record
2. market_risk       — Saturated market, wrong timing, unclear go-to-market, niche-only demand
3. execution_risk    — Overambitious roadmap, no MVP, unrealistic milestones, thin team for scope
4. regulatory_risk   — Securities law exposure, KYC/AML gaps, jurisdictional issues
5. competitive_risk  — Strong incumbents, low switching cost, token easily forked

Also provide:
- overall_risk_score: weighted average (team 30%, execution 25%, market 20%, regulatory 15%, competitive 10%)
- confidence_interval: { low: <0-100>, high: <0-100> } (reflects uncertainty due to limited info)
- risk_level: "low" | "medium" | "high"
- top_risks: up to 3 most critical risk factors (brief phrases)

Respond ONLY with a valid JSON object matching this exact schema:
{
  "categories": {
    "team_risk": <0-100>,
    "market_risk": <0-100>,
    "execution_risk": <0-100>,
    "regulatory_risk": <0-100>,
    "competitive_risk": <0-100>
  },
  "overall_risk_score": <0-100>,
  "confidence_interval": { "low": <0-100>, "high": <0-100> },
  "risk_level": "low"|"medium"|"high",
  "top_risks": ["...", "..."]
}`;

export class RiskAssessmentAgent {
  constructor() {
    this.client = getLLMClient();
    this.model = DEFAULT_MODEL();
  }

  async assess({ deckSummary, projectId }) {
    logger.info('RiskAssessmentAgent: Starting risk assessment', { projectId });

    try {
      const userMessage = deckSummary
        ? `Assess the investment risk for this project based on the following pitch deck summary:\n\n${deckSummary}`
        : 'No pitch deck content available. Score all risk dimensions conservatively (60–80) due to lack of information.';

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 3000,
      });

      const parsed = extractJson(response.choices[0].message.content);

      logger.info('RiskAssessmentAgent: Assessment complete', {
        projectId,
        overallRisk: parsed.overall_risk_score,
        riskLevel: parsed.risk_level,
      });

      return {
        agent: 'RiskAssessmentAgent',
        status: 'completed',
        overallRiskScore: parsed.overall_risk_score ?? 50,
        riskLevel: parsed.risk_level ?? 'medium',
        scoreLow: parsed.confidence_interval?.low ?? Math.max(0, (parsed.overall_risk_score ?? 50) - 15),
        scoreHigh: parsed.confidence_interval?.high ?? Math.min(100, (parsed.overall_risk_score ?? 50) + 15),
        categories: parsed.categories ?? {},
        topRisks: parsed.top_risks ?? [],
        assessedAt: new Date().toISOString(),
      };

    } catch (err) {
      logger.error('RiskAssessmentAgent: Assessment failed', { error: err.message });
      throw err;
    }
  }
}
