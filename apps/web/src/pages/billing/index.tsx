import React, { useEffect, useState } from 'react';

type Plan = {
  tier: string;
  name: string;
  price: number;
  currency: string;
  description: string;
  features: string[];
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
};

type PaymentMethod = {
  id: string;
  card?: {
    brand?: string;
    last4?: string;
    exp_month?: number;
    exp_year?: number;
  };
};

type UsageMeter = {
  usage: Record<string, number>;
  limits: Record<string, number>;
};

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [usageMeter, setUsageMeter] = useState<UsageMeter | null>(null);

  useEffect(() => {
    void fetchPlans();
    void fetchHistory();
    void fetchPaymentMethods();
    void fetchUsage();
  }, []);

  async function fetchPlans() {
    const response = await fetch('/api/billing/plans');
    if (response.ok) {
      const data = await response.json();
      setPlans(data.plans || []);
    }
  }

  async function fetchHistory() {
    const response = await fetch('/api/billing/history');
    if (response.ok) {
      const data = await response.json();
      setInvoices(data.invoices || []);
      setCreditBalance(data.credits?.balance || 0);
    }
  }

  async function fetchPaymentMethods() {
    const response = await fetch('/api/billing/payment-methods');
    if (response.ok) {
      const data = await response.json();
      setPaymentMethods(data.paymentMethods || []);
    }
  }

  async function fetchUsage() {
    const response = await fetch('/api/billing/usage/meter');
    if (response.ok) {
      const data = await response.json();
      setUsageMeter(data.meter);
    }
  }

  async function handlePlanChange(tier: string) {
    setSelectedPlan(tier);
    const response = await fetch('/api/billing/subscription/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    });

    if (response.ok) {
      const data = await response.json();
      const due = data.preview?.amountDue ?? 0;
      setMessage(`Proration due now: ${data.preview?.currency || 'GBP'} ${due}`);
      await fetch('/api/billing/subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      await fetchHistory();
    } else {
      setMessage('Unable to preview plan change');
    }
  }

  async function handleCancel(cancelAtPeriodEnd: boolean) {
    await fetch('/api/billing/subscription/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelAtPeriodEnd }),
    });
    setMessage(cancelAtPeriodEnd ? 'Cancellation scheduled' : 'Subscription cancelled');
  }

  async function handleAddPaymentMethod(paymentMethodId: string) {
    await fetch('/api/billing/payment-methods/default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethodId }),
    });
    setMessage('Payment method updated');
    await fetchPaymentMethods();
  }

  async function handleOneTimePayment(amount: number) {
    const response = await fetch('/api/billing/payment-intent/commerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'GBP', metadata: { reason: 'top-up' } }),
    });
    if (response.ok) {
      const data = await response.json();
      setMessage(`Payment intent created: ${data.intent?.id}`);
    } else {
      setMessage('Unable to create payment intent');
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Manage subscriptions, payments, and usage</p>
          <h1 className="text-3xl font-bold">Billing</h1>
        </div>
        <div className="text-sm text-gray-600">Credits available: £{creditBalance.toFixed(2)}</div>
      </header>

      {message && <div className="rounded bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">{message}</div>}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plans.map(plan => (
          <div key={plan.tier} className={`border rounded p-4 ${selectedPlan === plan.tier ? 'border-blue-500' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <p className="text-gray-600">{plan.description}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">
                  {plan.currency} {plan.price}
                </div>
                <div className="text-xs text-gray-500">per month</div>
              </div>
            </div>
            <ul className="list-disc pl-5 text-sm text-gray-700 mt-2">
              {plan.features.map(feature => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <button
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              onClick={() => handlePlanChange(plan.tier)}
            >
              Choose {plan.name}
            </button>
          </div>
        ))}
      </section>

      <section className="border rounded p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Usage metering</h2>
          <span className="text-sm text-gray-500">Current period</span>
        </div>
        {usageMeter ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(usageMeter.limits).map(([key, limit]) => (
              <div key={key} className="p-3 bg-gray-50 rounded">
                <div className="text-xs uppercase text-gray-500">{key.replace('_', ' ')}</div>
                <div className="text-lg font-semibold">
                  {usageMeter.usage?.[`${key === 'documentsPerMonth' ? 'documents_processed' : key}`] ?? usageMeter.usage[key] ?? 0} / {limit}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-600">Loading usage…</p>
        )}
      </section>

      <section className="border rounded p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Payment methods</h2>
          <button className="text-sm text-blue-600" onClick={() => handleAddPaymentMethod('pm_mock')}>Use test method</button>
        </div>
        <div className="space-y-2">
          {paymentMethods.map(method => (
            <div key={method.id} className="border rounded p-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Card •••• {method.card?.last4}</div>
                <div className="text-xs text-gray-500">
                  {method.card?.brand?.toUpperCase()} exp {method.card?.exp_month}/{method.card?.exp_year}
                </div>
              </div>
              <button
                className="text-blue-600 text-sm"
                onClick={() => handleAddPaymentMethod(method.id)}
              >
                Make default
              </button>
            </div>
          ))}
          {paymentMethods.length === 0 && <p className="text-sm text-gray-600">No payment methods on file.</p>}
        </div>
      </section>

      <section className="border rounded p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Billing history</h2>
          <button className="text-sm text-red-600" onClick={() => handleCancel(true)}>Schedule cancellation</button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2">Invoice</th>
                <th className="py-2">Issued</th>
                <th className="py-2">Due</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(invoice => (
                <tr key={invoice.id} className="border-t">
                  <td className="py-2 font-medium">{invoice.invoiceNumber}</td>
                  <td className="py-2">{new Date(invoice.issueDate).toLocaleDateString()}</td>
                  <td className="py-2">{new Date(invoice.dueDate).toLocaleDateString()}</td>
                  <td className="py-2">{invoice.currency} {invoice.amount.toFixed(2)}</td>
                  <td className="py-2 uppercase">{invoice.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoices.length === 0 && <p className="text-sm text-gray-600">No invoices generated yet.</p>}
        </div>
      </section>

      <section className="border rounded p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Credits & top-ups</h2>
          <button className="text-sm text-blue-600" onClick={() => handleOneTimePayment(25)}>Top up £25</button>
        </div>
        <p className="text-sm text-gray-600">
          Credits are automatically applied to proration and usage overages. You can top up anytime to avoid
          service interruptions.
        </p>
      </section>
    </div>
  );
}
