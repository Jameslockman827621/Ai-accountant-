'use client';

import LoginForm from '@/components/LoginForm';
import { useAuth } from '@/hooks/useAuth';
import { GettingStartedTours } from '@/components/guided-tour/GettingStartedTours';
import { SampleDatasetTasks } from '@/components/guided-tour/SampleDatasetTasks';
import { useGuidedExperience } from '@/components/guided-tour/useGuidedExperience';

export default function HomePage() {
  const { user, token } = useAuth();
  const { data, isLoading, error, completeTourStep, updateChecklistItem, completeDatasetTask } = useGuidedExperience(token);

  if (!user || !token) {
    return <LoginForm />;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex flex-col gap-2">
          <p className="text-sm text-gray-500">Welcome back</p>
          <h1 className="text-3xl font-bold text-gray-900">Home</h1>
          <p className="text-sm text-gray-600">Getting started resources, datasets, and walkthroughs.</p>
        </header>

        {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-red-800 text-sm">{error}</div>}

        {isLoading || !data ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-gray-600">Loading guided experience…</div>
        ) : (
          <>
            <GettingStartedTours
              tours={data.tours}
              checklists={data.checklists}
              onCompleteTourStep={completeTourStep}
              onToggleChecklistItem={updateChecklistItem}
            />

            <SampleDatasetTasks datasets={data.sampleDatasets} onCompleteTask={completeDatasetTask} />
          </>
        )}
      </div>
    </div>
  );
}
