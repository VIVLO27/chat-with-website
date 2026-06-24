/**
 * crawler/index.ts
 * BFS web crawler that stays within a single domain.
 *
 * Design decisions:
 * - Pure fetch + Cheerio (no Playwright) — covers the vast majority of static sites
 * - Max 50 pages or depth 3 (configurable)
 * - Respects robots.txt (RobotsChecker) + enforces ≥ 500ms between requests
 * - Emits progress events via an EventEmitter for SSE streaming to the frontend
 */

import * as cheerio from 'cheerio';
import { EventEmitter } from 'events';
import { cleanHtml, type CleanedPage } from './cleaner';
import { chunkText, type TextChunk } from './chunker';
import { RobotsChecker } from './robots';

export interface CrawlProgress {
  type: 'progress' | 'complete' | 'error';
  pagesFound: number;
  pagesCrawled: number;
  currentUrl?: string;
  message?: string;
}

export interface CrawlResult {
  chunks: TextChunk[];
  pages: { url: string; title: string }[];
}

const MAX_PAGES = parseInt(process.env.MAX_PAGES || '50', 10);
const MAX_DEPTH = parseInt(process.env.MAX_DEPTH || '3', 10);

/**
 * Normalize a URL: remove hash, trailing slash, resolve relative paths
 */
function normalizeUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    // Only http/https
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // Remove hash
    url.hash = '';
    // Remove trailing slash (except root)
    let normalized = url.href;
    if (normalized.endsWith('/') && url.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Extract all valid internal links from a page
 */
function extractLinks(html: string, pageUrl: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) return;

    // Must be same origin
    const linkOrigin = new URL(normalized).origin;
    if (linkOrigin !== origin) return;

    links.push(normalized);
  });

  return [...new Set(links)];
}

/**
 * Main crawl function. Returns all text chunks from the crawled site.
 * Progress events are emitted on the provided EventEmitter.
 */
export async function crawlSite(
  startUrl: string,
  emitter: EventEmitter
): Promise<CrawlResult> {
  const origin = new URL(startUrl).origin;
  const robots = await RobotsChecker.fromOrigin(origin);
  const crawlDelayMs = robots.getCrawlDelayMs();

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [
    { url: normalizeUrl(startUrl, startUrl) || startUrl, depth: 0 },
  ];

  const allChunks: TextChunk[] = [];
  const allPages: { url: string; title: string }[] = [];
  let pagesCrawled = 0;

  emitter.emit('progress', {
    type: 'progress',
    pagesFound: 1,
    pagesCrawled: 0,
    currentUrl: startUrl,
    message: 'Starting crawl...',
  } as CrawlProgress);

  while (queue.length > 0 && pagesCrawled < MAX_PAGES) {
    const item = queue.shift();
    if (!item) break;
    const { url, depth } = item;

    if (visited.has(url)) continue;
    visited.add(url);

    // Check robots.txt
    if (!robots.isAllowed(url)) {
      emitter.emit('progress', {
        type: 'progress',
        pagesFound: queue.length + visited.size,
        pagesCrawled,
        currentUrl: url,
        message: `Skipped (robots.txt): ${url}`,
      } as CrawlProgress);
      continue;
    }

    // Polite delay
    if (pagesCrawled > 0) {
      await delay(crawlDelayMs);
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ChatWithWebsiteBot/1.0 (polite crawler for demo purposes)', // must match robots.ts USER_AGENT
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });

      if (!response.ok) {
        emitter.emit('progress', {
          type: 'progress',
          pagesFound: queue.length + visited.size,
          pagesCrawled,
          message: `HTTP ${response.status}: ${url}`,
        } as CrawlProgress);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) continue;

      const html = await response.text();
      pagesCrawled++;

      // Clean and extract text
      const cleaned: CleanedPage = cleanHtml(html, url);

      // Only index pages with meaningful content
      if (cleaned.text.length > 100) {
        const chunks = chunkText(cleaned.text, url, cleaned.title);
        allChunks.push(...chunks);
        allPages.push({ url, title: cleaned.title });
      }

      // Discover links if not at max depth
      if (depth < MAX_DEPTH) {
        const links = extractLinks(html, url, origin);
        for (const link of links) {
          if (!visited.has(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }

      emitter.emit('progress', {
        type: 'progress',
        pagesFound: Math.min(queue.length + visited.size, MAX_PAGES),
        pagesCrawled,
        currentUrl: url,
        message: `Crawled: ${cleaned.title || url}`,
      } as CrawlProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      emitter.emit('progress', {
        type: 'progress',
        pagesFound: queue.length + visited.size,
        pagesCrawled,
        message: `Error fetching ${url}: ${msg}`,
      } as CrawlProgress);
    }
  }

  emitter.emit('progress', {
    type: 'complete',
    pagesFound: allPages.length,
    pagesCrawled,
    message: `Crawl complete. Indexed ${allPages.length} pages, ${allChunks.length} chunks.`,
  } as CrawlProgress);

  return { chunks: allChunks, pages: allPages };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
