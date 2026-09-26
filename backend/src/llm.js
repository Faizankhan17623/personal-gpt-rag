import { GROQ_URL, settings } from './config.js';
import { UserError } from './errors.js';

// Streams a Groq chat completion, calling onToken for each piece of text.
// Returns { text, truncated }. fetchImpl can be injected for tests.
export async function streamCompletion(messages, onToken, {
  apiKey = settings().groqApiKey,
  model = settings().groqModel,
  fetchImpl = fetch,
  signal,
} = {}) {
  if (!apiKey) throw new UserError('The server is missing GROQ_API_KEY.', 500);

  const response = await fetchImpl(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.3,
      max_completion_tokens: 4096,
      // GPT-OSS models reason before answering; keep that short and out of the reply.
      ...(model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
    }),
  });

  if (!response.ok) {
    // Do not expose provider response bodies: they may contain request details.
    if (response.status === 401) throw new UserError('The AI service rejected the server API key.', 502);
    if (response.status === 429) throw new UserError('The AI is getting too many requests right now. Please wait a minute and try again.', 429);
    if (response.status === 403 || response.status === 404) throw new UserError(`The AI model "${model}" is not available.`, 502);
    throw new UserError(`The AI service failed (HTTP ${response.status}). Please try again.`, 502);
  }

  let text = '';
  let finishReason = null;
  for await (const event of readServerSentEvents(response.body)) {
    if (event === '[DONE]') break;
    const choice = JSON.parse(event).choices?.[0];
    const token = choice?.delta?.content;
    if (token) {
      text += token;
      onToken(token);
    }
    finishReason = choice?.finish_reason ?? finishReason;
  }
  if (!text.trim()) throw new UserError('The AI returned an empty answer. Please try again.', 502);
  return { text, truncated: finishReason === 'length' };
}

// Yields the data payload of each server-sent event in a byte stream.
export async function* readServerSentEvents(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop();
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
}
