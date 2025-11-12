import React, { useState } from 'react';

interface FAQ {
  question: string;
  answer: string;
  category: string;
}

const faqs: FAQ[] = [
  {
    category: 'Getting Started',
    question: 'How do I upload my first document?',
    answer: 'Click the "Upload Document" button on the dashboard, select your file (PDF, image, or CSV), and the system will automatically process it.',
  },
  {
    category: 'Getting Started',
    question: 'How do I connect my bank account?',
    answer: 'Go to Settings > Bank Connections, choose your bank provider (Plaid or TrueLayer), and follow the authentication flow.',
  },
  {
    category: 'Tax Filing',
    question: 'How do I submit a VAT return?',
    answer: 'Navigate to Filings, create a new VAT filing for your period, review the calculated amounts, and submit to HMRC.',
  },
  {
    category: 'Tax Filing',
    question: 'Can I edit a filing before submission?',
    answer: 'Yes, filings in draft status can be edited. Once submitted, you can only amend through HMRC.',
  },
  {
    category: 'Documents',
    question: 'What if OCR extracts incorrect data?',
    answer: 'You can review and edit extracted data in the Document Review queue. Documents with low confidence scores are flagged for review.',
  },
  {
    category: 'Billing',
    question: 'How do I change my subscription tier?',
    answer: 'Go to Subscription Management, click "Upgrade Plan", and select your desired tier. Changes take effect immediately.',
  },
];

export default function HelpCenter() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = Array.from(new Set(faqs.map(faq => faq.category)));

  const filteredFAQs = faqs.filter(faq => {
    const matchesSearch = searchQuery === '' || 
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || faq.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Help Center</h1>

      <div className="mb-6">
        <input
          type="text"
          placeholder="Search for help..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full border rounded px-4 py-2"
        />
      </div>

      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded ${
              selectedCategory === null
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded ${
                selectedCategory === category
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filteredFAQs.map((faq, index) => (
          <div key={index} className="border rounded p-4">
            <h3 className="font-semibold mb-2">{faq.question}</h3>
            <p className="text-gray-600">{faq.answer}</p>
            <span className="text-xs text-gray-400 mt-2 block">{faq.category}</span>
          </div>
        ))}
      </div>

      {filteredFAQs.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">No results found. Try a different search term.</p>
        </div>
      )}

      <div className="mt-8 border-t pt-6">
        <h2 className="text-xl font-semibold mb-4">Still need help?</h2>
        <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Contact Support
        </button>
      </div>
    </div>
  );
}
