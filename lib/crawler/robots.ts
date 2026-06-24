/**
 * robots.ts
 * Fetches and parses robots.txt using robots-parser.
 */

import robotsParser from 'robots-parser';

const USER_AGENT = 'ChatWithWebsiteBot/1.0 (polite crawler for demo purposes)';

export class RobotsChecker {
  private parser: ReturnType<typeof robotsParser> | null = null;

  static async fromOrigin(origin: string): Promise<RobotsChecker> {
    const checker = new RobotsChecker();
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const text = await res.text();
        checker.parser = robotsParser(`${origin}/robots.txt`, text);
      }
    } catch {
      // If robots.txt is unreachable, assume everything is allowed
    }
    return checker;
  }

  isAllowed(url: string): boolean {
    if (!this.parser) return true;
    return this.parser.isAllowed(url, USER_AGENT) ?? true;
  }

  getCrawlDelayMs(): number {
    if (!this.parser) return 500;
    const delaySec = this.parser.getCrawlDelay(USER_AGENT) ?? 0;
    return Math.max(delaySec * 1000, 500);
  }
}
