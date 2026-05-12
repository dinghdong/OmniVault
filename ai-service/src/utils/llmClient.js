import OpenAI from 'openai';

let _client = null;

/**
 * Returns a singleton OpenAI-compatible client.
 * Configure via env:
 *   OPENAI_API_KEY  — required
 *   OPENAI_BASE_URL — optional, for MiniMax / other providers
 *   OPENAI_MODEL    — model name, defaults to gpt-4o
 */
export function getLLMClient() {
  if (!_client) {
    const opts = { apiKey: process.env.OPENAI_API_KEY };
    if (process.env.OPENAI_BASE_URL) {
      opts.baseURL = process.env.OPENAI_BASE_URL;
    }
    _client = new OpenAI(opts);
  }
  return _client;
}

export const DEFAULT_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o';
