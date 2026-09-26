# Personal GPT: chat with your documents

A ChatGPT-style web app: attach a PDF, Word (.docx), TXT or Markdown file to a chat and ask questions answered only from that document, or just chat. It merges two earlier projects, **personal-gpt** (the React chat app) and **rag_project** (the grounded RAG engine).

## Features

- **Chats:** multiple chats in a sidebar, with search, auto-titles from the first message, delete, and **Clear chat** (keeps the document).
- **Documents:** one per chat. Upload replaces the previous document, and deleting the chat or document also deletes its vectors in Pinecone.
- **Grounded answers:** when a document is attached, the assistant answers only from the retrieved excerpts and says when something is not in the document. **Sources** under each answer shows the exact excerpts used.
- **Streaming:** answers type out as they arrive (Groq `openai/gpt-oss-120b`), with Markdown, tables and code blocks.
- **Small talk:** greetings and personal questions skip document search and get short, friendly replies from "Claire".
- **Follow-ups:** questions like "tell me more" or "give an example" are searched together with the previous question.
- **Privacy:** each browser gets a random session token, and chats are only visible to it.
- **Protection:** rate limits on chat, upload and chat creation; CORS limited to your frontend; 15 MB upload limit.
- **Layout:** works on phones, with light and dark mode.

## How it works

```
upload → extract text (pdf-parse, mammoth) → ~1000-char chunks, 200 overlap
       → llama-text-embed-v2 → Pinecone namespace chat-<id>, then verified

question → embed → top 5 chunks from the chat's namespace → Groq (streamed) → answer + sources
```

Chunk IDs are derived from the document's content, so re-uploading the same file overwrites instead of duplicating.

The app reads the Pinecone index's dimension and adapts. `llama-text-embed-v2` produces 384, 512, 768, 1024 or 2048 dimensions; the app uses the largest size that fits and pads with zeros up to the index size. For example, a 3000-dimensional index gets 2048 dimensions plus 952 zeros. Zero padding doesn't change cosine similarity.

## Project layout

```
backend/                 Express API (Node 22+, ES modules)
  src/server.js          starts the server
  src/app.js             routes, session tokens, rate limits, streaming
  src/prompts.js         the assistant's instructions (edit to change behaviour)
  src/rag.js             small-talk detection, retrieval, prompt building
  src/llm.js             Groq streaming client
  src/pinecone.js        embeddings, upsert/verify, query, namespace deletion
  src/ingest.js          file → chunks → vectors
  src/documents.js       text extraction and chunking
  src/store/             chats in MongoDB, or in memory when MONGODB_URI is empty
  test/                  offline tests (Pinecone and Groq are faked)
frontend/                React 19 + Redux Toolkit + Vite
```

## Setup

You need Node.js 22+, and:
- **Pinecone:** a **dense, cosine** index with at least 384 dimensions. 1024 needs no padding; larger sizes such as 3000 work with padding.
- **Groq:** an API key from https://console.groq.com/keys.
- **MongoDB:** a connection string, only for deployment. A free MongoDB Atlas cluster works.

```sh
cp backend/.env.example backend/.env      # fill in the values
cp frontend/.env.example frontend/.env    # already correct for local use
cd frontend
npm run setup             # installs frontend and backend packages
npm run --prefix ../backend check-index   # confirms the Pinecone index works
npm run dev               # starts both: API on :4000, website on http://localhost:5173
```

`npm run dev` in `frontend` uses **concurrently** to run the backend and frontend together, with labelled `[api]` and `[web]` output. Use `npm run dev:frontend` or `npm run dev:backend` to run just one.

On Windows cmd, use `copy` instead of `cp`.

## Commands

| Where | Command | What it does |
|---|---|---|
| backend | `npm run dev` | Start the API, restarting when files change |
| backend | `npm start` | Start the API (production) |
| backend | `npm test` | Offline tests |
| backend | `npm run check-index` | Check the Pinecone index and list stored chat namespaces |
| frontend | `npm run dev` | Start backend and website together |
| frontend | `npm run dev:frontend` / `dev:backend` | Start just one of them |
| frontend | `npm run setup` | Install frontend and backend packages |
| frontend | `npm run build` | Production build into `dist/` |
| frontend | `npm run lint` | Lint with oxlint |

## Deploying

1. **Database:** create a free MongoDB Atlas cluster and copy its connection string.
2. **Backend on Render:** create a new **Web Service** from this repo with:
   - Root Directory: `backend`
   - Build Command: `npm ci`
   - Start Command: `npm start`
   - Health Check Path: `/api/health`

   Then set the environment variables `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, `GROQ_API_KEY`, `MONGODB_URI`, and `CORS_ORIGIN` (your Vercel URL, e.g. `https://your-app.vercel.app`).
3. **Frontend on Vercel:** import the repo with **Root Directory** `frontend`, and set `VITE_API_URL` to `https://<your-render-service>.onrender.com/api`.

On Render's free plan the backend sleeps when idle, so the first request after a while can take about a minute.

## Troubleshooting

- **"must be dense, cosine and at least 384-dimensional":** use a dense cosine index and put its name in `PINECONE_INDEX_NAME`. `npm run check-index` shows what the index actually is.
- **"Could not reach the server":** check that the backend is running and that `VITE_API_URL` ends in `/api`.
- **"Too many requests":** you hit a rate limit or Groq's free-tier limit. Wait a few minutes.
- **Scanned PDFs:** they have no selectable text and need OCR before upload.
