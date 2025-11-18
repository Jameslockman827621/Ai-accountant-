'use client';

import { useState, useEffect } from 'react';

interface ComplianceModeProps {
  token: string;
  tenantId?: string;
  userId?: string;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    error?: string;
    actionId?: string;
    status?: 'pending' | 'completed' | 'failed';
  }>;
  reasoningTrace?: Array<{ step: string; details: unknown }>;
}

interface ToolActionLog {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: string;
  timestamp: Date;
  approvedBy?: string;
  approvedAt?: Date;
}

interface FilingExplanation {
  field: string;
  value: unknown;
  calculation: string;
  rules: string[];
  sourceEntries: string[];
}

export default function ComplianceMode({ token, tenantId: tenantIdProp, userId: _userId }: ComplianceModeProps) {
    const tenantId = tenantIdProp;
  const [conversations, setConversations] = useState<Array<{ id: string; messages: ConversationMessage[] }>>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [toolActionLogs, setToolActionLogs] = useState<ToolActionLog[]>([]);
  const [selectedFiling, setSelectedFiling] = useState<string | null>(null);
  const [filingExplanations, setFilingExplanations] = useState<FilingExplanation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadToolActionLogs();
    loadConversations();
  }, [token, tenantId]);

  const loadToolActionLogs = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/assistant/actions/logs`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setToolActionLogs(
          data.logs.map((log: any) => ({
            id: log.id,
            toolName: log.toolName,
            args: log.args,
            result: log.result,
            status: log.status,
            timestamp: new Date(log.timestamp),
            approvedBy: log.approvedBy,
            approvedAt: log.approvedAt ? new Date(log.approvedAt) : undefined,
          }))
        );
      }
    } catch (error) {
      console.error('Failed to load tool action logs', error);
    }
  };

  const loadConversations = async () => {
    try {
      // In production, would fetch list of conversations from API
      // For now, we'll load them when selected
      setConversations([]);
    } catch (error) {
      console.error('Failed to load conversations', error);
    }
  };

  const handleExplainFiling = async (filingId: string) => {
    setSelectedFiling(filingId);
    setLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/assistant/filings/${filingId}/explain`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setFilingExplanations(
          (data.explanations || []).map((exp: any) => ({
            field: exp.field,
            value: exp.value,
            calculation: typeof exp.calculation === 'string' ? exp.calculation : JSON.stringify(exp.calculation),
            rules: exp.rules || [],
            sourceEntries: exp.sourceEntries || [],
          }))
        );
      }
    } catch (error) {
      console.error('Failed to load filing explanations', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadConversation = async (conversationId: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/assistant/conversations/${conversationId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setConversations((prev) => {
          const existing = prev.find((c) => c.id === conversationId);
          if (existing) {
            return prev;
          }
          return [
            ...prev,
            {
              id: conversationId,
              messages: data.messages.map((msg: any) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: new Date(msg.timestamp),
                toolCalls: msg.toolCalls,
                reasoningTrace: msg.reasoningTrace,
              })),
            },
          ];
        });
        setSelectedConversation(conversationId);
      }
    } catch (error) {
      console.error('Failed to load conversation', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedConversationData = conversations.find((c) => c.id === selectedConversation);

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Compliance Mode</h1>
            <p className="text-sm text-gray-600 mt-1">
              Immutable conversation transcripts and tool action logs for regulators and auditors
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-red-100 text-red-800 text-xs font-semibold rounded-full">
              AUDIT MODE
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Conversations</h2>
            <div className="space-y-2">
              <div className="mb-2">
                <input
                  type="text"
                  placeholder="Enter conversation ID..."
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value) {
                      handleLoadConversation(e.currentTarget.value);
                    }
                  }}
                />
              </div>
              {conversations.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-4">No conversations loaded</div>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv.id)}
                    className={`w-full text-left px-3 py-2 text-sm rounded-md ${
                      selectedConversation === conv.id
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <div className="font-medium">Conversation {conv.id.substring(0, 8)}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {conv.messages.length} messages
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="p-4 border-b border-gray-200 flex-1 overflow-y-auto">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Tool Action Logs</h2>
            <div className="space-y-2">
              {toolActionLogs.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-4">No tool actions logged</div>
              ) : (
                toolActionLogs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm"
                  >
                    <div className="font-medium text-gray-900">{log.toolName}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(log.timestamp).toLocaleString()}
                    </div>
                    <div className="text-xs mt-1">
                      Status:{' '}
                      <span
                        className={`font-medium ${
                          log.status === 'completed'
                            ? 'text-green-600'
                            : log.status === 'failed'
                            ? 'text-red-600'
                            : 'text-yellow-600'
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="p-4 border-t border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Filing Explanations</h2>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const filingId = prompt('Enter filing ID:');
                  if (filingId) {
                    handleExplainFiling(filingId);
                  }
                }}
                className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Explain Filing
              </button>
            </div>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedConversationData ? (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-800 font-semibold">🔒 Immutable Transcript</span>
                    <span className="text-xs text-yellow-600">
                      This conversation cannot be modified or deleted
                    </span>
                  </div>
                </div>

                {selectedConversationData.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-2xl px-4 py-3 rounded-lg ${
                        message.role === 'user'
                          ? 'bg-primary-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-900'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                      <div className="text-xs opacity-75 mt-2">
                        {new Date(message.timestamp).toLocaleString()}
                      </div>

                      {message.toolCalls && message.toolCalls.length > 0 && (
                        <div className="mt-3 border-t pt-3">
                          <div className="text-xs font-semibold mb-2">Tool Calls:</div>
                          {message.toolCalls.map((tc, idx) => (
                            <div key={idx} className="bg-gray-50 rounded p-2 mb-2 text-xs">
                              <div className="font-medium">{tc.toolName}</div>
                              {tc.args && (
                                <div className="text-gray-600 mt-1">
                                  <div className="font-medium mb-1">Arguments:</div>
                                  <pre className="bg-white p-1 rounded text-xs overflow-x-auto">
                                    {JSON.stringify(tc.args, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tc.result && (
                                <div className="text-gray-600 mt-1">
                                  <div className="font-medium mb-1">Result:</div>
                                  <pre className="bg-white p-1 rounded text-xs overflow-x-auto">
                                    {JSON.stringify(tc.result, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tc.error && (
                                <div className="text-red-600 mt-1">Error: {tc.error}</div>
                              )}
                              {tc.status && (
                                <div className="text-xs mt-1">
                                  Status:{' '}
                                  <span
                                    className={`font-medium ${
                                      tc.status === 'completed'
                                        ? 'text-green-600'
                                        : tc.status === 'failed'
                                        ? 'text-red-600'
                                        : 'text-yellow-600'
                                    }`}
                                  >
                                    {tc.status}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

              {message.reasoningTrace && message.reasoningTrace.length > 0 && (
                <div className="mt-3 border-t pt-3">
                  <div className="text-xs font-semibold mb-2">Reasoning Trace:</div>
                  <div className="space-y-1">
                    {message.reasoningTrace.map((trace, idx) => {
                      const hasDetails = trace.details !== undefined && trace.details !== null;
                      const renderedDetails: string | null =
                        !hasDetails || typeof trace.details === 'string'
                          ? (trace.details as string | null)
                          : JSON.stringify(trace.details, null, 2);
                      return (
                        <div key={idx} className="bg-gray-50 rounded p-2 text-xs">
                          <div className="font-medium">{trace.step}</div>
                          {renderedDetails ? (
                            <pre className="text-gray-600 mt-1 whitespace-pre-wrap break-words">
                              {renderedDetails}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : selectedFiling ? (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Filing Explanation</h2>
                    <button
                      onClick={() => setSelectedFiling(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </div>

                  {loading ? (
                    <div className="text-center text-gray-500 py-8">Loading explanations...</div>
                  ) : filingExplanations.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">No explanations available</div>
                  ) : (
                    <div className="space-y-4">
                      {filingExplanations.map((explanation, idx) => (
                        <div key={idx} className="border border-gray-200 rounded-lg p-4">
                          <div className="font-semibold text-gray-900 mb-2">{explanation.field}</div>
                          <div className="text-sm text-gray-700 mb-2">
                            Value: <span className="font-medium">{String(explanation.value)}</span>
                          </div>
                          <div className="text-sm text-gray-600 mb-2">
                            <div className="font-medium mb-1">Calculation:</div>
                            <pre className="bg-gray-50 p-2 rounded text-xs overflow-x-auto">
                              {explanation.calculation}
                            </pre>
                          </div>
                          {explanation.rules.length > 0 && (
                            <div className="text-sm text-gray-600 mb-2">
                              <div className="font-medium mb-1">Rules Applied:</div>
                              <ul className="list-disc list-inside text-xs">
                                {explanation.rules.map((rule, ruleIdx) => (
                                  <li key={ruleIdx}>{rule}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {explanation.sourceEntries.length > 0 && (
                            <div className="text-sm text-gray-600">
                              <div className="font-medium mb-1">Source Entries:</div>
                              <div className="text-xs space-y-1">
                                {explanation.sourceEntries.map((entryId, entryIdx) => (
                                  <div key={entryIdx} className="bg-gray-50 px-2 py-1 rounded">
                                    {entryId}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <p className="text-lg font-medium mb-2">Compliance Mode</p>
                <p className="text-sm">
                  Select a conversation or explain a filing to view immutable audit records
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
