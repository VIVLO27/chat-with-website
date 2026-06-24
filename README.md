# Chat with a Website

A take-home assignment implementation: crawl a single website, index its content with embeddings, and answer user questions with **grounded, cited responses** powered by Google Gemini.

## Quick start

```bash
npm install
cp .env.example .env.local   # add your GEMINI_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a URL, wait for the crawl to finish, then ask questions.

> **Note:** If chat returns a model-not-found or quota error, set `GEMINI_CHAT_MODEL` in `.env.local` to a model your API key supports (check [Google AI Studio](https://aistudio.google.com)).

### Required environment variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google AI Studio API key ([get one here](https://aistudio.google.com/apikey)) |

### Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_PAGES` | `50` | Max pages to crawl per site |
| `MAX_DEPTH` | `3` | Max link depth from seed URL |
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | Model for Q&A (adjust if your key lacks access) |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Model for embeddings |

## Architecture

```
URL → BFS Crawler → HTML Cleaner → Chunker → Gemini Embeddings → Vectra Index
                                                                      ↓
User Question → Embed Query → Top-K Retrieval → Gemini Chat (grounded) → Answer + Sources
```

## Crawling strategy

- **BFS** from the seed URL, staying on the **same origin** only
- **Limits**: 50 pages max, depth 3 (configurable via env)
- **Politeness**: respects `robots.txt` via `robots-parser`, enforces ≥500ms between requests (or `Crawl-delay` if specified)
- **Fetch-only**: uses `fetch` + Cheerio — no headless browser. Static HTML sites work well; **JavaScript-rendered SPAs will not be indexed**
- **Content filter**: skips pages with <100 chars of extracted text

## Content cleaning & chunking

- **Boilerplate removal**: Mozilla Readability + stripping nav/footer/cookie banners/scripts
- **Chunking**: ~400 words per chunk, 50-word overlap, split on paragraph/sentence boundaries
- **Why overlap**: helps retrieval catch answers that span chunk boundaries (though long pages remain a weak spot — see below)

## Retrieval & grounding

- **Vector store**: simple file-backed JSON index with brute-force cosine similarity — no external DB, adequate for ≤50 pages
- **Embeddings**: Gemini `gemini-embedding-001` (768 dims), `RETRIEVAL_DOCUMENT` for index, `RETRIEVAL_QUERY` for questions
- **Retrieval**: top-5 cosine similarity; low-confidence flag when all scores < 0.35
- **Grounding**: system prompt restricts answers to retrieved context only; instructs model to say *"I couldn't find information about this on the website"* when context is insufficient
- **Citations**: source URLs/titles from retrieved chunks, deduplicated, shown under each answer

## What works well

- Static documentation sites, blogs, marketing pages with real HTML content
- Same-domain link discovery with robots.txt compliance
- Streaming chat responses with source links

## Known limitations (honest)

| Limitation | Impact | Future fix |
|------------|--------|------------|
| No JS rendering | SPAs (React/Vue client-only) return empty content | Playwright/Puppeteer pass |
| Long pages | Single-topic pages may split poorly; retrieval can miss mid-page facts | Semantic chunking, parent-child retrieval |
| In-memory vector index | Reloads from disk per query; O(n) search | pgvector or dedicated vector DB |
| Single site per session | By design for this assignment | Multi-tenant session routing |
| Embedding batching | Sequential API calls per chunk batch | Gemini batch embed API |

## Eval (basic retrieval check)

See `eval/questions.example.json` for a template of question → expected source URL pairs. Run manually after crawling a known site and compare retrieved source URLs.

## Tech stack

- **Frontend**: Next.js 16 + React 19
- **Backend**: Next.js Route Handlers (Node.js)
- **Crawl**: Cheerio, Mozilla Readability, robots-parser
- **Embeddings + LLM**: Google Gemini via `@google/genai`
- **Vector store**: JSON file index + cosine similarity

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run start    # production server
npm run lint     # ESLint
```

## Project structure

```
app/
  api/crawl/          POST — SSE crawl + index pipeline
  api/chat/           POST — SSE streaming Q&A
  components/ChatApp  Main UI
lib/
  crawler/            BFS crawl, robots, clean, chunk
  embeddings/         Gemini embeddings
  vectorstore/        JSON vector index + cosine search
  rag/                Retrieve + grounded generation
  sessions/           Session metadata persistence
  gemini/             Gemini client config
data/                 Runtime index storage (gitignored)
```
"# chat-with-website" 
