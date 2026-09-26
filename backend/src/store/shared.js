// The first user message becomes the chat title, like ChatGPT.
export function makeTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return (clean.length > 40 ? clean.slice(0, 40).trim() + '…' : clean) || 'New chat';
}

// The sidebar only needs a chat's summary, not its messages.
export function summarize(chat) {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    document: chat.document ? { name: chat.document.name, chunks: chat.document.chunks } : null,
  };
}
