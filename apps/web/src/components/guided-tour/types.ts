export interface GuidedTourStep {
  id: string;
  title: string;
  description: string;
  helpArticleId?: string;
}

export interface GuidedTour {
  id: string;
  title: string;
  description: string;
  steps: GuidedTourStep[];
  completedSteps: string[];
  completion: number;
}

export interface GuidedChecklistItem {
  id: string;
  title: string;
  description: string;
  helpArticleId?: string;
}

export interface GuidedChecklist {
  id: string;
  title: string;
  summary: string;
  items: GuidedChecklistItem[];
  completedItemIds: string[];
  completion: number;
}

export interface SampleDatasetTask {
  id: string;
  title: string;
  description: string;
  helpArticleId?: string;
}

export interface SampleDataset {
  id: string;
  name: string;
  industry: string;
  records: number;
  description: string;
  tasks: SampleDatasetTask[];
  completedTaskIds: string[];
  completion: number;
}

export interface GuidedExperienceResponse {
  tours: GuidedTour[];
  checklists: GuidedChecklist[];
  sampleDatasets: SampleDataset[];
}
