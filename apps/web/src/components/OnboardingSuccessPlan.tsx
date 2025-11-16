'use client';

import { useState, useEffect } from 'react';

interface SuccessPlanProps {
  token: string;
  tenantId: string;
}

interface PlanItem {
  id: string;
  title: string;
  description: string;
  status: 'completed' | 'pending' | 'in_progress';
  actionUrl?: string;
  estimatedTime?: string;
  priority: 'high' | 'medium' | 'low';
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function OnboardingSuccessPlan({ token, tenantId }: SuccessPlanProps) {
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [intentProfile, setIntentProfile] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    loadSuccessPlan();
  }, [tenantId]);

  const loadSuccessPlan = async () => {
    try {
      // Load intent profile
      const profileResponse = await fetch(`${API_BASE}/api/intent-profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        setIntentProfile(profileData.profile);
      }

      // Load connectors
      const connectorsResponse = await fetch(`${API_BASE}/api/connectors`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const connectors = connectorsResponse.ok ? (await connectorsResponse.json()).connectors : [];

      // Generate plan items based on profile and connectors
      const items = generatePlanItems(intentProfile, connectors);
      setPlanItems(items);
    } catch (error) {
      console.error('Failed to load success plan', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generatePlanItems = (
    profile: Record<string, unknown> | null,
    connectors: any[]
  ): PlanItem[] => {
    const items: PlanItem[] = [];

    // Chart of accounts
    items.push({
      id: 'chart_of_accounts',
      title: 'Review Chart of Accounts',
      description: 'Your chart of accounts has been provisioned. Review and customize as needed.',
      status: profile ? 'completed' : 'pending',
      actionUrl: '/chart-of-accounts',
      estimatedTime: '5 min',
      priority: 'high',
    });

    // Bank connection
    const hasBankConnector = connectors.some(
      (c) => c.connectorType === 'bank' && c.status === 'enabled'
    );
    items.push({
      id: 'bank_connection',
      title: 'Connect Bank Account',
      description: 'Connect at least one bank account for automatic transaction import.',
      status: hasBankConnector ? 'completed' : 'pending',
      actionUrl: '/onboarding?step=bank_connection',
      estimatedTime: '3 min',
      priority: 'high',
    });

    // Tax authority connection
    const hasTaxConnector = connectors.some(
      (c) => c.connectorType === 'tax_authority' && c.status === 'enabled'
    );
    const needsTaxConnector = profile?.vatRegistered || profile?.taxObligations?.length > 0;
    if (needsTaxConnector) {
      items.push({
        id: 'tax_authority',
        title: 'Connect Tax Authority',
        description: 'Authorize access to HMRC/IRS/CRA for automated filing submissions.',
        status: hasTaxConnector ? 'completed' : 'pending',
        actionUrl: '/onboarding?step=connectors',
        estimatedTime: '5 min',
        priority: 'high',
      });
    }

    // Filing calendar
    items.push({
      id: 'filing_calendar',
      title: 'Review Filing Calendar',
      description: 'Your filing calendar has been generated. Review due dates and reminders.',
      status: profile ? 'completed' : 'pending',
      actionUrl: '/filings/calendar',
      estimatedTime: '3 min',
      priority: 'medium',
    });

    // First document upload
    items.push({
      id: 'first_document',
      title: 'Upload Your First Document',
      description: 'Upload a receipt or invoice to see the AI extraction in action.',
      status: 'pending',
      actionUrl: '/documents/upload',
      estimatedTime: '2 min',
      priority: 'low',
    });

    // AI assistant test
    items.push({
      id: 'ai_assistant',
      title: 'Try the AI Assistant',
      description: 'Ask the AI assistant a question about your finances to see it in action.',
      status: 'pending',
      actionUrl: '/assistant',
      estimatedTime: '2 min',
      priority: 'low',
    });

    return items;
  };

  const getStatusIcon = (status: PlanItem['status']) => {
    switch (status) {
      case 'completed':
        return (
          <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        );
      case 'in_progress':
        return (
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        );
      default:
        return (
          <div className="w-5 h-5 border-2 border-gray-300 rounded-full"></div>
        );
    }
  };

  const getPriorityColor = (priority: PlanItem['priority']) => {
    switch (priority) {
      case 'high':
        return 'border-l-orange-500 bg-orange-50';
      case 'medium':
        return 'border-l-blue-500 bg-blue-50';
      default:
        return 'border-l-gray-300 bg-gray-50';
    }
  };

  const completedCount = planItems.filter((item) => item.status === 'completed').length;
  const progressPercentage = planItems.length > 0 ? (completedCount / planItems.length) * 100 : 0;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Your Success Plan</h2>
        <p className="text-gray-600">
          Here's what your AI accountant will do next. Complete these steps to get the most out of your setup.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Progress</span>
          <span className="font-medium text-gray-900">
            {completedCount} of {planItems.length} completed
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
      </div>

      <div className="space-y-3">
        {planItems.map((item) => (
          <div
            key={item.id}
            className={`rounded-lg border-l-4 p-4 ${getPriorityColor(item.priority)}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3 flex-1">
                <div className="mt-0.5">{getStatusIcon(item.status)}</div>
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-semibold text-gray-900">{item.title}</h3>
                    {item.priority === 'high' && (
                      <span className="px-2 py-0.5 text-xs font-medium text-orange-700 bg-orange-100 rounded">
                        High Priority
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                  <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                    {item.estimatedTime && <span>⏱️ {item.estimatedTime}</span>}
                    {item.actionUrl && (
                      <a
                        href={item.actionUrl}
                        className="text-blue-600 hover:text-blue-700 font-medium"
                      >
                        {item.status === 'completed' ? 'View' : 'Complete'} →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {completedCount === planItems.length && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4">
          <div className="flex items-center space-x-2 text-green-700">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-medium">All setup tasks completed!</span>
          </div>
          <p className="text-sm text-green-700 mt-2">
            Your AI accountant is fully configured and ready to automate your finances.
          </p>
        </div>
      )}

      <div className="pt-4 border-t border-gray-200">
        <p className="text-sm text-gray-600">
          <strong>Need help?</strong> Contact our support team or schedule a call with our onboarding specialist.
        </p>
        <div className="mt-3 flex space-x-3">
          <a
            href="/support"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Contact Support
          </a>
          <a
            href="/onboarding/concierge"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Schedule Call
          </a>
        </div>
      </div>
    </div>
  );
}
