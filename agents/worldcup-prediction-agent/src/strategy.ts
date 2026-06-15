/**
 * Very simple World Cup match prediction strategy for demo purposes.
 *
 * In production this would be a private ML model running inside a TEE.
 * Here we use a naive momentum/value heuristic so the agent produces
 * deterministic, explainable outputs.
 */
export interface Match {
  home: string;
  away: string;
  homeOdds: number;   // decimal odds, e.g. 2.5
  drawOdds: number;
  awayOdds: number;
}

export interface Prediction {
  outcomeIndex: number; // 0 = home, 1 = draw, 2 = away
  confidence: number;   // 0 - 100
  reasoning: string;
}

export function predict(match: Match): Prediction {
  const { homeOdds, drawOdds, awayOdds } = match;
  const impliedHome = 1 / homeOdds;
  const impliedDraw = 1 / drawOdds;
  const impliedAway = 1 / awayOdds;
  const overround = impliedHome + impliedDraw + impliedAway;

  // Naive "value bet" heuristic: pick the outcome whose implied probability
  // is most undervalued relative to a simple momentum factor.
  // For demo we just pick the outcome with the highest odds (underdog)
  // when the favorite is too heavy, otherwise pick the favorite.
  const favoriteIndex = impliedHome > impliedAway ? 0 : 2;
  const favoriteOdds = favoriteIndex === 0 ? homeOdds : awayOdds;

  let outcomeIndex: number;
  let confidence: number;
  let reasoning: string;

  if (favoriteOdds < 1.5) {
    // Heavy favorite: bet on the favorite with medium confidence.
    outcomeIndex = favoriteIndex;
    confidence = Math.round(55 + (1.5 - favoriteOdds) * 30);
    reasoning = `${favoriteIndex === 0 ? match.home : match.away} is strongly favored; follow the market.`;
  } else {
    // Closer match: pick the highest-value underdog.
    const values = [
      impliedHome / overround - 1 / homeOdds,
      impliedDraw / overround - 1 / drawOdds,
      impliedAway / overround - 1 / awayOdds,
    ];
    outcomeIndex = values.indexOf(Math.max(...values));
    confidence = Math.round(45 + Math.random() * 20);
    reasoning = 'Value bet on the most undervalued outcome per naive heuristic.';
  }

  return { outcomeIndex, confidence: Math.min(95, confidence), reasoning };
}
