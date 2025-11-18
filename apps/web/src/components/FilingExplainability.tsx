'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('FilingExplainability');

interface FilingExplanation {
  section: string;
  fieldName: string | null;
  value: number | null;
  calculationSteps: Array<{ step: string }>;
  ruleApplied: { rules: string[] };
  sourceTransactions: string[];
  aiCommentary: string | null;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface FilingExplainabilityProps {
  token: string;
  filingId: string;
}

export default function FilingExplainability({ token, filingId }: FilingExplainabilityProps) {
  const [explanations, setExplanations] = useState<FilingExplanation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedField, setSelectedField] = useState<string | null>(null);

  useEffect(() => {
    loadExplanations();
  }, [filingId]);

  const loadExplanations = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/filings/${filingId}/explanations`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load explanations');

      const data = await response.json();
      setExplanations(data.explanations || []);
    } catch (error) {
      logger.error('Failed to load filing explanations', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

    const groupedBySection = explanations.reduce((acc, exp) => {
      const sectionKey = exp.section;
      if (!acc[sectionKey]) {
        acc[sectionKey] = [];
      }
      acc[sectionKey]!.push(exp);
      return acc;
    }, {} as Record<string, FilingExplanation[]>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Filing Explanation</h1>
        <p className="text-gray-600 mt-1">
          Understand how each value was calculated and which rules were applied
        </p>
      </div>

      {Object.keys(groupedBySection).length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">No explanations available for this filing</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedBySection).map(([section, sectionExplanations]) => (
            <div key={section} className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 capitalize">
                {section.replace('_', ' ')}
              </h2>
              <div className="space-y-4">
                {sectionExplanations.map((explanation, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${
                      selectedField === explanation.fieldName
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-medium text-gray-900">
                          {explanation.fieldName || 'Unnamed Field'}
                        </h3>
                        {explanation.value !== null && (
                          <p className="text-2xl font-bold text-gray-900 mt-1">
                            {typeof explanation.value === 'number'
                              ? explanation.value.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })
                              : explanation.value}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          setSelectedField(
                            selectedField === explanation.fieldName ? null : explanation.fieldName || null
                          )
                        }
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        {selectedField === explanation.fieldName ? 'Hide' : 'Show'} Details
                      </button>
                    </div>

                    {selectedField === explanation.fieldName && (
                      <div className="mt-4 space-y-3 border-t border-gray-200 pt-4">
                        {/* Calculation Steps */}
                        {explanation.calculationSteps && explanation.calculationSteps.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2">
                              Calculation Steps
                            </h4>
                            <div className="space-y-2">
                              {explanation.calculationSteps.map((step, stepIndex) => (
                                <div
                                  key={stepIndex}
                                  className="p-2 bg-white rounded border border-gray-200 text-sm font-mono text-gray-700"
                                >
                                  {step.step}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Rules Applied */}
                          {explanation.ruleApplied?.rules && explanation.ruleApplied.rules.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2">Rules Applied</h4>
                            <div className="flex flex-wrap gap-2">
                              {explanation.ruleApplied.rules.map((ruleId, ruleIndex) => (
                                <span
                                  key={ruleIndex}
                                  className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium"
                                >
                                  {ruleId}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Source Transactions */}
                        {explanation.sourceTransactions && explanation.sourceTransactions.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2">
                              Source Transactions
                            </h4>
                            <div className="space-y-1">
                              {explanation.sourceTransactions.map((txId, txIndex) => (
                                <a
                                  key={txIndex}
                                  href={`/transactions/${txId}`}
                                  className="block text-sm text-blue-600 hover:text-blue-700 hover:underline"
                                >
                                  {txId}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* AI Commentary */}
                        {explanation.aiCommentary && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2">AI Commentary</h4>
                            <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded border border-blue-200">
                              {explanation.aiCommentary}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
