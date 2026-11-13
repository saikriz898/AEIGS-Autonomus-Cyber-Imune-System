'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  LoaderCircle,
  MessageSquare,
  Plus,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { date, label, request, type Row } from '../lib/api';
import { Badge, Field, Header, Notice, Panel } from './UI';

type RecordContext = { context_type?: string; context_id?: string };
type Props = {
  workspaceId: string;
  userName: string;
  csrf: string;
  canWrite: boolean;
  history?: boolean;
  onOpen: (kind: string, id: string) => void;
};

export default function AssistantConsole({
  workspaceId,
  userName,
  csrf,
  canWrite,
  history = false,
  onOpen,
}: Props) {
  const [status, setStatus] = useState<any>(null);
  const [mode, setMode] = useState<'guide' | 'provider'>('guide');
  const [conversations, setConversations] = useState<Row[]>([]);
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<Row[]>([]);
  const [content, setContent] = useState('');
  const [context, setContext] = useState<RecordContext>({});
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const base = `/workspaces/${workspaceId}/assistant`;
  const configured = Boolean(status?.configured);

  useEffect(() => {
    alive.current = true;
    let active = true;
    Promise.all([request(`${base}/status`), request<Row[]>(`${base}/conversations`)])
      .then(([provider, saved]) => {
        if (!active) return;
        setStatus(provider);
        setConversations(saved);
        setMode(provider.configured ? 'provider' : 'guide');
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    try {
      const stored = sessionStorage.getItem('aegis.chat-context');
      if (stored) {
        setContext(JSON.parse(stored));
        sessionStorage.removeItem('aegis.chat-context');
      }
    } catch {
      /* Browser storage is optional. */
    }
    return () => {
      active = false;
      alive.current = false;
      generation.current++;
    };
  }, [base]);

  async function loadConversation(id: string) {
    const version = ++generation.current;
    setSelected(id);
    setMessages([]);
    setLoading(true);
    setError('');
    try {
      const saved = await request(`${base}/conversations/${id}`);
      if (alive.current && generation.current === version) {
        setMessages(saved.messages || []);
        setMode(
          saved.conversation?.mode === 'workspace_guide' ||
            saved.conversation?.title?.startsWith('[Workspace guide]')
            ? 'guide'
            : 'provider',
        );
      }
    } catch (e) {
      if (alive.current && generation.current === version) setError((e as Error).message);
    } finally {
      if (alive.current && generation.current === version) setLoading(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!content.trim() || sending || !canWrite || (mode === 'provider' && !configured)) return;
    const question = content.trim();
    const version = ++generation.current;
    let id = selected;
    setSending(true);
    setError('');
    try {
      if (mode === 'guide') {
        const result = await request(`${base}/guide`, {
          method: 'POST',
          csrf,
          body: { content: question, ...(id ? { conversation_id: id } : {}), ...context },
        });
        id = result.conversation.id;
      } else {
        if (!id) {
          const saved = await request(`${base}/conversations`, {
            method: 'POST',
            csrf,
            body: { title: question.slice(0, 80) },
          });
          id = saved.id;
        }
        await request(`${base}/conversations/${id}/messages`, {
          method: 'POST',
          csrf,
          body: { content: question, ...context },
        });
      }
      const [saved, list] = await Promise.all([
        request(`${base}/conversations/${id}`),
        request<Row[]>(`${base}/conversations`),
      ]);
      if (!alive.current || generation.current !== version) return;
      setSelected(id);
      setMessages(saved.messages || []);
      setConversations(list);
      setContent('');
    } catch (e) {
      if (!alive.current || generation.current !== version) return;
      setError((e as Error).message);
      if (id) {
        try {
          const [saved, list] = await Promise.all([
            request(`${base}/conversations/${id}`),
            request<Row[]>(`${base}/conversations`),
          ]);
          if (alive.current && generation.current === version) {
            setSelected(id);
            setMessages(saved.messages || []);
            setConversations(list);
          }
        } catch {
          /* Keep the original actionable request error. */
        }
      }
    } finally {
      if (alive.current && generation.current === version) setSending(false);
    }
  }

  const recordKinds: Record<string, string> = {
    assets: 'assets',
    findings: 'findings',
    events: 'events',
    simulations: 'simulations',
    recommendations: 'recommendations',
    datasets: 'datasets',
    reports: 'reports',
  };

  return (
    <>
      <Header
        eyebrow="READ-ONLY WORKSPACE ASSISTANCE"
        title={history ? 'Conversation History' : 'AI Assistant'}
        description="Choose a connected language model or the built-in guide. Saved conversations stay private to your account and workspace."
      >
        <Badge tone={configured ? 'green' : 'amber'}>
          {configured
            ? `${label(status.provider)} model configured`
            : 'Language model not configured'}
        </Badge>
      </Header>
      <Notice>
        {mode === 'guide'
          ? 'Workspace guide uses fixed rules and recorded evidence. It is available locally without a language model; it cannot provide general AI reasoning.'
          : status?.reason || 'Checking the backend model configuration…'}{' '}
        All answers are advisory. Actions, permissions, and risk scores remain controlled by AEGIS.
      </Notice>
      <div className="chat-layout">
        <Panel title="Conversations" subtitle="Your saved questions and responses">
          <Field label="Assistance mode">
            <select
              value={mode}
              disabled={sending}
              onChange={(e) => {
                generation.current++;
                setMode(e.target.value as 'guide' | 'provider');
                setSelected('');
                setMessages([]);
                setError('');
                setLoading(false);
              }}
            >
              <option value="guide">Workspace guide (no LLM)</option>
              <option value="provider">AI language model</option>
            </select>
          </Field>
          <button
            className="button secondary full"
            disabled={sending}
            onClick={() => {
              generation.current++;
              setSelected('');
              setMessages([]);
              setContext({});
              setError('');
              setLoading(false);
            }}
          >
            <Plus size={15} />
            New conversation
          </button>
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                disabled={sending}
                className={selected === conversation.id ? 'active' : ''}
                onClick={() => void loadConversation(conversation.id)}
              >
                <MessageSquare size={15} />
                <span>
                  {conversation.title}
                  <small>{date(conversation.updated_at || conversation.created_at)}</small>
                </span>
              </button>
            ))}
            {!conversations.length && (
              <p className="section-note">No saved conversations. Send a question to begin.</p>
            )}
          </div>
          <dl className="details-list">
            <div>
              <dt>Guide</dt>
              <dd>Local rules · no LLM</dd>
            </div>
            <div>
              <dt>AI provider</dt>
              <dd>{label(status?.provider || 'none')}</dd>
            </div>
            <div>
              <dt>AI model</dt>
              <dd>{status?.model || 'Not configured'}</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>
                {status?.live_connection_verified
                  ? 'Verified response'
                  : 'Verified when a message succeeds'}
              </dd>
            </div>
          </dl>
          {!configured && (
            <p className="section-note">
              {status?.reason || 'No server-side model is configured.'} Configure the provider in
              the backend environment, then restart the API.
            </p>
          )}
          <a className="button secondary full" href="#/settings">
            Provider settings
            <ArrowRight size={15} />
          </a>
        </Panel>
        <Panel
          title={conversations.find((c) => c.id === selected)?.title || 'Ask about your workspace'}
          subtitle={
            mode === 'guide'
              ? 'Deterministic guide · local evidence only'
              : `Language model · ${status?.model || 'not configured'}`
          }
          className="chat-panel"
        >
          <div className="chat-messages" aria-live="polite" aria-busy={loading || sending}>
            {loading ? (
              <p className="muted">
                <LoaderCircle className="spin" size={17} /> Loading saved messages…
              </p>
            ) : messages.length ? (
              messages.map((message) => {
                const guide =
                  message.role === 'assistant' && message.content.startsWith('Workspace guide');
                return (
                  <article key={message.id} className={`chat-message ${message.role}`}>
                    <span>
                      {message.role === 'user' ? (
                        <User size={17} />
                      ) : guide ? (
                        <BookOpen size={17} />
                      ) : (
                        <Sparkles size={17} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {message.role === 'user'
                          ? userName
                          : guide
                            ? 'Workspace guide · no LLM'
                            : 'AI model response'}
                      </strong>
                      <p>{message.content}</p>
                      {message.references?.length > 0 && (
                        <div className="reference-chips">
                          {message.references.map((ref: any, index: number) =>
                            recordKinds[ref.record_type] ? (
                              <button
                                key={index}
                                className="badge blue"
                                onClick={() => onOpen(recordKinds[ref.record_type], ref.id)}
                              >
                                {label(ref.record_type)} · {ref.id.slice(0, 12)}
                                <ArrowRight size={12} />
                              </button>
                            ) : (
                              <Badge key={index} tone="blue">
                                {ref.id}
                              </Badge>
                            ),
                          )}
                        </div>
                      )}
                      <small>{date(message.created_at)}</small>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="chat-welcome">
                <span>
                  <BookOpen size={27} />
                </span>
                <h3>Start with recorded evidence.</h3>
                <p>
                  Summarize risk, review defensive recommendations, or find the exact blockers
                  before model training.
                </p>
                <div>
                  {[
                    'Why is model training blocked?',
                    'Summarize workspace risk.',
                    'Which defensive recommendations need review?',
                  ].map((prompt) => (
                    <button key={prompt} onClick={() => setContent(prompt)}>
                      {prompt}
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sending && (
              <p className="section-note" role="status">
                <LoaderCircle className="spin" size={16} />
                {mode === 'guide'
                  ? 'Reading authorized workspace records…'
                  : 'Waiting for the configured model. CPU inference may take a minute…'}
              </p>
            )}
          </div>
          {context.context_id && (
            <div className="chat-context">
              <Badge tone="blue">
                Context: {context.context_type} · {context.context_id.slice(0, 12)}
              </Badge>
              <button
                className="icon-button"
                aria-label="Remove record context"
                onClick={() => setContext({})}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {mode === 'provider' && !configured && (
            <Notice>
              AI messages need a running, configured language model. Select Workspace guide to ask
              about local records now.
            </Notice>
          )}
          {!canWrite && (
            <Notice>
              Your Viewer role can read your history. An Analyst, Admin, or Owner role is required
              to send questions.
            </Notice>
          )}
          <form className="chat-composer" onSubmit={send}>
            <textarea
              aria-label="Message the assistant"
              rows={3}
              maxLength={6000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                mode === 'guide'
                  ? 'Ask about risk, assets, recommendations, or training readiness…'
                  : 'Ask the connected model about authorized records…'
              }
            />
            <div>
              <small>
                {mode === 'guide'
                  ? 'Fixed rules, no language model'
                  : 'AI-generated text requires analyst review'}{' '}
                · no infrastructure actions
              </small>
              <button
                className="button primary small"
                disabled={
                  sending ||
                  loading ||
                  !canWrite ||
                  !content.trim() ||
                  (mode === 'provider' && !configured)
                }
              >
                {sending ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={16} />}
                Send
              </button>
            </div>
          </form>
        </Panel>
      </div>
    </>
  );
}
