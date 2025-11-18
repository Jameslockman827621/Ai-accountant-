'use client';

import { useState, useEffect } from 'react';

// Simple UUID generator (in production, use uuid library)
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatDate(date: Date): string {
  const iso = date.toISOString();
  const [dateOnly] = iso.split('T');
  return dateOnly ?? iso;
}

interface AssistantWorkspaceProps {
  token: string;
  tenantId?: string;
  userId?: string;
}

interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  requiresApproval: boolean;
  isIrreversible: boolean;
  actionId?: string;
  confidenceScore?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ type: string; id: string; reference: string }>;
  toolCalls?: ToolCall[];
  confidenceScore?: number;
  reasoningTrace?: Array<{ step: string; details: unknown }>;
  timestamp: Date;
}

interface ContextSummary {
  tenantName?: string;
  currentPeriod?: { start: string; end: string };
  openTasks?: number;
  upcomingDeadlines?: Array<{ type: string; dueDate: string }>;
}

interface CitationHoverData {
  type: string;
  id: string;
  reference: string;
  content?: string;
}

type PendingApproval = {
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  confidence: number;
  requiresApproval: boolean;
  isIrreversible: boolean;
};

interface AssistantQueryResponse {
  response: {
    answer: string;
    citations?: Array<{ type: string; id: string; reference: string }>;
    toolCalls?: ToolCall[];
    confidenceScore?: number;
    reasoningTrace?: Array<{ step: string; details: unknown }>;
  };
}

type DocumentSummaryResponse = {
  content?: string;
  extracted_data?: unknown;
};

type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'citation'; content: string; citation: { type: string; id: string; reference: string } };

export default function AssistantWorkspace({ token, tenantId, userId: _userId }: AssistantWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId] = useState(() => uuidv4());
  const [contextSummary, setContextSummary] = useState<ContextSummary | null>(null);
  const [hoveredCitation, setHoveredCitation] = useState<CitationHoverData | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const activeCitation = hoveredCitation;

  // Load context summary on mount
  useEffect(() => {
    loadContextSummary();
  }, [token, tenantId]);

  const loadContextSummary = async () => {
    try {
      // In production, would fetch from API
      const now = new Date();
      const periodStart = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const periodEnd = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      const upcomingVatDue = formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      setContextSummary({
        tenantName: 'Demo Company',
        currentPeriod: {
          start: periodStart,
          end: periodEnd,
        },
        openTasks: 3,
        upcomingDeadlines: [{ type: 'VAT Return', dueDate: upcomingVatDue }],
      });
    } catch (error) {
      console.error('Failed to load context summary', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    const question = input;
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/assistant/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question,
          conversationId,
          executionMode: 'production',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = (await response.json()) as AssistantQueryResponse;
      const assistantResponse = data?.response;

      if (!assistantResponse || typeof assistantResponse.answer !== 'string') {
        throw new Error('Invalid assistant response payload');
      }

      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: assistantResponse.answer,
        ...(assistantResponse.citations && assistantResponse.citations.length > 0
          ? { citations: assistantResponse.citations }
          : {}),
        ...(assistantResponse.toolCalls && assistantResponse.toolCalls.length > 0
          ? { toolCalls: assistantResponse.toolCalls }
          : {}),
        ...(typeof assistantResponse.confidenceScore === 'number'
          ? { confidenceScore: assistantResponse.confidenceScore }
          : {}),
        ...(assistantResponse.reasoningTrace && assistantResponse.reasoningTrace.length > 0
          ? { reasoningTrace: assistantResponse.reasoningTrace }
          : {}),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Check for actions requiring approval
      const toolCalls = assistantResponse.toolCalls ?? [];
      const approvals = toolCalls
        .filter((tc) => tc.requiresApproval && tc.actionId)
        .map((tc) => ({
          actionId: tc.actionId!,
          toolName: tc.toolName,
          args: tc.args,
          result: tc.result,
          confidence: tc.confidenceScore ?? 0.8,
          requiresApproval: tc.requiresApproval,
          isIrreversible: tc.isIrreversible,
        }));

      if (approvals.length > 0) {
        setPendingApprovals((prev) => [...prev, ...approvals]);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = async (action: string) => {
    const prompts: Record<string, string> = {
      'Generate VAT pack': 'Generate the VAT return for the current period',
      'Reconcile account': 'Show me the reconciliation status for all accounts',
      'Explain variance': 'Explain any significant variances in the current period compared to last period',
    };

    const prompt = prompts[action] || action;
    setInput(prompt);
    // Auto-submit after a brief delay
    setTimeout(() => {
      const form = document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }, 100);
  };

  const handleCitationHover = async (citation: { type: string; id: string; reference: string }) => {
    // Fetch citation details
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/documents/${citation.id}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (response.ok) {
        const data = (await response.json()) as DocumentSummaryResponse;
        const snippet =
          typeof data.content === 'string' && data.content.length > 0
            ? data.content.substring(0, 200)
            : data.extracted_data
              ? JSON.stringify(data.extracted_data).substring(0, 200)
              : undefined;

        setHoveredCitation(snippet ? { ...citation, content: snippet } : { ...citation });
      } else {
        setHoveredCitation(citation);
      }
    } catch (error) {
      setHoveredCitation(citation);
    }
  };

  const handleApproveAction = async (actionId: string, comment?: string) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/assistant/actions/${actionId}/approve`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ comment }),
        }
      );

      if (response.ok) {
        setPendingApprovals((prev) => prev.filter((a) => a.actionId !== actionId));
        // Show success message
        alert('Action approved successfully');
      } else {
        throw new Error('Failed to approve action');
      }
    } catch (error) {
      alert('Failed to approve action. Please try again.');
    }
  };

  const handleRejectAction = async (actionId: string, reason: string) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/assistant/actions/${actionId}/reject`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reason }),
        }
      );

      if (response.ok) {
        setPendingApprovals((prev) => prev.filter((a) => a.actionId !== actionId));
        alert('Action rejected');
      } else {
        throw new Error('Failed to reject action');
      }
    } catch (error) {
      alert('Failed to reject action. Please try again.');
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar with context and quick actions */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Assistant Workspace</h2>
          {contextSummary && (
            <div className="mt-4 space-y-2 text-sm">
              {contextSummary.tenantName && (
                <div>
                  <span className="text-gray-500">Tenant:</span>{' '}
                  <span className="font-medium">{contextSummary.tenantName}</span>
                </div>
              )}
              {contextSummary.currentPeriod && (
                <div>
                  <span className="text-gray-500">Period:</span>{' '}
                  <span className="font-medium">
                    {new Date(contextSummary.currentPeriod.start).toLocaleDateString()} -{' '}
                    {new Date(contextSummary.currentPeriod.end).toLocaleDateString()}
                  </span>
                </div>
              )}
              {contextSummary.openTasks !== undefined && (
                <div>
                  <span className="text-gray-500">Open Tasks:</span>{' '}
                  <span className="font-medium">{contextSummary.openTasks}</span>
                </div>
              )}
              {contextSummary.upcomingDeadlines && contextSummary.upcomingDeadlines.length > 0 && (
                <div className="mt-2">
                  <span className="text-gray-500">Upcoming:</span>
                  <ul className="list-disc list-inside text-xs text-gray-600 mt-1">
                    {contextSummary.upcomingDeadlines.map((deadline, idx) => (
                      <li key={idx}>
                        {deadline.type} - {new Date(deadline.dueDate).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Quick Actions</h3>
          <div className="space-y-2">
            <button
              onClick={() => handleQuickAction('Generate VAT pack')}
              className="w-full text-left px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100 rounded-md text-blue-700"
            >
              Generate VAT pack
            </button>
            <button
              onClick={() => handleQuickAction('Reconcile account')}
              className="w-full text-left px-3 py-2 text-sm bg-green-50 hover:bg-green-100 rounded-md text-green-700"
            >
              Reconcile account
            </button>
            <button
              onClick={() => handleQuickAction('Explain variance')}
              className="w-full text-left px-3 py-2 text-sm bg-purple-50 hover:bg-purple-100 rounded-md text-purple-700"
            >
              Explain variance
            </button>
          </div>
        </div>

        {pendingApprovals.length > 0 && (
          <div className="p-4 border-b border-gray-200 flex-1 overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Pending Approvals</h3>
            <div className="space-y-2">
              {pendingApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.actionId}
                  approval={approval}
                  onApprove={handleApproveAction}
                  onReject={handleRejectAction}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 mt-8">
              <p className="text-lg font-medium mb-2">AI Assistant</p>
              <p>Ask me anything about your accounting, tax, or financial matters!</p>
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onCitationHover={handleCitationHover}
              onDocumentClick={setSelectedDocument}
            />
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-200 text-gray-900 px-4 py-2 rounded-lg">
                <p className="text-sm">Thinking...</p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 p-4 bg-white">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </div>

      {/* Citation hover card */}
      {activeCitation && (
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50 max-w-sm"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
          onMouseLeave={() => setHoveredCitation(null)}
        >
          <h4 className="font-semibold text-sm mb-2">{activeCitation.reference}</h4>
          <p className="text-xs text-gray-500 mb-1">Type: {activeCitation.type}</p>
          {activeCitation.content && (
            <p className="text-sm text-gray-700 mt-2">{activeCitation.content}</p>
          )}
          <button
            onClick={() => {
              setSelectedDocument(activeCitation.id);
              setHoveredCitation(null);
            }}
            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
          >
            Open in side panel →
          </button>
        </div>
      )}

      {/* Document side panel */}
      {selectedDocument && (
        <DocumentSidePanel documentId={selectedDocument} token={token} onClose={() => setSelectedDocument(null)} />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onCitationHover,
  onDocumentClick,
}: {
  message: Message;
  onCitationHover: (citation: { type: string; id: string; reference: string }) => void;
  onDocumentClick: (id: string) => void;
}) {
  // Parse citations from content
  const citationRegex = /\[(\d+)\]/g;
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  let match;

  if (message.citations && message.citations.length > 0) {
    while ((match = citationRegex.exec(message.content)) !== null) {
      // Add text before citation
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: message.content.substring(lastIndex, match.index) });
      }

      const matchGroup = match[1];
      if (typeof matchGroup !== 'string') {
        parts.push({ type: 'text', content: match[0] });
        lastIndex = match.index + match[0].length;
        continue;
      }

      // Add citation
      const citationIndex = parseInt(matchGroup, 10) - 1;
      const referencedCitation =
        citationIndex >= 0 && citationIndex < message.citations.length
          ? message.citations[citationIndex]
          : undefined;

      if (referencedCitation) {
        parts.push({
          type: 'citation',
          content: match[0],
          citation: referencedCitation,
        });
      } else {
        parts.push({ type: 'text', content: match[0] });
      }

      lastIndex = match.index + match[0].length;
    }
  }

  // Add remaining text
  if (lastIndex < message.content.length) {
    parts.push({ type: 'text', content: message.content.substring(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', content: message.content });
  }

  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-2xl px-4 py-3 rounded-lg ${
          message.role === 'user'
            ? 'bg-primary-600 text-white'
            : 'bg-white border border-gray-200 text-gray-900'
        }`}
      >
        <div className="text-sm whitespace-pre-wrap">
          {parts.map((part, idx) => {
            if (part.type === 'citation' && part.citation) {
              return (
                <span
                  key={idx}
                  className="underline cursor-pointer hover:bg-yellow-200 px-1 rounded"
                  onMouseEnter={() => onCitationHover(part.citation)}
                  onClick={() => onDocumentClick(part.citation.id)}
                >
                  {part.content}
                </span>
              );
            }
            return <span key={idx}>{part.content}</span>;
          })}
        </div>

        {message.confidenceScore !== undefined && (
          <div className="mt-2 text-xs opacity-75">
            Confidence: {(message.confidenceScore * 100).toFixed(0)}%
          </div>
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc, idx) => (
              <div key={idx} className="text-xs bg-gray-100 px-2 py-1 rounded">
                <span className="font-medium">{tc.toolName}</span>
                {tc.error && <span className="text-red-600 ml-2">Error: {tc.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: PendingApproval;
  onApprove: (actionId: string, comment?: string) => void;
  onReject: (actionId: string, reason: string) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [comment, setComment] = useState('');

  return (
    <>
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
        <div className="font-medium text-yellow-900 mb-1">{approval.toolName}</div>
        {approval.isIrreversible && (
          <div className="text-xs text-red-600 mb-2 font-medium">⚠️ Irreversible Action</div>
        )}
        <div className="text-xs text-gray-600 mb-2">
          Confidence: {(approval.confidence * 100).toFixed(0)}%
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowModal(true)}
            className="flex-1 px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
          >
            Review
          </button>
        </div>
      </div>

      {showModal && (
        <ApprovalModal
          approval={approval}
          comment={comment}
          onCommentChange={setComment}
          onApprove={() => {
            onApprove(approval.actionId, comment);
            setShowModal(false);
          }}
          onReject={(reason) => {
            onReject(approval.actionId, reason);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

function ApprovalModal({
  approval,
  comment,
  onCommentChange,
  onApprove,
  onReject,
  onClose,
}: {
  approval: PendingApproval;
  comment: string;
  onCommentChange: (comment: string) => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onClose: () => void;
}) {
  const [rejectReason, setRejectReason] = useState('');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Review Action</h3>

          <div className="mb-4">
            <div className="text-sm font-medium text-gray-700 mb-1">Tool: {approval.toolName}</div>
            {approval.isIrreversible && (
              <div className="text-sm text-red-600 font-medium mb-2">⚠️ This action is irreversible</div>
            )}
            <div className="text-sm text-gray-600 mb-2">Confidence: {(approval.confidence * 100).toFixed(0)}%</div>
          </div>

          <div className="mb-4">
            <div className="text-sm font-medium text-gray-700 mb-1">Arguments:</div>
            <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
              {JSON.stringify(approval.args, null, 2)}
            </pre>
          </div>

          {approval.result !== undefined && approval.result !== null && (
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-700 mb-1">Result:</div>
              <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                {JSON.stringify(approval.result, null, 2)}
              </pre>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reviewer Comment (required for irreversible actions):
            </label>
            <textarea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              rows={3}
              placeholder="Add your review comments..."
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Rejection reason</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              rows={2}
              placeholder="Optional details for rejection..."
            />
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (approval.isIrreversible && !comment.trim()) {
                  alert('Comment is required for irreversible actions');
                  return;
                }
                const reasonText = rejectReason.trim() || 'Rejected by reviewer';
                onReject(reasonText);
              }}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Reject
            </button>
            <button
              onClick={() => {
                if (approval.isIrreversible && !comment.trim()) {
                  alert('Comment is required for irreversible actions');
                  return;
                }
                onApprove();
              }}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentSidePanel({
  documentId,
  token,
  onClose,
}: {
  documentId: string;
  token: string;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/documents/${documentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setDocument(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [documentId, token]);

  return (
    <div className="w-96 bg-white border-l border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="font-semibold">Document Details</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-gray-500">Loading...</div>
        ) : document ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-gray-700">File Name</div>
              <div className="text-sm text-gray-900">{document.file_name}</div>
            </div>
            {document.extracted_data && (
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">Extracted Data</div>
                <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                  {JSON.stringify(document.extracted_data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-gray-500">Document not found</div>
        )}
      </div>
    </div>
  );
}
