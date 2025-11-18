import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('onboarding-service');

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  component: string;
  action?: string;
  completed: boolean;
  order: number;
}

export interface Tutorial {
  id: string;
  name: string;
  description: string;
  steps: TutorialStep[];
  completed: boolean;
}

/**
 * Contextual help and tutorial engine
 * Provides guided tours and contextual help based on user progress
 */
export class TutorialEngine {
  private tutorials: Map<string, Tutorial> = new Map();

  constructor() {
    this.initializeTutorials();
  }

  private initializeTutorials(): void {
    // Getting Started Tutorial
    this.tutorials.set('getting-started', {
      id: 'getting-started',
      name: 'Getting Started',
      description: 'Learn the basics of using AI Accountant',
      steps: [
        {
          id: 'welcome',
          title: 'Welcome to AI Accountant',
          description: 'Your AI-powered accounting assistant is ready to help you manage your finances.',
          component: 'Dashboard',
          order: 1,
          completed: false,
        },
        {
          id: 'upload-document',
          title: 'Upload Your First Document',
          description: 'Upload receipts, invoices, or bank statements to get started.',
          component: 'DocumentUpload',
          action: 'upload',
          order: 2,
          completed: false,
        },
        {
          id: 'view-ledger',
          title: 'View Your Ledger',
          description: 'See how your transactions are automatically posted to the ledger.',
          component: 'LedgerView',
          action: 'view',
          order: 3,
          completed: false,
        },
        {
          id: 'ask-assistant',
          title: 'Ask the AI Assistant',
          description: 'Get answers to your accounting questions using our AI assistant.',
          component: 'AssistantChat',
          action: 'chat',
          order: 4,
          completed: false,
        },
      ],
      completed: false,
    });

    // Bank Connection Tutorial
    this.tutorials.set('bank-connection', {
      id: 'bank-connection',
      name: 'Connect Your Bank',
      description: 'Learn how to connect your bank account for automatic transaction import',
      steps: [
        {
          id: 'select-provider',
          title: 'Select Bank Provider',
          description: 'Choose your bank from the list of supported providers.',
          component: 'BankConnectionsPanel',
          action: 'select-provider',
          order: 1,
          completed: false,
        },
        {
          id: 'authorize',
          title: 'Authorize Connection',
          description: 'Securely authorize the connection to your bank account.',
          component: 'BankConnectionsPanel',
          action: 'authorize',
          order: 2,
          completed: false,
        },
        {
          id: 'sync-transactions',
          title: 'Sync Transactions',
          description: 'Your transactions will be automatically imported and matched.',
          component: 'BankConnectionsPanel',
          action: 'sync',
          order: 3,
          completed: false,
        },
      ],
      completed: false,
    });

    // Tax Filing Tutorial
    this.tutorials.set('tax-filing', {
      id: 'tax-filing',
      name: 'File Your Taxes',
      description: 'Learn how to prepare and submit your tax filings',
      steps: [
        {
          id: 'generate-filing',
          title: 'Generate Filing',
          description: 'Create a tax filing for your selected period.',
          component: 'FilingPanel',
          action: 'generate',
          order: 1,
          completed: false,
        },
        {
          id: 'review-filing',
          title: 'Review Filing',
          description: 'Review the calculated amounts and ensure accuracy.',
          component: 'FilingReviewPanel',
          action: 'review',
          order: 2,
          completed: false,
        },
        {
          id: 'submit-filing',
          title: 'Submit Filing',
          description: 'Submit your filing to HMRC after review and approval.',
          component: 'FilingPanel',
          action: 'submit',
          order: 3,
          completed: false,
        },
      ],
      completed: false,
    });
  }

  /**
   * Get available tutorials for a user
   */
  getAvailableTutorials(_tenantId: TenantId, _userId: UserId): Tutorial[] {
    return Array.from(this.tutorials.values());
  }

  /**
   * Get a specific tutorial
   */
  getTutorial(tutorialId: string): Tutorial | undefined {
    return this.tutorials.get(tutorialId);
  }

  /**
   * Get the next step in a tutorial
   */
  getNextStep(tutorialId: string, currentStepId?: string): TutorialStep | null {
    const tutorial = this.tutorials.get(tutorialId);
    if (!tutorial) {
      return null;
    }

    if (!currentStepId) {
      return tutorial.steps[0] || null;
    }

    const currentIndex = tutorial.steps.findIndex(s => s.id === currentStepId);
    if (currentIndex === -1 || currentIndex >= tutorial.steps.length - 1) {
      return null;
    }

    return tutorial.steps[currentIndex + 1] || null;
  }

  /**
   * Mark a tutorial step as completed
   */
  completeStep(tutorialId: string, stepId: string): boolean {
    const tutorial = this.tutorials.get(tutorialId);
    if (!tutorial) {
      return false;
    }

    const step = tutorial.steps.find(s => s.id === stepId);
    if (!step) {
      return false;
    }

    step.completed = true;

    // Check if all steps are completed
    tutorial.completed = tutorial.steps.every(s => s.completed);

    logger.info('Tutorial step completed', { tutorialId, stepId, tutorialCompleted: tutorial.completed });

    return true;
  }

  /**
   * Get contextual help for a component
   */
  getContextualHelp(component: string, action?: string): string | null {
    // Find relevant tutorial steps
    for (const tutorial of this.tutorials.values()) {
      const relevantStep = tutorial.steps.find(
        step => step.component === component && (!action || step.action === action)
      );

      if (relevantStep) {
        return relevantStep.description;
      }
    }

    // Default help messages
    const defaultHelp: Record<string, string> = {
      Dashboard: 'Your dashboard shows an overview of your financial data, upcoming deadlines, and key metrics.',
      DocumentUpload: 'Upload receipts, invoices, or bank statements. The system will automatically extract data.',
      LedgerView: 'View all your accounting entries. The ledger follows double-entry accounting principles.',
      AssistantChat: 'Ask questions about your finances, tax obligations, or accounting practices.',
      BankConnectionsPanel: 'Connect your bank accounts to automatically import transactions.',
      FilingPanel: 'Generate and submit tax filings to HMRC.',
    };

    return defaultHelp[component] || null;
  }

  /**
   * Reset a tutorial (for testing or restarting)
   */
  resetTutorial(tutorialId: string): boolean {
    const tutorial = this.tutorials.get(tutorialId);
    if (!tutorial) {
      return false;
    }

    tutorial.steps.forEach(step => {
      step.completed = false;
    });
    tutorial.completed = false;

    return true;
  }
}

// Singleton instance
export const tutorialEngine = new TutorialEngine();
