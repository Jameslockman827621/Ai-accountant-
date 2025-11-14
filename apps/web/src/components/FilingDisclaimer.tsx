import React, { useState } from 'react';

interface FilingDisclaimerProps {
  onAccept: () => void;
  onCancel: () => void;
}

export default function FilingDisclaimer({ onAccept, onCancel }: FilingDisclaimerProps) {
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">Important: Review Before Submission</h2>
        
        <div className="space-y-4 mb-6">
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
            <p className="font-semibold text-yellow-800">Please Review Carefully</p>
            <p className="text-yellow-700 mt-2">
              You are about to submit a tax filing to HMRC. Please ensure all information is accurate and complete.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">By submitting, you acknowledge:</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>You have reviewed all calculations and data</li>
              <li>All information is accurate to the best of your knowledge</li>
              <li>You understand that incorrect filings may result in penalties</li>
              <li>You are responsible for the accuracy of the submission</li>
              <li>We recommend consulting with a qualified accountant for complex situations</li>
            </ul>
          </div>

          <div className="bg-red-50 border-l-4 border-red-400 p-4">
            <p className="font-semibold text-red-800">Limitation of Liability</p>
            <p className="text-red-700 mt-2">
              AI Accountant SaaS provides tools and assistance but does not guarantee the accuracy of tax calculations.
              You are solely responsible for reviewing and approving all filings before submission.
            </p>
          </div>
        </div>

        <div className="flex items-center mb-6">
          <input
            type="checkbox"
            id="accept"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mr-2 h-4 w-4"
          />
          <label htmlFor="accept" className="text-sm">
            I have read and understand the above. I accept responsibility for this filing submission.
          </label>
        </div>

        <div className="flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onAccept}
            disabled={!accepted}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Proceed with Submission
          </button>
        </div>
      </div>
    </div>
  );
}
