'use client';

import { useState, useRef, useEffect } from 'react';

interface AICopilotProps {
  token: string;
  question: string;
  context?: Record<string, unknown>;
  onSuggestion?: (suggestion: string) => void;
  onClarification?: (questions: string[]) => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
  clarificationQuestions?: string[];
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function AICopilot({
  token,
  question,
  context,
  onSuggestion,
  onClarification,
}: AICopilotProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (question) {
      handleQuestion(question);
    }
  }, [question]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleQuestion = async (q: string) => {
    if (!q.trim()) return;

    const userMessage: Message = { role: 'user', content: q };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // In production, this would call the AI assistant service
      // For now, simulate AI response
      const response = await simulateAIResponse(q, context);

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.answer,
        suggestions: response.suggestions,
        clarificationQuestions: response.clarificationQuestions,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (response.suggestions && response.suggestions.length > 0) {
        onSuggestion?.(response.suggestions[0]);
      }

      if (response.clarificationQuestions && response.clarificationQuestions.length > 0) {
        onClarification?.(response.clarificationQuestions);
      }
    } catch (error) {
      console.error('AI copilot error', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'I apologize, but I encountered an error. Please try rephrasing your question.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const simulateAIResponse = async (
    q: string,
    ctx?: Record<string, unknown>
  ): Promise<{
    answer: string;
    suggestions?: string[];
    clarificationQuestions?: string[];
  }> => {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const lowerQ = q.toLowerCase();

    // Context-aware responses
    if (lowerQ.includes('vat') || lowerQ.includes('tax')) {
      return {
        answer:
          'Based on your business profile, you appear to be VAT registered. For UK businesses, VAT returns are typically filed quarterly. Would you like me to help you set up your VAT filing schedule?',
        suggestions: ['Set up quarterly VAT filing', 'Configure VAT reminders'],
        clarificationQuestions: ['What is your VAT registration number?', 'When is your VAT period end?'],
      };
    }

    if (lowerQ.includes('bank') || lowerQ.includes('account')) {
      return {
        answer:
          'Connecting your bank account enables automatic transaction import and reconciliation. I recommend connecting at least one primary business account. Which bank do you use?',
        suggestions: ['Connect via Plaid (US)', 'Connect via TrueLayer (UK/EU)'],
      };
    }

    if (lowerQ.includes('chart') || lowerQ.includes('account')) {
      return {
        answer:
          'Your chart of accounts is the foundation of your accounting system. Based on your industry, I can suggest a template. What industry are you in?',
        suggestions: ['Use standard template', 'Use retail template', 'Use SaaS template'],
      };
    }

    // Default response
    return {
      answer:
        'I can help you with your onboarding setup. What specific question do you have about configuring your AI accountant?',
      suggestions: ['Learn about tax obligations', 'Understand connector setup', 'Get help with chart of accounts'],
    };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      handleQuestion(input);
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-full max-h-96 border border-gray-200 rounded-lg bg-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">🤖</div>
            <p className="text-sm">Ask me anything about your onboarding setup</p>
            <p className="text-xs mt-2 text-gray-400">
              I can help with tax obligations, connectors, chart of accounts, and more
            </p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>

                {message.suggestions && message.suggestions.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {message.suggestions.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => onSuggestion?.(suggestion)}
                        className="block w-full text-left text-xs px-2 py-1 bg-white bg-opacity-20 rounded hover:bg-opacity-30"
                      >
                        💡 {suggestion}
                      </button>
                    ))}
                  </div>
                )}

                {message.clarificationQuestions && message.clarificationQuestions.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium mb-1">Clarification needed:</p>
                    {message.clarificationQuestions.map((question, i) => (
                      <p key={i} className="text-xs opacity-90">
                        • {question}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-4">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
