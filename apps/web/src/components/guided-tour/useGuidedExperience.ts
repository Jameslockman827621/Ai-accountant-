'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GuidedExperienceResponse, GuidedChecklist, GuidedTour, SampleDataset } from './types';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export function useGuidedExperience(token: string | null) {
  const [data, setData] = useState<GuidedExperienceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback((): HeadersInit | null => {
    if (!token) return null;
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [token]);

  const fetchExperience = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) {
      setError('Missing authentication token');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/onboarding/guided-experience`, {
        headers,
      });
      if (!response.ok) {
        throw new Error('Failed to load guided experience');
      }
      const payload = (await response.json()) as GuidedExperienceResponse;
      setData(payload);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load guided experience');
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchExperience();
  }, [fetchExperience]);

  const completeTourStep = useCallback(
    async (tourId: string, stepId: string): Promise<GuidedTour[] | null> => {
      const headers = authHeaders();
      if (!headers) return null;

      try {
        const response = await fetch(
          `${API_BASE}/api/onboarding/guided-experience/tours/${tourId}/steps/${stepId}/complete`,
          { method: 'POST', headers }
        );
        if (!response.ok) {
          throw new Error('Unable to complete tour step');
        }
        const payload = (await response.json()) as { tours: GuidedTour[] };
        setData(current => (current ? { ...current, tours: payload.tours } : current));
        return payload.tours;
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Unable to complete tour step');
        return null;
      }
    },
    [authHeaders]
  );

  const updateChecklistItem = useCallback(
    async (checklistId: string, itemId: string, completed: boolean): Promise<GuidedChecklist[] | null> => {
      const headers = authHeaders();
      if (!headers) return null;

      try {
        const response = await fetch(
          `${API_BASE}/api/onboarding/guided-experience/checklists/${checklistId}/items/${itemId}`,
          { method: 'POST', headers, body: JSON.stringify({ completed }) }
        );
        if (!response.ok) {
          throw new Error('Unable to update checklist item');
        }
        const payload = (await response.json()) as { checklists: GuidedChecklist[] };
        setData(current => (current ? { ...current, checklists: payload.checklists } : current));
        return payload.checklists;
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Unable to update checklist item');
        return null;
      }
    },
    [authHeaders]
  );

  const completeDatasetTask = useCallback(
    async (datasetId: string, taskId: string): Promise<SampleDataset[] | null> => {
      const headers = authHeaders();
      if (!headers) return null;

      try {
        const response = await fetch(
          `${API_BASE}/api/onboarding/guided-experience/datasets/${datasetId}/tasks/${taskId}/complete`,
          { method: 'POST', headers }
        );
        if (!response.ok) {
          throw new Error('Unable to complete dataset task');
        }
        const payload = (await response.json()) as { sampleDatasets: SampleDataset[] };
        setData(current => (current ? { ...current, sampleDatasets: payload.sampleDatasets } : current));
        return payload.sampleDatasets;
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Unable to complete dataset task');
        return null;
      }
    },
    [authHeaders]
  );

  return {
    data,
    isLoading,
    error,
    refresh: fetchExperience,
    completeTourStep,
    updateChecklistItem,
    completeDatasetTask,
  };
}
