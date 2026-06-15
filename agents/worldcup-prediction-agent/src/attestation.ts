/**
 * Mock TEE attestation helpers.
 *
 * In production these would call the TEE SDK (e.g. Intel TDX quote generation)
 * or 0G Compute TeeML's processResponse().
 *
 * For demo / local testing we generate deterministic mock values so the
 * OmniVault frontend and contracts can validate the shape of the data.
 */
import { keccak256, toHex } from 'viem';

const MOCK_MRENCLAVE = '0x9cffa8f573c847e8891d8c7d0a0b6d4e3f2a1c0b9d8e7f6a5b4c3d2e1f0a1b2c';
const MOCK_PUBLIC_KEY = '0xabcdef00112233445566778899aabbccddeeff00112233445566778899aabbccdd';

// Deterministic enclave private key (mock). In a real TEE this never leaves the enclave.
const MOCK_PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

export interface AttestationQuote {
  mrenclave: `0x${string}`;
  publicKey: `0x${string}`;
  timestamp: number;
  nonce: number;
  quoteSignature: `0x${string}`;
}

export function getAgentIdentity() {
  return {
    teeMrenclave: MOCK_MRENCLAVE,
    teePublicKey: MOCK_PUBLIC_KEY,
  };
}

export function generateQuote(nonce = Date.now()): AttestationQuote {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = keccak256(
    toHex(`${MOCK_MRENCLAVE}${MOCK_PUBLIC_KEY}${timestamp}${nonce}`)
  );
  // Mock signature over the payload
  const quoteSignature = keccak256(toHex(`${MOCK_PRIVATE_KEY}${payload}`));
  return {
    mrenclave: MOCK_MRENCLAVE,
    publicKey: MOCK_PUBLIC_KEY,
    timestamp,
    nonce,
    quoteSignature,
  };
}

export function signPayload(payload: `0x${string}`): `0x${string}` {
  // Mock EIP-191 style signature. In production this would be generated
  // by the private key sealed inside the TEE.
  return keccak256(toHex(`${MOCK_PRIVATE_KEY}${payload}`));
}

export function verifyQuote(quote: AttestationQuote): boolean {
  // Mock verification: check that the mrenclave matches the expected demo value.
  // In production this calls the Intel Attestation Service or 0G Compute SDK.
  return quote.mrenclave.toLowerCase() === MOCK_MRENCLAVE.toLowerCase();
}
