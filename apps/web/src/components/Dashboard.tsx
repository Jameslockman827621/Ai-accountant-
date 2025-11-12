'use client';

import { useState, useEffect } from 'react';
import DocumentUpload from './DocumentUpload';
import AssistantChat from './AssistantChat';
import LedgerView from './LedgerView';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface DashboardProps {
  user: User;
  token: string;
  onLogout: () => void;
}

export default function Dashboard({ user, token, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'documents' | 'ledger' | 'assistant'>('documents');
  const [documents, setDocuments] = useState<any[]>([]);

  useEffect(() => {
    fetchDocuments();
  }, [token]);

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/documents`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-primary-600">AI Accountant</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <button
                  onClick={() => setActiveTab('documents')}
                  className={`border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'documents' ? 'border-primary-500 text-primary-600' : ''
                  }`}
                >
                  Documents
                </button>
                <button
                  onClick={() => setActiveTab('ledger')}
                  className={`border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'ledger' ? 'border-primary-500 text-primary-600' : ''
                  }`}
                >
                  Ledger
                </button>
                <button
                  onClick={() => setActiveTab('assistant')}
                  className={`border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'assistant' ? 'border-primary-500 text-primary-600' : ''
                  }`}
                >
                  Assistant
                </button>
              </div>
            </div>
            <div className="flex items-center">
              <span className="text-sm text-gray-700 mr-4">{user.name}</span>
              <button
                onClick={onLogout}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {activeTab === 'documents' && <DocumentUpload token={token} onUpload={fetchDocuments} />}
        {activeTab === 'ledger' && <LedgerView token={token} />}
        {activeTab === 'assistant' && <AssistantChat token={token} />}
      </main>
    </div>
  );
}
