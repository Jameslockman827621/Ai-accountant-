'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('AutopilotDashboard');

interface AutopilotAgenda {
  id: string;
  agendaDate: string;
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  overdueTasks: number;
  urgentCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  onTrackCount: number;
  atRiskCount: number;
  breachedCount: number;
}

interface AutopilotTask {
  id: string;
  taskType: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  severity: 'normal' | 'warning' | 'critical';
  assignedTo: string | null;
  dueDate: string | null;
  aiSummary: string | null;
  recommendedAction: string | null;
  createdAt: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface AutopilotDashboardProps {
  token: string;
  tenantId: string;
}

export default function AutopilotDashboard({ token, tenantId }: AutopilotDashboardProps) {
  const [agenda, setAgenda] = useState<AutopilotAgenda | null>(null);
  const [tasks, setTasks] = useState<AutopilotTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [selectedTask, setSelectedTask] = useState<AutopilotTask | null>(null);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const loadDashboard = async () => {
    try {
      // Generate or get today's agenda
      const agendaRes = await fetch(`${API_BASE}/api/automation/autopilot/agenda`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ date: new Date().toISOString().split('T')[0] }),
      });

      if (agendaRes.ok) {
        const agendaData = await agendaRes.json();
        setAgenda(agendaData.agenda);
      }

      // Load tasks
      const status = filter === 'all' ? undefined : filter;
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      params.append('limit', '50');

      const tasksRes = await fetch(`${API_BASE}/api/automation/tasks?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        setTasks(tasksData.tasks || []);
      }
    } catch (error) {
      logger.error('Failed to load autopilot dashboard', error);
    } finally {
      setLoading(false);
    }
  };

  const generateAgenda = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/automation/autopilot/agenda`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ date: new Date().toISOString().split('T')[0] }),
      });

      if (response.ok) {
        const data = await response.json();
        setAgenda(data.agenda);
        await loadDashboard();
      }
    } catch (error) {
      logger.error('Failed to generate agenda', error);
      alert('Failed to generate agenda');
    }
  };

  if (loading) {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Daily Autopilot</h1>
          <p className="text-gray-600 mt-1">AI-managed workflow and task automation</p>
        </div>
        <button
          onClick={generateAgenda}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Refresh Agenda
        </button>
      </div>

      {/* Agenda Summary */}
      {agenda && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard
            title="Total Tasks"
            value={agenda.totalTasks}
            color="blue"
          />
          <MetricCard
            title="Pending"
            value={agenda.pendingTasks}
            color="yellow"
          />
          <MetricCard
            title="In Progress"
            value={agenda.inProgressTasks}
            color="blue"
          />
          <MetricCard
            title="Completed"
            value={agenda.completedTasks}
            color="green"
          />
        </div>
      )}

      {/* Priority Breakdown */}
      {agenda && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Priority Breakdown</h2>
          <div className="grid grid-cols-4 gap-4">
            <PriorityCard priority="urgent" count={agenda.urgentCount} />
            <PriorityCard priority="high" count={agenda.highCount} />
            <PriorityCard priority="medium" count={agenda.mediumCount} />
            <PriorityCard priority="low" count={agenda.lowCount} />
          </div>
        </div>
      )}

      {/* SLA Status */}
      {agenda && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">SLA Status</h2>
          <div className="grid grid-cols-3 gap-4">
            <SLACard status="on_track" count={agenda.onTrackCount} />
            <SLACard status="at_risk" count={agenda.atRiskCount} />
            <SLACard status="breached" count={agenda.breachedCount} />
          </div>
        </div>
      )}

      {/* Tasks List */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
          <div className="flex items-center space-x-2">
            {(['all', 'pending', 'in_progress', 'completed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-sm font-medium ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {tasks.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No tasks found</p>
          ) : (
            tasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setSelectedTask(task)}
                selected={selectedTask?.id === task.id}
              />
            ))
          )}
        </div>
      </div>

      {/* Task Detail */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          token={token}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

function MetricCard({ title, value, color }: { title: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80">{title}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

function PriorityCard({ priority, count }: { priority: string; count: number }) {
  const colors: Record<string, string> = {
    urgent: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <p className="text-sm font-medium text-gray-600 mb-1 capitalize">{priority}</p>
      <p className="text-2xl font-bold">{count}</p>
    </div>
  );
}

function SLACard({ status, count }: { status: string; count: number }) {
  const colors: Record<string, string> = {
    on_track: 'bg-green-100 text-green-800',
    at_risk: 'bg-yellow-100 text-yellow-800',
    breached: 'bg-red-100 text-red-800',
  };

  return (
    <div className={`p-4 rounded-lg border ${colors[status]}`}>
      <p className="text-sm font-medium mb-1 capitalize">{status.replace('_', ' ')}</p>
      <p className="text-2xl font-bold">{count}</p>
    </div>
  );
}

function TaskCard({
  task,
  onClick,
  selected,
}: {
  task: AutopilotTask;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-lg border cursor-pointer transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            <SeverityBadge severity={task.severity} />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">{task.title}</h3>
          {task.description && (
            <p className="text-sm text-gray-600 mb-2">{task.description}</p>
          )}
          {task.aiSummary && (
            <p className="text-xs text-gray-500 italic mb-2">AI: {task.aiSummary}</p>
          )}
          <div className="flex items-center space-x-4 text-xs text-gray-500">
            <span className="capitalize">{task.taskType.replace('_', ' ')}</span>
            {task.dueDate && (
              <span>Due: {new Date(task.dueDate).toLocaleString()}</span>
            )}
            {task.assignedTo && <span>Assigned</span>}
          </div>
        </div>
        {task.recommendedAction && (
          <div className="ml-4 text-right">
            <p className="text-xs text-gray-500 mb-1">Recommended:</p>
            <p className="text-xs font-medium text-blue-600">{task.recommendedAction}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskDetailPanel({
  task,
  token,
  onClose,
}: {
  task: AutopilotTask;
  token: string;
  onClose: () => void;
}) {
  const [executing, setExecuting] = useState(false);
  const [simulation, setSimulation] = useState(false);

  const executeTask = async (simulate: boolean) => {
    setExecuting(true);
    try {
      const response = await fetch(`${API_BASE}/api/automation/tasks/${task.id}/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          executionMethod: 'ai_supervised',
          simulation: simulate,
        }),
      });

      if (!response.ok) throw new Error('Execution failed');

      const data = await response.json();
      if (simulate) {
        alert(`Simulation result: ${JSON.stringify(data.result, null, 2)}`);
      } else {
        alert('Task executed successfully');
        onClose();
      }
    } catch (error) {
      logger.error('Task execution failed', error);
      alert('Failed to execute task');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Task Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <p className="text-sm text-gray-900">{task.title}</p>
          </div>

          {task.description && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <p className="text-sm text-gray-600">{task.description}</p>
            </div>
          )}

          {task.aiSummary && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AI Summary</label>
              <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded">{task.aiSummary}</p>
            </div>
          )}

          {task.recommendedAction && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recommended Action</label>
              <p className="text-sm text-gray-900 font-medium">{task.recommendedAction}</p>
            </div>
          )}

          <div className="flex items-center space-x-4">
            <button
              onClick={() => executeTask(true)}
              disabled={executing}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              {executing ? 'Simulating...' : 'Simulate'}
            </button>
            <button
              onClick={() => executeTask(false)}
              disabled={executing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {executing ? 'Executing...' : 'Execute'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: AutopilotTask['priority'] }) {
  const colors = {
    urgent: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[priority]}`}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

function StatusBadge({ status }: { status: AutopilotTask['status'] }) {
  const colors = {
    pending: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: AutopilotTask['severity'] }) {
  const colors = {
    normal: 'bg-gray-100 text-gray-800',
    warning: 'bg-yellow-100 text-yellow-800',
    critical: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[severity]}`}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}
