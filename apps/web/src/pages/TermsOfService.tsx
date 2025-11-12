import React from 'react';

export default function TermsOfService() {
  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
      
      <div className="prose max-w-none">
        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
          <p>
            By accessing and using the AI Accountant SaaS platform, you accept and agree to be bound by the terms
            and provision of this agreement.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">2. Service Description</h2>
          <p>
            AI Accountant SaaS provides automated accounting services including document processing, tax calculations,
            and filing assistance. The service is designed to assist with accounting tasks but does not replace
            professional accounting advice.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">3. User Responsibilities</h2>
          <ul className="list-disc pl-6">
            <li>You are responsible for the accuracy of all data you provide</li>
            <li>You must review all calculations and filings before submission</li>
            <li>You must comply with all applicable tax laws and regulations</li>
            <li>You are responsible for maintaining the security of your account</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">4. Limitation of Liability</h2>
          <p>
            AI Accountant SaaS provides tools and assistance but does not guarantee the accuracy of tax calculations
            or filings. You are responsible for reviewing and approving all filings before submission. We recommend
            consulting with a qualified accountant for complex tax situations.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">5. Data and Privacy</h2>
          <p>
            Your data is stored securely and used only to provide the service. Please refer to our Privacy Policy
            for detailed information about data handling.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">6. Subscription and Billing</h2>
          <p>
            Subscription fees are charged according to your selected tier. You may cancel your subscription at any time.
            Refunds are provided according to our refund policy.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">7. Changes to Terms</h2>
          <p>
            We reserve the right to modify these terms at any time. Continued use of the service after changes
            constitutes acceptance of the new terms.
          </p>
        </section>
      </div>
    </div>
  );
}
