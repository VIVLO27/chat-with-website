/**
 * sessions/store.ts
 * In-memory session registry (survives the process lifetime).
 * Persists session metadata to disk so state recovers after restart.
 *
 * A "session" = one crawled website instance:
 *  - sessionId: UUID
 *  - url: the seed URL
 *  - status: 'crawling' | 'indexing' | 'ready' | 'error'
 *  - pages: array of { url, title } for all crawled pages
 *  - createdAt: ISO timestamp
 */

import fs from 'fs';
import path from 'path';

export type SessionStatus = 'crawling' | 'indexing' | 'ready' | 'error';

export interface Session {
  sessionId: string;
  url: string;
  status: SessionStatus;
  pages: { url: string; title: string }[];
  chunkCount: number;
  pageCount: number;
  createdAt: string;
  errorMessage?: string;
}

// On Vercel, process.cwd() is read-only; use /tmp for writable storage.
const BASE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data');
const DATA_DIR = path.join(BASE_DIR, 'sessions');
const REGISTRY_FILE = path.join(BASE_DIR, 'sessions.json');

// In-memory cache
const sessions = new Map<string, Session>();

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function persistRegistry() {
  ensureDataDir();
  const all = Array.from(sessions.values());
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(all, null, 2));
}

function loadRegistry() {
  if (fs.existsSync(REGISTRY_FILE)) {
    try {
      const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
      const all: Session[] = JSON.parse(raw);
      for (const session of all) {
        sessions.set(session.sessionId, session);
      }
    } catch {
      // Ignore corrupt registry
    }
  }
}

// Load on first import
loadRegistry();

export function createSession(sessionId: string, url: string): Session {
  const session: Session = {
    sessionId,
    url,
    status: 'crawling',
    pages: [],
    chunkCount: 0,
    pageCount: 0,
    createdAt: new Date().toISOString(),
  };
  sessions.set(sessionId, session);
  persistRegistry();
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function updateSession(sessionId: string, updates: Partial<Session>): Session | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  const updated = { ...session, ...updates };
  sessions.set(sessionId, updated);
  persistRegistry();
  return updated;
}

export function listSessions(): Session[] {
  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
  persistRegistry();
}
