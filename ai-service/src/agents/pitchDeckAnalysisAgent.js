import { logger } from '../logger.js';
import { fetchPitchDeck } from '../utils/pitchDeckFetcher.js';
import { getLLMClient, DEFAULT_MODEL } from '../utils/llmClient.js';
import { extractJson } from '../utils/parseJson.js';

const SYSTEM_PROMPT = `You are a senior Web3 venture capital analyst conducting structured due diligence on a startup pitch deck.

Evaluate the pitch deck across these six dimensions (each scored 0–100):
1. problem_solution   — Clarity of problem, uniqueness and feasibility of solution
2. market_opportunity — Total addressable market, timing, and entry strategy
3. team_execution     — Founder background, relevant experience, team completeness
4. traction           — User/revenue metrics, partnerships, early validation
5. tokenomics         — Token utility, distribution fairness, incentive alignment
6. web3_rationale     — Why blockchain is necessary; decentralisation soundness

Also identify:
- up to 3 key strengths (brief phrases)
- up to 3 key concerns (brief phrases)
- red_flags: boolean — true if rug-pull risk, missing team, clone project, or regulatory land-mine

Respond ONLY with a valid JSON object matching this exact schema:
{
  "scores": {
    "problem_solution": <0-100>,
    "market_opportunity": <0-100>,
    "team_execution": <0-100>,
    "traction": <0-100>,
    "tokenomics": <0-100>,
    "web3_rationale": <0-100>
  },
  "strengths": ["...", "..."],
  "concerns": ["...", "..."],
  "red_flags": <true|false>,
  "summary": "<2-3 sentence overall assessment>"
}`;

export class PitchDeckAnalysisAgent {
  constructor() {
    this.client = getLLMClient();
    this.model = DEFAULT_MODEL();
  }

  async analyze({ deckUrl, deckHash, projectId, _deckText }) {
    logger.info('PitchDeckAnalysisAgent: Starting analysis', { projectId });

    // _deckText can be injected directly (tests / pre-fetched content)
    const deck = _deckText
      ? { text: _deckText, contentType: 'text/plain', url: deckUrl, fetchedAt: new Date().toISOString(), truncated: false }
      : await fetchPitchDeck(deckUrl);
    const deckContext = this._buildDeckContext(deck);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: deckContext },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      });

      const raw = response.choices[0].message.content;
      const parsed = extractJson(raw);
      const scores = parsed.scores || {};

      const overallScore = Math.round(
        Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length
      );

      logger.info('PitchDeckAnalysisAgent: Analysis complete', {
        projectId,
        overallScore,
        redFlags: parsed.red_flags,
      });

      return {
        agent: 'PitchDeckAnalysisAgent',
        status: 'completed',
        overallScore,
        scores,
        strengths: parsed.strengths || [],
        concerns: parsed.concerns || [],
        redFlags: parsed.red_flags || false,
        summary: parsed.summary || '',
        deckFetched: deck.text.length > 0,
        deckHash,
        analyzedAt: new Date().toISOString(),
      };

    } catch (err) {
      logger.error('PitchDeckAnalysisAgent: Analysis failed', { error: err.message });
      throw err;
    }
  }

  _buildDeckContext(deck) {
    const header = `Project Pitch Deck Analysis Request
Deck URL: ${deck.url}
Content Type: ${deck.contentType}
Fetched At: ${deck.fetchedAt}
${deck.truncated ? '⚠ Content was truncated to 12,000 characters.' : ''}`;

    if (deck.text.length === 0) {
      return `${header}

⚠ The pitch deck could not be fetched (${deck.error || 'unknown error'}).
Evaluate based on the URL alone and flag this as a concern under team_execution.
Score all dimensions conservatively (30–50) given the lack of content.`;
    }

    return `${header}

--- PITCH DECK CONTENT ---
${deck.text}
--- END OF CONTENT ---

Analyse the above content and return your structured JSON evaluation.`;
  }
}
