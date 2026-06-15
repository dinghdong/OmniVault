import express, { Request, Response } from 'express';
import cors from 'cors';
import { Match, predict } from './strategy';
import { generateQuote, getAgentIdentity, signPayload, verifyQuote } from './attestation';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', agent: 'worldcup-prediction-agent', version: '0.1.0' });
});

// Return the stable TEE identity that should be registered in the NFA.
app.get('/identity', (_req: Request, res: Response) => {
  res.json(getAgentIdentity());
});

// Generate a fresh mock attestation quote.
app.get('/attest', (_req: Request, res: Response) => {
  const quote = generateQuote();
  res.json({ quote, valid: verifyQuote(quote) });
});

// Predict a match outcome.
app.post('/predict', (req: Request, res: Response) => {
  const match: Match = req.body;
  if (!match?.home || !match?.away || !match?.homeOdds || !match?.drawOdds || !match?.awayOdds) {
    res.status(400).json({ error: 'Missing match fields: home, away, homeOdds, drawOdds, awayOdds' });
    return;
  }

  const prediction = predict(match);
  const quote = generateQuote();

  // Sign the prediction so OmniVault can verify it came from this agent.
  const payload = JSON.stringify({
    home: match.home,
    away: match.away,
    outcomeIndex: prediction.outcomeIndex,
    confidence: prediction.confidence,
    timestamp: quote.timestamp,
  });
  const signature = signPayload(Buffer.from(payload).toString('hex') as `0x${string}`);

  res.json({
    match,
    prediction,
    quote,
    signature,
  });
});

// Sign a bet order. This is what the agent submits to OmniVault.
app.post('/sign-bet-order', (req: Request, res: Response) => {
  const { projectId, market, outcomeIndex, betAmount, minOdds, deadline, nonce } = req.body;
  if (
    projectId === undefined ||
    !market ||
    outcomeIndex === undefined ||
    betAmount === undefined ||
    minOdds === undefined ||
    deadline === undefined ||
    nonce === undefined
  ) {
    res.status(400).json({
      error: 'Missing bet order fields: projectId, market, outcomeIndex, betAmount, minOdds, deadline, nonce',
    });
    return;
  }

  const quote = generateQuote(nonce);
  const payload = JSON.stringify({
    projectId,
    market,
    outcomeIndex,
    betAmount,
    minOdds,
    deadline,
    nonce,
  });
  const signature = signPayload(Buffer.from(payload).toString('hex') as `0x${string}`);

  res.json({
    projectId,
    market,
    outcomeIndex,
    betAmount,
    minOdds,
    deadline,
    nonce,
    signature,
    quote,
  });
});

app.listen(PORT, () => {
  console.log(`WorldCup Prediction Agent running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  GET  /identity');
  console.log('  GET  /attest');
  console.log('  POST /predict');
  console.log('  POST /sign-bet-order');
});
