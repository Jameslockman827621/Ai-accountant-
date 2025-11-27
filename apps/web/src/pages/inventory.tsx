import React from 'react';

const inventory = [
  { sku: 'SKU-001', description: 'Widget Pro', onHand: 120, committed: 30, reorderPoint: 50 },
  { sku: 'SKU-002', description: 'Widget Lite', onHand: 80, committed: 10, reorderPoint: 40 },
];

const InventoryPage: React.FC = () => {
  return (
    <main className="p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Inventory</h1>
        <p className="text-gray-600">Track SKU availability, commitments, and reorder points.</p>
      </header>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">SKU Overview</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="py-2">SKU</th>
              <th>Description</th>
              <th>On Hand</th>
              <th>Committed</th>
              <th>Reorder Point</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map(item => (
              <tr key={item.sku} className="border-t">
                <td className="py-2">{item.sku}</td>
                <td>{item.description}</td>
                <td>{item.onHand}</td>
                <td>{item.committed}</td>
                <td>{item.reorderPoint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
};

export default InventoryPage;
