import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

interface Report {
  type: 'profit-loss' | 'balance-sheet' | 'cash-flow';
  period: { start: string; end: string };
  data: unknown;
}

export function Reports() {
  const { token } = useAuth();
  const [selectedReport, setSelectedReport] = useState<Report['type'] | null>(null);
  const [reportData, setReportData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  async function generateReport(type: Report['type']) {
    if (!startDate || !endDate) {
      alert('Please select start and end dates');
      return;
    }

    setLoading(true);
    try {
      const endpoint = type === 'profit-loss' ? 'profit-loss' :
                      type === 'balance-sheet' ? 'balance-sheet' :
                      'cash-flow';

      const url = type === 'balance-sheet'
        ? `/api/reports/${endpoint}?asOfDate=${endDate}`
        : `/api/reports/${endpoint}?startDate=${startDate}&endDate=${endDate}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setReportData(data.report);
        setSelectedReport(type);
      } else {
        alert('Failed to generate report');
      }
    } catch (error) {
      console.error('Failed to generate report', error);
      alert('Failed to generate report');
    } finally {
      setLoading(false);
    }
  }

  function exportReport(format: 'csv' | 'pdf') {
    if (!reportData) {
      alert('No report data to export');
      return;
    }

    // In production, implement actual export
    alert(`Exporting ${selectedReport} as ${format.toUpperCase()}...`);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Financial Reports</h1>

        {/* Report Selection */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Generate Report</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => generateReport('profit-loss')}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Profit & Loss'}
            </button>
            <button
              onClick={() => generateReport('balance-sheet')}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Balance Sheet'}
            </button>
            <button
              onClick={() => generateReport('cash-flow')}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Cash Flow'}
            </button>
          </div>
        </div>

        {/* Report Display */}
        {reportData && selectedReport && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">
                {selectedReport === 'profit-loss' && 'Profit & Loss Statement'}
                {selectedReport === 'balance-sheet' && 'Balance Sheet'}
                {selectedReport === 'cash-flow' && 'Cash Flow Statement'}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => exportReport('csv')}
                  className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Export CSV
                </button>
                <button
                  onClick={() => exportReport('pdf')}
                  className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Export PDF
                </button>
              </div>
            </div>
            <pre className="bg-gray-50 p-4 rounded overflow-auto">
              {JSON.stringify(reportData, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
