'use client';

import { CheckCircleIcon, LinkIcon, PlayIcon } from '@heroicons/react/24/outline';
import type { GuidedChecklist, GuidedTour } from './types';

interface GettingStartedToursProps {
  tours: GuidedTour[];
  checklists: GuidedChecklist[];
  onCompleteTourStep: (tourId: string, stepId: string) => void | Promise<void>;
  onToggleChecklistItem: (checklistId: string, itemId: string, completed: boolean) => void | Promise<void>;
}

export function GettingStartedTours({
  tours,
  checklists,
  onCompleteTourStep,
  onToggleChecklistItem,
}: GettingStartedToursProps) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-blue-700 font-medium">Guided tours</p>
            <h2 className="text-2xl font-semibold text-gray-900">Getting started</h2>
            <p className="text-sm text-gray-600">Walkthroughs that spotlight your first wins.</p>
          </div>
        </div>
        {tours.map(tour => (
          <div key={tour.id} className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{tour.title}</h3>
                <p className="text-sm text-gray-600">{tour.description}</p>
              </div>
              <span className="text-sm font-medium text-blue-700">{tour.completion}%</span>
            </div>
            <div className="mt-4 space-y-3">
              {tour.steps.map(step => {
                const isDone = tour.completedSteps.includes(step.id);
                return (
                  <div
                    key={step.id}
                    className="flex items-start justify-between rounded-xl border border-blue-100 bg-white/70 p-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <CheckCircleIcon
                          className={`h-5 w-5 ${isDone ? 'text-green-600' : 'text-gray-300'}`}
                          aria-hidden
                        />
                        <p className="font-medium text-gray-900">{step.title}</p>
                      </div>
                      <p className="ml-7 text-sm text-gray-600">{step.description}</p>
                      {step.helpArticleId && (
                        <a
                          href={`/knowledge/${step.helpArticleId}`}
                          className="ml-7 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                        >
                          <LinkIcon className="h-4 w-4" aria-hidden />
                          View help article
                        </a>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onCompleteTourStep(tour.id, step.id)}
                      disabled={isDone}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <PlayIcon className="h-4 w-4" aria-hidden />
                      {isDone ? 'Done' : 'Mark done'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-sm text-indigo-700 font-medium">Checklists</p>
          <h2 className="text-2xl font-semibold text-gray-900">Operational readiness</h2>
          <p className="text-sm text-gray-600">Track security, controls, and launch gates in one place.</p>
        </div>
        {checklists.map(checklist => (
          <div key={checklist.id} className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{checklist.title}</h3>
                <p className="text-sm text-gray-600">{checklist.summary}</p>
              </div>
              <span className="text-sm font-medium text-indigo-700">{checklist.completion}%</span>
            </div>
            <div className="mt-4 space-y-3">
              {checklist.items.map(item => {
                const isDone = checklist.completedItemIds.includes(item.id);
                return (
                  <label
                    key={item.id}
                    className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-white/70 p-3"
                  >
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={e => onToggleChecklistItem(checklist.id, item.id, e.target.checked)}
                      className="mt-1 h-5 w-5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="font-medium text-gray-900">{item.title}</p>
                      <p className="text-sm text-gray-600">{item.description}</p>
                      {item.helpArticleId && (
                        <a
                          href={`/knowledge/${item.helpArticleId}`}
                          className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline"
                        >
                          <LinkIcon className="h-4 w-4" aria-hidden />
                          View help article
                        </a>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
