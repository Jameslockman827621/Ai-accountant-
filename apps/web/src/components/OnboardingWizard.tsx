import React, { useState } from 'react';

interface OnboardingWizardProps {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    businessName: '',
    businessType: '',
    country: 'GB',
    vatNumber: '',
    chartOfAccounts: false,
    bankConnected: false,
    firstDocument: false,
  });

  const steps = [
    {
      title: 'Welcome',
      component: (
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Welcome to AI Accountant SaaS</h2>
          <p className="text-gray-600 mb-6">
            Let's get you set up in just a few steps. This will only take a few minutes.
          </p>
        </div>
      ),
    },
    {
      title: 'Business Information',
      component: (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold mb-4">Tell us about your business</h2>
          <div>
            <label className="block text-sm font-medium mb-1">Business Name</label>
            <input
              type="text"
              value={formData.businessName}
              onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
              className="w-full border rounded px-3 py-2"
              placeholder="Enter your business name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Business Type</label>
            <select
              value={formData.businessType}
              onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">Select...</option>
              <option value="sole_trader">Sole Trader</option>
              <option value="partnership">Partnership</option>
              <option value="limited_company">Limited Company</option>
              <option value="llp">LLP</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Country</label>
            <select
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              className="w-full border rounded px-3 py-2"
            >
              <option value="GB">United Kingdom</option>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">VAT Number (optional)</label>
            <input
              type="text"
              value={formData.vatNumber}
              onChange={(e) => setFormData({ ...formData, vatNumber: e.target.value })}
              className="w-full border rounded px-3 py-2"
              placeholder="GB123456789"
            />
          </div>
        </div>
      ),
    },
    {
      title: 'Chart of Accounts',
      component: (
        <div>
          <h2 className="text-2xl font-bold mb-4">Set up your chart of accounts</h2>
          <p className="text-gray-600 mb-4">
            We'll create a default chart of accounts for you. You can customize it later.
          </p>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.chartOfAccounts}
              onChange={(e) => setFormData({ ...formData, chartOfAccounts: e.target.checked })}
              className="mr-2"
            />
            <span>I understand the chart of accounts setup</span>
          </label>
        </div>
      ),
    },
    {
      title: 'Bank Connection',
      component: (
        <div>
          <h2 className="text-2xl font-bold mb-4">Connect your bank account</h2>
          <p className="text-gray-600 mb-4">
            Connect your bank account to automatically import transactions. You can skip this and do it later.
          </p>
          <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Connect Bank Account
          </button>
          <button
            onClick={() => setFormData({ ...formData, bankConnected: true })}
            className="ml-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Skip for now
          </button>
        </div>
      ),
    },
    {
      title: 'First Document',
      component: (
        <div>
          <h2 className="text-2xl font-bold mb-4">Upload your first document</h2>
          <p className="text-gray-600 mb-4">
            Upload a receipt or invoice to see how our AI processes it. You can upload more later.
          </p>
          <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Upload Document
          </button>
          <button
            onClick={() => setFormData({ ...formData, firstDocument: true })}
            className="ml-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Skip for now
          </button>
        </div>
      ),
    },
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600">Step {currentStep + 1} of {steps.length}</span>
            <span className="text-sm text-gray-600">
              {Math.round(((currentStep + 1) / steps.length) * 100)}% complete
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="mb-6">
          {steps[currentStep].component}
        </div>

        <div className="flex justify-between">
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <button
            onClick={handleNext}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {currentStep === steps.length - 1 ? 'Complete Setup' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
