'use client';

import React, { useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ManualTransactionImport');

interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
  duplicates: number;
}

export default function ManualTransactionImport({ accountId }: { accountId?: string }) {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState(accountId || '');
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);

  React.useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/bank-feed/connections', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setAccounts(data.connections || []);
      }
    } catch (error) {
      logger.error('Failed to load accounts', error);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
      setResult(null);
    } else {
      alert('Please select a CSV file');
    }
  };

  const handleImport = async () => {
    if (!csvFile || !selectedAccountId) {
      alert('Please select a CSV file and account');
      return;
    }

    setImporting(true);
    try {
      const csvContent = await csvFile.text();
      const token = localStorage.getItem('authToken');

      const response = await fetch('/api/bank-feed/import/csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountId: selectedAccountId,
          csvContent,
        }),
      });

      if (!response.ok) throw new Error('Import failed');

      const data = await response.json();
      setResult(data.result || data);
      setCsvFile(null);
    } catch (error) {
      logger.error('Import failed', error);
      alert('Failed to import transactions');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-4">Manual Transaction Import</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Bank Account
          </label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">Select an account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            CSV File
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <p className="text-xs text-gray-500 mt-1">
            CSV should contain: date, description, amount columns
          </p>
        </div>

        {csvFile && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded">
            <p className="text-sm">
              Selected: <strong>{csvFile.name}</strong> ({(csvFile.size / 1024).toFixed(2)} KB)
            </p>
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={!csvFile || !selectedAccountId || importing}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {importing ? 'Importing...' : 'Import Transactions'}
        </button>

        {result && (
          <div className="mt-4 p-4 bg-gray-50 rounded">
            <h3 className="font-semibold mb-2">Import Results</h3>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-600">Imported</p>
                <p className="text-2xl font-bold text-green-600">{result.imported}</p>
              </div>
              <div>
                <p className="text-gray-600">Skipped</p>
                <p className="text-2xl font-bold text-yellow-600">{result.skipped}</p>
              </div>
              <div>
                <p className="text-gray-600">Duplicates</p>
                <p className="text-2xl font-bold text-orange-600">{result.duplicates}</p>
              </div>
              <div>
                <p className="text-gray-600">Errors</p>
                <p className="text-2xl font-bold text-red-600">{result.errors.length}</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="mt-4">
                <p className="font-semibold text-red-600 mb-2">Errors:</p>
                <div className="max-h-40 overflow-y-auto">
                  {result.errors.map((error, i) => (
                    <p key={i} className="text-sm text-red-600">
                      Row {error.row}: {error.error}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
