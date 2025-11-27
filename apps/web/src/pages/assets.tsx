import React from 'react';

const assets = [
  { name: 'Server Rack', category: 'IT', cost: '$18,000', life: '60 months', method: 'Straight Line' },
  { name: 'Fleet Vehicle', category: 'Operations', cost: '$32,500', life: '48 months', method: 'Declining Balance' },
];

const depreciation = [
  { period: 1, depreciation: '$500', nbv: '$17,500' },
  { period: 2, depreciation: '$500', nbv: '$17,000' },
];

const AssetsPage: React.FC = () => {
  return (
    <main className="p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Fixed Assets</h1>
        <p className="text-gray-600">Register assets and review the depreciation schedule.</p>
      </header>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Asset Register</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {assets.map(asset => (
            <div key={asset.name} className="border rounded-lg p-4 space-y-1">
              <div className="font-semibold">{asset.name}</div>
              <div className="text-sm text-gray-600">Category: {asset.category}</div>
              <div className="text-sm text-gray-600">Cost: {asset.cost}</div>
              <div className="text-sm text-gray-600">Life: {asset.life}</div>
              <div className="text-sm text-gray-600">Method: {asset.method}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Depreciation Schedule (preview)</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="py-2">Period</th>
              <th>Depreciation</th>
              <th>Net Book Value</th>
            </tr>
          </thead>
          <tbody>
            {depreciation.map(row => (
              <tr key={row.period} className="border-t">
                <td className="py-2">Month {row.period}</td>
                <td>{row.depreciation}</td>
                <td>{row.nbv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
};

export default AssetsPage;
