'use client';

import { CheckCircleIcon, LinkIcon } from '@heroicons/react/24/outline';
import type { SampleDataset } from './types';

interface SampleDatasetTasksProps {
  datasets: SampleDataset[];
  onCompleteTask: (datasetId: string, taskId: string) => void | Promise<void>;
}

export function SampleDatasetTasks({ datasets, onCompleteTask }: SampleDatasetTasksProps) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-emerald-700">Sample datasets</p>
          <h2 className="text-2xl font-semibold text-gray-900">Practice environments</h2>
          <p className="text-sm text-gray-600">Pre-built data you can explore without touching production books.</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {datasets.map(dataset => (
          <div key={dataset.id} className="rounded-xl border border-emerald-100 bg-white/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{dataset.name}</h3>
                <p className="text-sm text-gray-600">{dataset.industry} · {dataset.records.toLocaleString()} records</p>
                <p className="mt-1 text-sm text-gray-600">{dataset.description}</p>
              </div>
              <span className="text-sm font-medium text-emerald-700">{dataset.completion}%</span>
            </div>
            <div className="mt-3 space-y-3">
              {dataset.tasks.map(task => {
                const isDone = dataset.completedTaskIds.includes(task.id);
                return (
                  <div key={task.id} className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircleIcon
                        className={`h-5 w-5 ${isDone ? 'text-green-600' : 'text-gray-300'}`}
                        aria-hidden
                      />
                      <p className="font-medium text-gray-900">{task.title}</p>
                    </div>
                    <p className="ml-7 text-sm text-gray-700">{task.description}</p>
                    <div className="mt-2 flex items-center justify-between">
                      {task.helpArticleId && (
                        <a
                          href={`/knowledge/${task.helpArticleId}`}
                          className="ml-7 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                        >
                          <LinkIcon className="h-4 w-4" aria-hidden />
                          How to
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onCompleteTask(dataset.id, task.id)}
                        disabled={isDone}
                        className="ml-auto inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isDone ? 'Completed' : 'Mark done'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
