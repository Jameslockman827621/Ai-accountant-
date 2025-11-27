import React from 'react';

const eliminationSummary = [
  { type: 'Intercompany Revenue', amount: '$12,000' },
  { type: 'Loan Balances', amount: '$85,000' },
];

const ConsolidationPage: React.FC = () => {
  return (
    <main className="p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Consolidation</h1>
        <p className="text-gray-600">Multi-entity eliminations with currency and ownership context.</p>
      </header>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Elimination Summary</h2>
        <ul className="space-y-2 text-sm">
          {eliminationSummary.map(item => (
            <li key={item.type} className="flex justify-between border rounded-lg p-3">
              <span>{item.type}</span>
              <span className="font-semibold">{item.amount}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white shadow rounded-lg p-6 space-y-2">
        <h3 className="text-lg font-semibold">Balance Sheet (post-elimination)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="border rounded-lg p-3">
            <div className="text-gray-500">Assets</div>
            <div className="text-xl font-semibold">$4.2M</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-gray-500">Liabilities</div>
            <div className="text-xl font-semibold">$1.9M</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-gray-500">Equity</div>
            <div className="text-xl font-semibold">$2.3M</div>
          </div>
        </div>
      </section>
    </main>
  );
};

export default ConsolidationPage;
