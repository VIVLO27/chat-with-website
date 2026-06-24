'use client';

import { useRef, useState, useCallback } from 'react';
import {
  Globe, Send, CheckCircle2, AlertTriangle, AlertCircle,
  Sparkles, Bot, User, Link2, Loader2, Zap
} from 'lucide-react';
import styles from './ChatApp.module.css';

interface Source { url: string; title: string; }
interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  lowConfidence?: boolean;
  streaming?: boolean;
}

const HINT_QUESTIONS = [
  'What is this site about?',
  'Summarize the main topics',
  'Who created this?',
  'What are the key features?',
];

export default function ChatApp() {
  const [url, setUrl]             = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus]       = useState<'idle' | 'crawling' | 'ready' | 'error'>('idle');
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  /* ---- CRAWL ---- */
  const handleCrawl = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setStatus('crawling');
    setError(null);
    setProgressLog([]);
    setMessages([]);
    setSessionId(null);

    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start crawl');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'progress' && event.message) {
            setProgressLog((prev) => [...prev.slice(-25), event.message]);
          }
          if (event.type === 'complete') {
            setSessionId(event.sessionId);
            setStatus('ready');
            setProgressLog((prev) => [...prev, event.message]);
          }
          if (event.type === 'error') {
            setStatus('error');
            setError(event.message);
          }
        }
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Crawl failed');
    }
  };

  /* ---- SEND ---- */
  const handleSend = async (question?: string) => {
    const q = (question ?? input).trim();
    if (!q || !sessionId || isStreaming) return;

    setInput('');
    setIsStreaming(true);
    setError(null);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: q }]);

    // Use refs to accumulate streaming state without triggering immutability lint
    const contentRef = { current: '' };
    const sourcesRef: { current: Source[] } = { current: [] };
    const lowConfRef = { current: false };

    setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);
    scrollToBottom();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, question: q, history }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Chat request failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'meta') {
            sourcesRef.current = event.sources || [];
            lowConfRef.current = event.lowConfidence || false;
          }
          if (event.type === 'text') {
            contentRef.current += event.text;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant', content: contentRef.current,
                sources: sourcesRef.current, lowConfidence: lowConfRef.current, streaming: true,
              };
              return updated;
            });
            scrollToBottom();
          }
          if (event.type === 'done') {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant', content: contentRef.current,
                sources: sourcesRef.current, lowConfidence: lowConfRef.current, streaming: false,
              };
              return updated;
            });
          }
          if (event.type === 'error') throw new Error(event.message);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat failed';
      setError(msg);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant', content: `⚠️ ${msg}`, streaming: false,
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className={styles.container}>
      {/* ---- HEADER ---- */}
      <header className={styles.header}>
        <div className={styles.headerBadge}>
          <Zap size={11} />
          RAG · Retrieval-Augmented Generation
        </div>
        <h1>Chat with any Website</h1>
        <p>Paste a URL, crawl it in seconds, then ask questions grounded in its exact content — with citations.</p>
      </header>

      {/* ---- CRAWL SECTION ---- */}
      <section className={styles.crawlSection}>
        <div className={styles.urlRow}>
          <div className={styles.urlInputWrap}>
            <Globe className={styles.urlInputIcon} />
            <input
              id="url-input"
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCrawl(); }}
              disabled={status === 'crawling'}
              className={styles.urlInput}
              autoComplete="off"
            />
          </div>
          <button
            id="crawl-btn"
            onClick={handleCrawl}
            disabled={status === 'crawling' || !url.trim()}
            className={styles.primaryBtn}
          >
            {status === 'crawling' ? (
              <><Loader2 size={15} style={{ display:'inline', marginRight:'6px', animation:'spin 1s linear infinite' }} />Crawling…</>
            ) : (
              <><Sparkles size={14} style={{ display:'inline', marginRight:'6px' }} />Crawl Site</>
            )}
          </button>
        </div>

        {/* Progress log */}
        {progressLog.length > 0 && (
          <div className={styles.progressLog} id="progress-log">
            {progressLog.map((line, i) => (
              <div key={i} className={styles.progressLine}>{line}</div>
            ))}
          </div>
        )}

        {/* Animated dots while crawling */}
        {status === 'crawling' && (
          <div className={styles.crawlingIndicator}>
            <div className={styles.crawlDot} />
            <div className={styles.crawlDot} />
            <div className={styles.crawlDot} />
            <span>Fetching &amp; embedding pages…</span>
          </div>
        )}

        {/* Ready badge */}
        {status === 'ready' && sessionId && (
          <div className={styles.readyBadge} id="ready-badge">
            <CheckCircle2 size={16} />
            Index ready — ask anything below
            <div className={styles.sessionChip} style={{ marginLeft: 'auto' }}>
              <div className={styles.sessionDot} />
              Session active
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className={styles.error} id="crawl-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
      </section>

      {/* ---- CHAT SECTION ---- */}
      {status === 'ready' && (
        <section className={styles.chatSection} id="chat-section">
          {/* macOS-style titlebar */}
          <div className={styles.chatHeader}>
            <div className={styles.chatHeaderDot} />
            <div className={styles.chatHeaderDot} />
            <div className={styles.chatHeaderDot} />
            <span className={styles.chatHeaderTitle}>
              <Bot size={11} style={{ display:'inline', marginRight:'4px' }} />
              AI Chat
            </span>
          </div>

          {/* Messages */}
          <div className={styles.messages} id="messages-list">
            {messages.length === 0 && (
              <div className={styles.placeholder} id="chat-placeholder">
                <div className={styles.placeholderIcon}>✨</div>
                <p>Ask anything about the crawled website.</p>
                <div className={styles.placeholderHints}>
                  {HINT_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      className={styles.placeholderHint}
                      onClick={() => handleSend(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                id={`msg-${i}`}
                className={`${styles.message} ${msg.role === 'user' ? styles.userMsg : styles.assistantMsg}`}
              >
                <div className={styles.messageRole}>
                  {msg.role === 'user' ? (
                    <><User size={11} className={styles.roleIcon} />You</>
                  ) : (
                    <><Bot size={11} className={styles.roleIcon} />Assistant</>
                  )}
                </div>
                <div className={styles.messageBubble}>
                  <div className={`${styles.messageContent} ${msg.streaming ? styles.streamingCursor : ''}`}>
                    {msg.content || (msg.streaming ? '' : '…')}
                  </div>

                  {msg.sources && msg.sources.length > 0 && (
                    <div className={styles.sources}>
                      <div className={styles.sourcesLabel}>
                        <Link2 size={11} />Sources
                      </div>
                      {msg.sources.map((s) => (
                        <a
                          key={s.url}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.sourceLink}
                          title={s.url}
                        >
                          {s.title || s.url}
                        </a>
                      ))}
                    </div>
                  )}

                  {msg.lowConfidence && (
                    <div className={styles.lowConfidence}>
                      <AlertTriangle size={12} />
                      Low confidence — answer may not be on this site
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input row */}
          <div className={styles.inputRow}>
            <div className={styles.inputWrap}>
              <textarea
                id="chat-input"
                placeholder="Ask a question about the website…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                rows={1}
                className={styles.chatInput}
              />
            </div>
            <button
              id="send-btn"
              onClick={() => handleSend()}
              disabled={isStreaming || !input.trim()}
              className={`${styles.sendBtn} ${isStreaming ? styles.streaming : ''}`}
              aria-label="Send message"
            >
              {isStreaming
                ? <div className={styles.spinnerRing} />
                : <Send size={18} />
              }
            </button>
          </div>
        </section>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
