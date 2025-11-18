'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('TaskBoard');

interface AutopilotTask {
  id: string;
  taskType: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  severity: 'normal' | 'warning' | 'critical';
  assignedTo: string | null;
  assignedBy: string | null;
  assignmentMethod: string | null;
  autoAssigned: boolean;
  dueDate: string | null;
  slaHours: number | null;
  startedAt: string | null;
  completedAt: string | null;
  escalated: boolean;
  aiSummary: string | null;
  sourceEvidence: Record<string, unknown> | null;
  recommendedAction: string | null;
  confidenceScore: number | null;
  createdAt: string;
}

interface AssignmentSuggestion {
  userId: string;
  userName: string;
  role: string;
  confidence: number;
  reasons: string[];
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface TaskBoardProps {
  token: string;
  tenantId?: string;
  clientTenantId?: string; // For accountant view
}

export default function TaskBoard({ token, tenantId: _tenantId, clientTenantId }: TaskBoardProps) {
  const [tasks, setTasks] = useState<AutopilotTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{
    status?: string;
    priority?: string;
    assignedTo?: string;
    clientId?: string;
  }>({});
  const [selectedTask, setSelectedTask] = useState<AutopilotTask | null>(null);
  const [assignmentSuggestion, setAssignmentSuggestion] = useState<AssignmentSuggestion | null>(null);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 30000);
    return () => clearInterval(interval);
  }, [filter]);

  useEffect(() => {
    if (selectedTask && !selectedTask.assignedTo) {
      loadAssignmentSuggestion(selectedTask.id);
    }
  }, [selectedTask]);

    const updateFilter = (key: keyof typeof filter, value?: string) => {
      setFilter((prev) => {
        const next = { ...prev };
        if (value === undefined) {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
    };

    const loadTasks = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.priority) params.append('priority', filter.priority);
      if (filter.assignedTo) params.append('assignedTo', filter.assignedTo);
      params.append('limit', '100');

      const response = await fetch(`${API_BASE}/api/automation/tasks?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load tasks');

      const data = await response.json();
      let tasksList = data.tasks || [];

      // Filter by client if in accountant view
        if (clientTenantId) {
          tasksList = tasksList.filter(() => {
            // Would need tenant_id in task - for now show all
            return true;
          });
      }

      setTasks(tasksList);
    } catch (error) {
      logger.error('Failed to load tasks', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAssignmentSuggestion = async (taskId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/automation/tasks/${taskId}/suggest-assignment`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setAssignmentSuggestion(data.suggestion);
      }
    } catch (error) {
      logger.error('Failed to load assignment suggestion', error);
    }
  };

  const assignTask = async (taskId: string, method: string, userId?: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/automation/tasks/${taskId}/assign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method, userId }),
      });

      if (!response.ok) throw new Error('Assignment failed');

      await loadTasks();
      setSelectedTask(null);
    } catch (error) {
      logger.error('Failed to assign task', error);
      alert('Failed to assign task');
    }
  };

  const groupedTasks = {
    pending: tasks.filter(t => t.status === 'pending'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    completed: tasks.filter(t => t.status === 'completed'),
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
          <h1 className="text-3xl font-bold text-gray-900">Task Board</h1>
          <p className="text-gray-600 mt-1">Manage and track autopilot tasks</p>
        </div>
        <div className="flex items-center space-x-2">
            <select
              value={filter.status || 'all'}
              onChange={(e) =>
                updateFilter('status', e.target.value === 'all' ? undefined : e.target.value)
              }
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
            <select
              value={filter.priority || 'all'}
              onChange={(e) =>
                updateFilter('priority', e.target.value === 'all' ? undefined : e.target.value)
              }
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Pending Column */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Pending ({groupedTasks.pending.length})</h2>
            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">
              {groupedTasks.pending.filter(t => t.priority === 'urgent').length} urgent
            </span>
          </div>
          <div className="space-y-3">
            {groupedTasks.pending.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setSelectedTask(task)}
                selected={selectedTask?.id === task.id}
              />
            ))}
            {groupedTasks.pending.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No pending tasks</p>
            )}
          </div>
        </div>

        {/* In Progress Column */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">In Progress ({groupedTasks.in_progress.length})</h2>
          </div>
          <div className="space-y-3">
            {groupedTasks.in_progress.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setSelectedTask(task)}
                selected={selectedTask?.id === task.id}
              />
            ))}
            {groupedTasks.in_progress.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No tasks in progress</p>
            )}
          </div>
        </div>

        {/* Completed Column */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Completed ({groupedTasks.completed.length})</h2>
          </div>
          <div className="space-y-3">
            {groupedTasks.completed.slice(0, 10).map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setSelectedTask(task)}
                selected={selectedTask?.id === task.id}
              />
            ))}
            {groupedTasks.completed.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No completed tasks</p>
            )}
          </div>
        </div>
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          suggestion={assignmentSuggestion}
          token={token}
          onAssign={assignTask}
          onClose={() => {
            setSelectedTask(null);
            setAssignmentSuggestion(null);
          }}
        />
      )}
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
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <PriorityBadge priority={task.priority} />
        <SeverityBadge severity={task.severity} />
      </div>
      <h3 className="font-medium text-gray-900 text-sm mb-1">{task.title}</h3>
      {task.assignedTo && (
        <p className="text-xs text-gray-500 mt-1">Assigned</p>
      )}
      {task.dueDate && (
        <p className="text-xs text-gray-500 mt-1">
          Due: {new Date(task.dueDate).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function TaskDetailModal({
  task,
  suggestion,
  token,
  onAssign,
  onClose,
}: {
  task: AutopilotTask;
  suggestion: AssignmentSuggestion | null;
  token: string;
  onAssign: (taskId: string, method: string, userId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [executing, setExecuting] = useState(false);

  const executeTask = async (simulation: boolean) => {
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
          simulation,
        }),
      });

      if (!response.ok) throw new Error('Execution failed');

      if (simulation) {
        const data = await response.json();
        alert(`Simulation: ${JSON.stringify(data.result, null, 2)}`);
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
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

          {/* Assignment */}
          {!task.assignedTo && suggestion && (
            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-sm font-medium text-yellow-900 mb-2">Assignment Suggestion</p>
              <p className="text-sm text-yellow-800 mb-2">
                {suggestion.userName} ({suggestion.role}) - {Math.round(suggestion.confidence * 100)}% confidence
              </p>
              <div className="text-xs text-yellow-700">
                <p>Reasons:</p>
                <ul className="list-disc list-inside mt-1">
                  {suggestion.reasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => onAssign(task.id, 'ai_suggestion', suggestion.userId)}
                className="mt-3 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-sm"
              >
                Assign to {suggestion.userName}
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center space-x-4 pt-4 border-t">
            <button
              onClick={() => executeTask(true)}
              disabled={executing}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              {executing ? 'Simulating...' : 'Simulate'}
            </button>
            <button
              onClick={() => executeTask(false)}
              disabled={executing || task.status === 'completed'}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {executing ? 'Executing...' : 'Execute'}
            </button>
            <button
              onClick={() => onAssign(task.id, 'manual')}
              disabled={!!task.assignedTo}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {task.assignedTo ? 'Assigned' : 'Assign to Me'}
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
