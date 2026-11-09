import { randomUUID } from 'node:crypto';
import { GROQ_URL, settings } from './config.js';
import { MEMORY_PROMPT } from './prompts.js';

export const MEMORY_MODEL = 'openai/gpt-oss-20b'; // Small and fast: it only picks out facts.
export const MAX_MEMORIES = 50;
const MAX_MEMORY_CHARS = 200;

// Only messages about the user can hold something worth remembering; this skips the extra AI call for the rest.
export const mayHoldMemory = message => /\b(i|i'm|im|i've|my|me|mine|remember|forget)\b/i.test(message);

// Asks a small model which facts about the user to remember or forget.
// Returns { add: string[], forget: number[] }, where forget holds 1-based positions in memories.
export async function extractMemories(message, memories, { apiKey = settings().groqApiKey, fetchImpl = fetch, signal } = {}) {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetchImpl(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({
      model: MEMORY_MODEL,
      temperature: 0,
      max_completion_tokens: 1024,
      reasoning_effort: 'low',
      include_reasoning: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: MEMORY_PROMPT },
        { role: 'user', content: JSON.stringify({ saved: memories.map((m, i) => ({ number: i + 1, text: m.text })), message }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Memory extraction failed (HTTP ${response.status}).`);
  const result = JSON.parse((await response.json()).choices?.[0]?.message?.content || '{}');
  return {
    add: (Array.isArray(result.add) ? result.add : []).filter(text => typeof text === 'string' && text.trim())
      .map(text => text.trim().slice(0, MAX_MEMORY_CHARS)),
    forget: (Array.isArray(result.forget) ? result.forget : []).filter(Number.isInteger),
  };
}

// Applies { add, forget } to the saved list. Returns the new list, or null when nothing changed.
export function applyMemoryChanges(memories, { add, forget }) {
  const kept = memories.filter((_, i) => !forget.includes(i + 1));
  const known = new Set(kept.map(m => m.text.toLowerCase()));
  const added = [];
  for (const text of add) {
    if (known.has(text.toLowerCase())) continue;
    known.add(text.toLowerCase());
    added.push({ id: randomUUID(), text, createdAt: Date.now() });
  }
  if (kept.length === memories.length && !added.length) return null;
  return [...kept, ...added].slice(-MAX_MEMORIES); // Full: the oldest facts make room.
}
