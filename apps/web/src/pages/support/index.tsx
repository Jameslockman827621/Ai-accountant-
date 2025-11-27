import React, { useEffect, useMemo, useState } from 'react';
import { KnowledgeArticle, searchKnowledgeArticles, getFeaturedKnowledgeArticles } from '@ai-accountant/shared-utils/knowledge';

interface CaseSummary {
  id: string;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  channel: 'chat' | 'email' | 'portal';
  slaDue: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const cannedResponses = [
  'Thanks for reaching out! I am reviewing your request and will follow up shortly.',
  'Can you please provide the latest bank statements so we can reconcile this item?',
  'We have created a case and assigned it to our accounting pod. Expect an update within your SLA window.',
];

const initialCases: CaseSummary[] = [
  {
    id: 'CASE-1024',
    subject: 'Upload payroll CSV failed',
    status: 'in_progress',
    priority: 'high',
    channel: 'chat',
    slaDue: 'Response due in 45m',
  },
  {
    id: 'CASE-1025',
    subject: 'Need Q2 compliance checklist',
    status: 'open',
    priority: 'medium',
    channel: 'email',
    slaDue: 'Response due in 2h',
  },
];

const SupportCenterPage: React.FC = () => {
  const [cases, setCases] = useState<CaseSummary[]>(initialCases);
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      role: 'assistant',
      content: 'Hi there! Tell me about the issue and I will draft a response for your client.',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [knowledgeQuery, setKnowledgeQuery] = useState('SLA');
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeArticle[]>(getFeaturedKnowledgeArticles());
  const [emailForm, setEmailForm] = useState({ name: '', email: '', subject: '', description: '' });
  const [selectedCaseId, setSelectedCaseId] = useState<string>('CASE-1024');

  const supportApiBase = process.env.NEXT_PUBLIC_SUPPORT_API_BASE || '/api/support';

  const selectedCase = useMemo(() => cases.find(c => c.id === selectedCaseId) || cases[0], [cases, selectedCaseId]);

  const searchKnowledge = async (query: string) => {
    try {
      const response = await fetch(
        `${supportApiBase}/knowledge/runbooks?q=${encodeURIComponent(query)}&limit=5`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = (await response.json()) as { results: KnowledgeArticle[] };
      setKnowledgeResults(data.results);
    } catch (_error) {
      setKnowledgeResults(searchKnowledgeArticles(query, { limit: 5 }));
    }
  };

  useEffect(() => {
    searchKnowledge(knowledgeQuery);
  }, []);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const now = new Date().toISOString();
    const userMessage: ConversationMessage = { role: 'user', content: input, timestamp: now };
    setMessages(prev => [...prev, userMessage]);
    setInput('');

    try {
      const response = await fetch(`${supportApiBase}/cases/${selectedCase?.id}/ai-response`);
      if (!response.ok) throw new Error('assistant unavailable');
      const data = (await response.json()) as { response: string };

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.response,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (_error) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Here is a suggested reply based on our knowledge base: we are reviewing your file and will meet the SLA window.',
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  };

  const submitEmailIntake = async () => {
    if (!emailForm.email || !emailForm.subject || !emailForm.description) return;

    try {
      await fetch(`${supportApiBase}/cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: emailForm.subject,
          description: emailForm.description,
          customerEmail: emailForm.email,
          customerName: emailForm.name,
          channel: 'email',
          priority: 'medium',
        }),
      });
    } catch (error) {
      console.error(error);
    }

    setCases(prev => [
      {
        id: `CASE-${Math.floor(Math.random() * 10000)}`,
        subject: emailForm.subject,
        status: 'open',
        priority: 'medium',
        channel: 'email',
        slaDue: 'Response due in 2h',
      },
      ...prev,
    ]);

    setEmailForm({ name: '', email: '', subject: '', description: '' });
  };

  const renderStatusBadge = (status: CaseSummary['status']) => {
    const colors: Record<CaseSummary['status'], string> = {
      open: 'bg-amber-100 text-amber-800',
      in_progress: 'bg-blue-100 text-blue-800',
      resolved: 'bg-emerald-100 text-emerald-800',
      closed: 'bg-gray-100 text-gray-800',
    };

    return <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[status]}`}>{status.replace('_', ' ')}</span>;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Support Center</p>
            <h1 className="text-3xl font-bold text-slate-900">Resolve issues faster with AI + SLAs</h1>
            <p className="mt-2 text-slate-600">
              Capture inbound requests via chat or email, track SLA commitments, and draft AI-powered responses
              backed by your runbooks.
            </p>
          </div>
          <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">SLA coverage</p>
            <p className="text-xs text-slate-500">95% tickets responded within target</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Conversation</h2>
              {selectedCase && (
                <div className="text-sm text-slate-600">
                  {selectedCase.subject} • {selectedCase.slaDue}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
                {messages.map((message, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div
                      className={`mt-1 h-2 w-2 rounded-full ${message.role === 'assistant' ? 'bg-indigo-500' : 'bg-emerald-500'}`}
                    />
                    <div className="flex-1">
                      <p className="text-xs uppercase tracking-wide text-slate-500">{message.role}</p>
                      <p className="text-sm text-slate-800">{message.content}</p>
                      <p className="text-[11px] text-slate-400">{new Date(message.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Type a reply or ask the assistant to draft one..."
                    className="flex-1 rounded-lg border border-slate-200 p-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
                    rows={2}
                  />
                  <button
                    onClick={sendMessage}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700"
                  >
                    Ask assistant
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                  {cannedResponses.map(response => (
                    <button
                      key={response}
                      onClick={() => setInput(response)}
                      className="rounded-full border border-slate-200 px-3 py-1 hover:border-indigo-500 hover:text-indigo-600"
                    >
                      {response}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Open cases</h3>
                  <button
                    className="text-xs font-semibold text-indigo-600"
                    onClick={() => setSelectedCaseId(cases[0]?.id || selectedCaseId)}
                  >
                    Refresh
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {cases.map(item => (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-3 ${
                        selectedCaseId === item.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.subject}</p>
                          <p className="text-xs text-slate-500">
                            {item.id} • {item.channel.toUpperCase()} • {item.slaDue}
                          </p>
                        </div>
                        {renderStatusBadge(item.status)}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Priority: {item.priority}</p>
                      <button
                        onClick={() => setSelectedCaseId(item.id)}
                        className="mt-2 text-xs font-semibold text-indigo-600"
                      >
                        Open conversation
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Email intake</h3>
                <p className="text-xs text-slate-600">Log emails into triaged cases with SLA timers.</p>
                <div className="mt-3 space-y-3">
                  <input
                    value={emailForm.name}
                    onChange={e => setEmailForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Contact name"
                    className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    value={emailForm.email}
                    onChange={e => setEmailForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="Contact email"
                    className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-indigo-500 focus:outline-none"
                    type="email"
                  />
                  <input
                    value={emailForm.subject}
                    onChange={e => setEmailForm(prev => ({ ...prev, subject: e.target.value }))}
                    placeholder="Subject"
                    className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <textarea
                    value={emailForm.description}
                    onChange={e => setEmailForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Description"
                    className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-indigo-500 focus:outline-none"
                    rows={3}
                  />
                  <button
                    onClick={submitEmailIntake}
                    className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700"
                  >
                    Create case from email
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Runbooks & FAQs</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">Searchable</span>
              </div>
              <div className="mt-3 space-y-2">
                <input
                  value={knowledgeQuery}
                  onChange={e => setKnowledgeQuery(e.target.value)}
                  onBlur={() => searchKnowledge(knowledgeQuery)}
                  placeholder="Search runbooks, FAQs, how-tos"
                  className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <div className="space-y-3">
                  {knowledgeResults.map(article => (
                    <div key={article.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-sm font-semibold text-slate-900">{article.title}</p>
                      <p className="text-xs text-slate-600">{article.content}</p>
                      <p className="mt-1 text-[11px] uppercase text-slate-500">{article.category}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Canned responses</h3>
              <p className="text-xs text-slate-600">Drop directly into chat or email.</p>
              <div className="mt-3 space-y-2">
                {cannedResponses.map(response => (
                  <button
                    key={response}
                    onClick={() => setInput(response)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-indigo-500 hover:text-indigo-600"
                  >
                    {response}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Status tracking</h3>
              <p className="text-xs text-slate-600">Live SLA indicators for every channel.</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                <li>• Chat: 12 active, 95% within SLA</li>
                <li>• Email: 8 active, 92% within SLA</li>
                <li>• Portal: 4 active, 100% within SLA</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupportCenterPage;
