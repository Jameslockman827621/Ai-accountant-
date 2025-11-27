import React from 'react';

const arReceivables = [
  { id: 'AR-3001', customer: 'Blue Ocean', amount: '$7,200', dueDate: '2024-03-15', status: 'Open' },
  { id: 'AR-3002', customer: 'Northwind', amount: '$3,100', dueDate: '2024-03-05', status: 'Reminder Sent' },
];

const ARPage: React.FC = () => {
  return (
    <main className="p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Accounts Receivable</h1>
        <p className="text-gray-600">Track approvals, collect payments, and automate reminders.</p>
      </header>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Open Receivables</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="py-2">Invoice</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Due Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {arReceivables.map(invoice => (
              <tr key={invoice.id} className="border-t">
                <td className="py-2">{invoice.id}</td>
                <td>{invoice.customer}</td>
                <td>{invoice.amount}</td>
                <td>{invoice.dueDate}</td>
                <td>{invoice.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bg-white shadow rounded-lg p-6 space-y-2">
        <h3 className="text-lg font-semibold">Reminders</h3>
        <p className="text-gray-600 text-sm">
          Customers with balances past due automatically receive reminder emails and optional payment links.
        </p>
      </section>
    </main>
  );
};

export default ARPage;
