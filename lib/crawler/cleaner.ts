/**
 * cleaner.ts
 * Strips HTML boilerplate (nav, footer, cookie banners, scripts, styles)
 * and returns clean, readable plain text plus metadata.
 *
 * Uses @mozilla/readability for article extraction and jsdom for parsing.
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface CleanedPage {
  title: string;
  description: string;
  text: string;
  url: string;
}

export function cleanHtml(html: string, url: string): CleanedPage {
  // Parse HTML with JSDOM
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  // Extract meta description before Readability modifies the DOM
  const metaDesc =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ||
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    '';

  // Remove elements that are noise regardless of readability
  const noiseSelectors = [
    'script', 'style', 'noscript', 'iframe',
    'nav', 'footer', 'header',
    '[class*="cookie"]', '[id*="cookie"]',
    '[class*="banner"]', '[class*="popup"]',
    '[class*="modal"]', '[class*="overlay"]',
    '[aria-hidden="true"]',
  ];
  for (const selector of noiseSelectors) {
    document.querySelectorAll(selector).forEach((el) => el.remove());
  }

  // Try Readability for article-style extraction
  let title = document.title || '';
  let text = '';

  try {
    const reader = new Readability(document.cloneNode(true) as Document, {
      charThreshold: 20,
    });
    const article = reader.parse();
    if (article && article.textContent && article.textContent.trim().length > 100) {
      title = article.title || title;
      text = article.textContent;
    }
  } catch {
    // Readability failed, fall back to body text
  }

  // Fallback: grab all body text
  if (!text || text.trim().length < 50) {
    text = document.body?.textContent || '';
  }

  // Normalize whitespace
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return {
    title: title.trim(),
    description: metaDesc.trim(),
    text,
    url,
  };
}
