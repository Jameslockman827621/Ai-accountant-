import React from 'react';

const apInvoices = [
  { id: 'INV-1001', vendor: 'Acme Supplies', amount: '$4,200', status: 'Pending' },
  { id: 'INV-1002', vendor: 'Office Goods Ltd', amount: '$980', status: 'Approved' },
];

const APPage: React.FC = () => {
  return (
    <main className="p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Accounts Payable</h1>
        <p className="text-gray-600">Ingest vendor invoices, route approvals, and schedule payments.</p>
      </header>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Invoice Inbox</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="py-2">Invoice</th>
              <th>Vendor</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {apInvoices.map(invoice => (
              <tr key={invoice.id} className="border-t">
                <td className="py-2">{invoice.id}</td>
                <td>{invoice.vendor}</td>
                <td>{invoice.amount}</td>
                <td>{invoice.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bg-white shadow rounded-lg p-6 space-y-2">
        <h3 className="text-lg font-semibold">Approval Routing</h3>
        <p className="text-gray-600 text-sm">
          Default policy: invoices over $2,500 require dual approval before hand-off to payments.
        </p>
      </section>
    </main>
  );
};

export default APPage;
