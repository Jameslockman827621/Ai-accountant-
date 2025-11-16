'use client';

import React from 'react';

interface AccountantReviewPromptProps {
  filingType: string;
  amount: number;
  onRequestReview?: () => void;
  onProceed?: () => void;
}

export default function AccountantReviewPrompt({
  filingType,
  amount,
  onRequestReview,
  onProceed,
}: AccountantReviewPromptProps) {
  const shouldRecommend = amount > 100000 || filingType === 'corporation_tax';

  if (!shouldRecommend) {
    return null;
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-blue-800">
            Professional Review Recommended
          </h3>
          <div className="mt-2 text-sm text-blue-700">
            <p>
              For {filingType} filings with amounts over £{amount.toLocaleString()}, we recommend
              having a qualified accountant review your filing before submission.
            </p>
            <p className="mt-2">
              This helps ensure accuracy and compliance with HMRC requirements.
            </p>
          </div>
          <div className="mt-4 flex gap-2">
            {onRequestReview && (
              <button
                onClick={onRequestReview}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Request Accountant Review
              </button>
            )}
            {onProceed && (
              <button
                onClick={onProceed}
                className="inline-flex items-center px-3 py-2 border border-blue-300 text-sm leading-4 font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Proceed Without Review
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
