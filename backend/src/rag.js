import { TOP_K, HISTORY_MESSAGES } from './config.js';
import { PERSONA_PROMPT, DOCUMENT_PROMPT, GENERAL_PROMPT, SMALL_TALK_PROMPT } from './prompts.js';

// Greetings, thanks and questions about the assistant skip document search.
export function isSmallTalk(message) {
  const text = message.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const polite = '( (sir|bro|there|friend|claire|mam|maam))*';
  return [
    /^(hi|hello|hey|helo|hii|hiya|yo|good morning|good evening|good afternoon|good night)/,
    /^(thanks|thank you|thankyou|thanks a lot|ok|okay|cool|nice|great|bye|goodbye)/,
    /^how are you( doing)?/,
    /^(who are you|what is your name|whats your name|what can you do)/,
  ].some(pattern => new RegExp(pattern.source + polite + '$').test(text));
}

// Short follow-ups are searched together with the previous question.
export function isFollowUp(message) {
  return /^(and\b|also\b|what about\b|give (me )?(an |another |more )?examples?\b|tell me more\b|explain (it|that|them|more)\b|why\s*[?!.]*$|how so\b|more\b)/i.test(message.trim());
}

// Removes citation marks the model may add; the UI shows sources separately.
export function cleanAnswer(text) {
  return text
    .replace(/【[^】]*】/g, '')
    .replace(/ ?\[(?:source |excerpt |chunk )?\d+(?:\s*[,–-]\s*\d+)*\]/gi, '')
    .replace(/[ \t]+\n/g, '\n');
}

// Finds the chunks most relevant to the message. previousQuestion helps follow-ups.
export async function retrieveSources(vectors, namespace, message, previousQuestion = '') {
  const query = previousQuestion ? `${previousQuestion.slice(0, 1000)}\n${message}` : message;
  const [vector] = await vectors.embed([query], 'query');
  const matches = await vectors.query(namespace, vector, TOP_K);
  return matches
    .filter(match => typeof match.metadata?.text === 'string' && match.metadata.text.trim())
    .map((match, i) => ({
      number: i + 1,
      chunk: Number(match.metadata.chunkIndex) + 1,
      score: Number(match.score?.toFixed?.(4) ?? match.score),
      text: match.metadata.text.slice(0, 1500),
    }));
}

// Builds the Groq message list for one turn.
export function buildMessages({ message, history, sources, smallTalk, hasDocument }) {
  const mode = smallTalk ? SMALL_TALK_PROMPT : hasDocument ? DOCUMENT_PROMPT : GENERAL_PROMPT;
  const content = hasDocument && !smallTalk
    ? JSON.stringify({ question: message, documentExcerpts: sources.map(({ number, text }) => ({ number, text })) })
    : message;
  return [
    { role: 'system', content: PERSONA_PROMPT },
    { role: 'system', content: mode },
    ...history.slice(-HISTORY_MESSAGES).map(({ role, content }) => ({ role, content })),
    { role: 'user', content },
  ];
}
