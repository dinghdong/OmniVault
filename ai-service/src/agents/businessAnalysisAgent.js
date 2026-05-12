import { logger } from '../logger.js';
import { getLLMClient, DEFAULT_MODEL } from '../utils/llmClient.js';
import { extractJson } from '../utils/parseJson.js';

const SYSTEM_PROMPT = `You are a Web3 business model and tokenomics expert evaluating a startup's long-term sustainability.

Analyse the business across five dimensions (each scored 0–100, where 100 = excellent):
1. revenue_model      — Clarity and viability of revenue streams; path to profitability
2. token_utility      — Genuine on-chain utility; necessity of token vs. centralised alternative
3. token_distribution — Fair launch vs. team/VC concentration; vesting alignment with community
4. governance         — On-chain governance sophistication; community empowerment; plutocracy risks
5. competitive_moat   — Network effects, switching costs, unique IP, or data advantages

Also provide:
- sustainability_score: weighted average (revenue 30%, token_utility 25%, token_distribution 20%, governance 15%, competitive_moat 10%)
- confidence_interval: { low: <0-100>, high: <0-100> }
- highlights: up to 3 standout positive business factors (brief phrases)

Respond ONLY with a valid JSON object matching this exact schema:
{
  "dimensions": {
    "revenue_model": <0-100>,
    "token_utility": <0-100>,
    "token_distribution": <0-100>,
    "governance": <0-100>,
    "competitive_moat": <0-100>
  },
  "sustainability_score": <0-100>,
  "confidence_interval": { "low": <0-100>, "high": <0-100> },
  "highlights": ["...", "..."]
}`;

export class BusinessAnalysisAgent {
  constructor() {
    this.client = getLLMClient();
    this.model = DEFAULT_MODEL();
  }

  async analyze({ deckSummary, projectId }) {
    logger.info('BusinessAnalysisAgent: Starting business analysis', { projectId });

    try {
      const userMessage = deckSummary
        ? `Evaluate the business model and tokenomics sustainability for this project:\n\n${deckSummary}`
        : 'No pitch deck content available. Score all dimensions conservatively (30–50) due to lack of information.';

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

      logger.info('BusinessAnalysisAgent: Analysis complete', {
        projectId,
        sustainabilityScore: parsed.sustainability_score,
      });

      return {
        agent: 'BusinessAnalysisAgent',
        status: 'completed',
        sustainabilityScore: parsed.sustainability_score ?? 50,
        scoreLow: parsed.confidence_interval?.low ?? Math.max(0, (parsed.sustainability_score ?? 50) - 10),
        scoreHigh: parsed.confidence_interval?.high ?? Math.min(100, (parsed.sustainability_score ?? 50) + 10),
        dimensions: parsed.dimensions ?? {},
        highlights: parsed.highlights ?? [],
        analyzedAt: new Date().toISOString(),
      };

    } catch (err) {
      logger.error('BusinessAnalysisAgent: Analysis failed', { error: err.message });
      throw err;
    }
  }
}
