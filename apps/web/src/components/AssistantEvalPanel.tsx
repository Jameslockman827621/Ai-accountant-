'use client';

import { useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface EvaluationResult {
  sampleId: string;
  question: string;
  answer: string;
  confidence: number;
  keywordCoverage: number;
  citations: number;
  passed: boolean;
  notes?: string;
}

interface EvaluationReport {
  totalSamples: number;
  passed: number;
  averageConfidence: number;
  averageCoverage: number;
  results: EvaluationResult[];
}

interface AssistantEvalPanelProps {
  token: string;
}

export default function AssistantEvalPanel({ token }: AssistantEvalPanelProps) {
  const [limit, setLimit] = useState(3);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runEvaluation = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/assistant/evaluations/run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ limit }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Assistant evaluation failed');
      }
      const data = (await response.json()) as { report: EvaluationReport };
      setReport(data.report);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unable to run evaluation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-6 shadow space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Assistant Quality Check</h3>
          <p className="text-sm text-gray-500">
            Runs the built-in evaluation set against your tenant knowledge base to track accuracy & citations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-700">
            Test samples
            <input
              type="number"
              min={1}
              max={evalSetSize}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="ml-2 w-20 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            onClick={runEvaluation}
            disabled={loading}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? 'Evaluating…' : 'Run evaluation'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <SummaryCard label="Samples" value={report.totalSamples} />
            <SummaryCard
              label="Pass rate"
              value={`${Math.round((report.passed / report.totalSamples) * 100)}%`}
            />
            <SummaryCard
              label="Avg confidence"
              value={report.averageConfidence.toFixed(2)}
            />
            <SummaryCard
              label="Keyword coverage"
              value={`${Math.round(report.averageCoverage * 100)}%`}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Question</th>
                  <th className="px-3 py-2 text-center">Conf.</th>
                  <th className="px-3 py-2 text-center">Coverage</th>
                  <th className="px-3 py-2 text-center">Citations</th>
                  <th className="px-3 py-2 text-center">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.results.map((result) => (
                  <tr key={result.sampleId}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{result.question}</p>
                      <p className="text-xs text-gray-500 line-clamp-2">{result.answer}</p>
                      {result.notes && (
                        <p className="text-xs text-amber-600">{result.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">{result.confidence.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center">
                      {(result.keywordCoverage * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-center">{result.citations}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          result.passed
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {result.passed ? 'Pass' : 'Fail'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const evalSetSize = 10;

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
