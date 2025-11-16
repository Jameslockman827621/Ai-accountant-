'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ValidationDashboard');

interface ValidationResult {
  status: 'pass' | 'fail' | 'warning';
  components: {
    tax?: { isValid: boolean; errors: string[] };
    accuracy?: { passed: number; failed: number; errors: string[] };
    anomalies?: { count: number; highestSeverity: string };
    confidence?: { requiresReview: string[] };
  };
  errors: string[];
  warnings: string[];
}

interface CrossValidationReport {
  bankBalance: number;
  ledgerBalance: number;
  difference: number;
  matched: number;
  unmatched: number;
  items: Array<{
    bankTransactionId: string;
    ledgerEntryId: string | null;
    status: 'matched' | 'unmatched';
    amount: number;
    date: string;
  }>;
}

export default function ValidationDashboard() {
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [crossValidation, setCrossValidation] = useState<CrossValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  const runValidation = async () => {
    if (!periodStart || !periodEnd) {
      alert('Please select a period');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/validation/summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entityType: 'tenant',
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
        }),
      });

      if (!response.ok) throw new Error('Validation failed');

      const data = await response.json();
      setValidationResult(data.summary);
    } catch (error) {
      logger.error('Validation failed', error);
      alert('Failed to run validation');
    } finally {
      setLoading(false);
    }
  };

  const runCrossValidation = async () => {
    if (!periodStart || !periodEnd) {
      alert('Please select a period');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/validation/cross-validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
        }),
      });

      if (!response.ok) throw new Error('Cross-validation failed');

      const data = await response.json();
      setCrossValidation(data.report);
    } catch (error) {
      logger.error('Cross-validation failed', error);
      alert('Failed to run cross-validation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Validation Dashboard</h2>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Period Start
            </label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Period End
            </label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <button
            onClick={runValidation}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Run Validation
          </button>
          <button
            onClick={runCrossValidation}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            Cross-Validate Data
          </button>
        </div>

        {validationResult && (
          <div className="mt-6 space-y-4">
            <div className={`p-4 rounded ${
              validationResult.status === 'pass' ? 'bg-green-50 border border-green-200' :
              validationResult.status === 'fail' ? 'bg-red-50 border border-red-200' :
              'bg-yellow-50 border border-yellow-200'
            }`}>
              <h3 className="font-semibold mb-2">
                Validation Status: {validationResult.status.toUpperCase()}
              </h3>

              {validationResult.components.tax && (
                <div className="mt-2">
                  <p className="text-sm">
                    Tax Calculation: {validationResult.components.tax.isValid ? '✅ Valid' : '❌ Invalid'}
                  </p>
                  {validationResult.components.tax.errors.length > 0 && (
                    <ul className="text-sm text-red-600 mt-1">
                      {validationResult.components.tax.errors.map((err, i) => (
                        <li key={i}>• {err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {validationResult.components.accuracy && (
                <div className="mt-2">
                  <p className="text-sm">
                    Data Accuracy: {validationResult.components.accuracy.passed} passed,{' '}
                    {validationResult.components.accuracy.failed} failed
                  </p>
                </div>
              )}

              {validationResult.components.anomalies && (
                <div className="mt-2">
                  <p className="text-sm">
                    Anomalies: {validationResult.components.anomalies.count} detected
                    (Highest: {validationResult.components.anomalies.highestSeverity})
                  </p>
                </div>
              )}

              {validationResult.errors.length > 0 && (
                <div className="mt-4">
                  <p className="font-semibold text-red-600">Errors:</p>
                  <ul className="text-sm text-red-600 mt-1">
                    {validationResult.errors.map((err, i) => (
                      <li key={i}>• {err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validationResult.warnings.length > 0 && (
                <div className="mt-4">
                  <p className="font-semibold text-yellow-600">Warnings:</p>
                  <ul className="text-sm text-yellow-600 mt-1">
                    {validationResult.warnings.map((warn, i) => (
                      <li key={i}>• {warn}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {crossValidation && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
            <h3 className="font-semibold mb-2">Cross-Validation Report</h3>
            <p className="text-sm">
              Bank Balance: £{crossValidation.bankBalance.toLocaleString()}
            </p>
            <p className="text-sm">
              Ledger Balance: £{crossValidation.ledgerBalance.toLocaleString()}
            </p>
            <p className="text-sm">
              Difference: £{Math.abs(crossValidation.difference).toLocaleString()}
            </p>
            <p className="text-sm">
              Matched: {crossValidation.matched} | Unmatched: {crossValidation.unmatched}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
