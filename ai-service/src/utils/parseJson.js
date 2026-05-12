/**
 * Robustly extract JSON from an LLM response that may contain:
 * - <think>...</think> reasoning blocks (MiniMax-M2.7, DeepSeek-R1, etc.)
 * - Markdown code fences (```json ... ```)
 * - Surrounding prose
 */
export function extractJson(text) {
  if (!text) throw new Error('Empty LLM response');

  // 1. Strip <think>...</think> reasoning blocks
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  // 3. Try cleaned string directly
  try {
    return JSON.parse(cleaned.trim());
  } catch (_) { /* fall through */ }

  // 4. Extract first {...} block (handles surrounding prose)
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch (_) {
      // 5. Last resort: strip control characters and retry
      const sanitized = objMatch[0]
        .replace(/[\x00-\x1F\x7F]/g, ' ')  // strip control chars
        .replace(/,\s*([}\]])/g, '$1');      // trailing commas
      return JSON.parse(sanitized);
    }
  }

  throw new Error(`Could not extract JSON from response: ${text.slice(0, 300)}`);
}
