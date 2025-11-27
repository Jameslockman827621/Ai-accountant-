import React from 'react';

const payrollConnectors = [
  { provider: 'Gusto', status: 'Connected', lastSync: '2024-03-01' },
  { provider: 'QuickBooks Payroll', status: 'Pending Auth', lastSync: '—' },
  { provider: 'ADP', status: 'Connected', lastSync: '2024-02-28' },
];

const payrollFilings = [
  { form: '941', jurisdiction: 'Federal', status: 'Filed', period: 'Q1 2024' },
  { form: 'DE9C', jurisdiction: 'CA', status: 'In Progress', period: 'Q1 2024' },
];

const PayrollPage: React.FC = () => {
  return (
    <main className="p-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Payroll Hub</h1>
        <p className="text-gray-600">
          Manage payroll connectors, run gross-to-net scenarios, and track statutory filings.
        </p>
      </header>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Connectors</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {payrollConnectors.map(connector => (
            <div key={connector.provider} className="border rounded-lg p-4">
              <div className="font-semibold">{connector.provider}</div>
              <div className="text-sm text-gray-600">Status: {connector.status}</div>
              <div className="text-sm text-gray-600">Last Sync: {connector.lastSync}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white shadow rounded-lg p-6 space-y-4">
        <h2 className="text-xl font-semibold">Gross to Net</h2>
        <p className="text-gray-600">
          Quick calculator previewing gross pay, employee taxes, deductions, and employer burden.
        </p>
        <div className="border rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-500">Gross Pay</div>
            <div className="font-semibold">$12,400.00</div>
          </div>
          <div>
            <div className="text-gray-500">Employee Taxes</div>
            <div className="font-semibold">$2,100.00</div>
          </div>
          <div>
            <div className="text-gray-500">Deductions</div>
            <div className="font-semibold">$450.00</div>
          </div>
          <div>
            <div className="text-gray-500">Net Pay</div>
            <div className="font-semibold">$9,850.00</div>
          </div>
        </div>
      </section>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Filings</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="py-2">Form</th>
              <th>Jurisdiction</th>
              <th>Status</th>
              <th>Period</th>
            </tr>
          </thead>
          <tbody>
            {payrollFilings.map(filing => (
              <tr key={`${filing.form}-${filing.jurisdiction}`} className="border-t">
                <td className="py-2">{filing.form}</td>
                <td>{filing.jurisdiction}</td>
                <td>{filing.status}</td>
                <td>{filing.period}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
};

export default PayrollPage;
