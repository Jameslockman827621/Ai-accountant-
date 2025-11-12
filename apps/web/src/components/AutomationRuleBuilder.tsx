import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

interface RuleConfig {
  name: string;
  description: string;
  trigger: {
    type: 'transaction' | 'document' | 'schedule' | 'threshold';
    conditions: Record<string, unknown>;
  };
  actions: Array<{
    type: 'categorize' | 'post_to_ledger' | 'send_notification';
    parameters: Record<string, unknown>;
  }>;
}

export function AutomationRuleBuilder() {
  const { token } = useAuth();
  const [rule, setRule] = useState<RuleConfig>({
    name: '',
    description: '',
    trigger: {
      type: 'transaction',
      conditions: {},
    },
    actions: [],
  });

  const handleSave = async () => {
    try {
      const response = await fetch('/api/automation/rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(rule),
      });

      if (response.ok) {
        alert('Rule saved successfully');
      }
    } catch (error) {
      console.error('Failed to save rule', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Create Automation Rule</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Rule Name
        </label>
        <input
          type="text"
          value={rule.name}
          onChange={(e) => setRule({ ...rule, name: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          placeholder="e.g., Auto-categorize office supplies"
        />
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Trigger Type
        </label>
        <select
          value={rule.trigger.type}
          onChange={(e) =>
            setRule({
              ...rule,
              trigger: { ...rule.trigger, type: e.target.value as RuleConfig['trigger']['type'] },
            })
          }
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="transaction">Transaction</option>
          <option value="document">Document</option>
          <option value="schedule">Schedule</option>
          <option value="threshold">Threshold</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Actions
        </label>
        <button
          onClick={() =>
            setRule({
              ...rule,
              actions: [
                ...rule.actions,
                { type: 'categorize', parameters: {} },
              ],
            })
          }
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Add Action
        </button>
      </div>

      <button
        onClick={handleSave}
        className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
      >
        Save Rule
      </button>
    </div>
  );
}
