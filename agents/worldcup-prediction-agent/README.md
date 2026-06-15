# World Cup Prediction Agent (Test)

A simple mock prediction agent for the OmniVault World Cup betting demo.

This agent is designed to show how an AI Agent can:

1. Expose a stable TEE identity (`teeMrenclave` + `teePublicKey`).
2. Generate a fresh attestation quote on demand.
3. Predict match outcomes.
4. Sign a `BetOrder` for OmniVault execution.

## ⚠️ Not Production Ready

All attestation and signatures in this agent are **mock values** for local testing.
In production the agent would run inside a real TEE (Intel TDX, AWS Nitro, etc.)
and use the 0G Compute TeeML serving broker for verified inference.

## Install

```bash
cd agents/worldcup-prediction-agent
npm install
```

## Run

```bash
npm run dev
```

Server starts at `http://localhost:4000`.

## Endpoints

### `GET /identity`

Returns the stable TEE identity that should be stored in the NFA metadata.

```json
{
  "teeMrenclave": "0x9cffa8f573c847e8891d8c7d0a0b6d4e3f2a1c0b9d8e7f6a5b4c3d2e1f0a1b2c",
  "teePublicKey": "0xabcdef00112233445566778899aabbccddeeff00112233445566778899aabbccdd"
}
```

### `GET /attest`

Returns a fresh mock attestation quote.

### `POST /predict`

Request:

```json
{
  "home": "Argentina",
  "away": "France",
  "homeOdds": 2.1,
  "drawOdds": 3.4,
  "awayOdds": 3.6
}
```

Response:

```json
{
  "match": { ... },
  "prediction": {
    "outcomeIndex": 0,
    "confidence": 78,
    "reasoning": "..."
  },
  "quote": { ... },
  "signature": "0x..."
}
```

### `POST /sign-bet-order`

Request:

```json
{
  "projectId": 6,
  "market": "0x...",
  "outcomeIndex": 0,
  "betAmount": "1000000000000000000",
  "minOdds": "1900000000000000000",
  "deadline": 1700000000,
  "nonce": 42
}
```

Response:

```json
{
  "projectId": 6,
  "market": "0x...",
  "outcomeIndex": 0,
  "betAmount": "1000000000000000000",
  "minOdds": "1900000000000000000",
  "deadline": 1700000000,
  "nonce": 42,
  "signature": "0x...",
  "quote": { ... }
}
```

## Migrating to Real 0G Compute TeeML

Replace the mock functions in `src/attestation.ts` with:

1. **Attestation quote generation**: call the TEE SDK inside the enclave.
2. **Signature generation**: use the enclave-sealed private key.
3. **Inference**: route `/predict` through `@0glabs/0g-serving-broker` to a TeeML provider.

The contract-facing data shape (`quote`, `signature`, `teeMrenclave`, `teePublicKey`) stays the same.
