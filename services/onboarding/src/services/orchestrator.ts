import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
// Email imports - would be from notification service in production
// For now, these would be called via HTTP or message queue

const logger = createLogger('onboarding-orchestrator');

export type OnboardingState =
  | 'initialized'
  | 'business_profile'
  | 'tax_scope'
  | 'kyc_pending'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'connectors'
  | 'chart_of_accounts'
  | 'filing_calendar'
  | 'ai_memory'
  | 'completed'
  | 'error';

export type OnboardingEvent =
  | 'start'
  | 'step_complete'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'connector_connected'
  | 'provision_complete'
  | 'error'
  | 'retry';

interface StateTransition {
  from: OnboardingState;
  to: OnboardingState;
  event: OnboardingEvent;
  condition?: (context: OnboardingContext) => boolean;
}

interface OnboardingContext {
  tenantId: TenantId;
  userId: UserId;
  sessionId: string;
  currentState: OnboardingState;
  completedSteps: string[];
  sessionData: Record<string, unknown>;
  errorState?: {
    error: string;
    retryCount: number;
  };
}

// State machine definition
const STATE_TRANSITIONS: StateTransition[] = [
  { from: 'initialized', to: 'business_profile', event: 'start' },
  { from: 'business_profile', to: 'tax_scope', event: 'step_complete' },
  { from: 'tax_scope', to: 'kyc_pending', event: 'step_complete' },
  { from: 'kyc_pending', to: 'kyc_approved', event: 'kyc_approved' },
  { from: 'kyc_pending', to: 'kyc_rejected', event: 'kyc_rejected' },
  { from: 'kyc_rejected', to: 'kyc_pending', event: 'retry' },
  { from: 'kyc_approved', to: 'connectors', event: 'step_complete' },
  { from: 'connectors', to: 'chart_of_accounts', event: 'step_complete' },
  { from: 'chart_of_accounts', to: 'filing_calendar', event: 'step_complete' },
  { from: 'filing_calendar', to: 'ai_memory', event: 'step_complete' },
  { from: 'ai_memory', to: 'completed', event: 'provision_complete' },
  { from: 'kyc_approved', to: 'completed', event: 'provision_complete' },
  { from: 'error', to: 'business_profile', event: 'retry' },
];

class OnboardingOrchestrator extends EventEmitter {
  async createSession(tenantId: TenantId, userId: UserId): Promise<string> {
    const sessionId = randomUUID();

    await db.query(
      `INSERT INTO onboarding_sessions (
        id, tenant_id, user_id, current_state, status, session_data
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        tenantId,
        userId,
        'initialized',
        'active',
        JSON.stringify({}),
      ]
    );

    logger.info('Onboarding session created', { sessionId, tenantId, userId });

    // Send welcome email
    try {
      const userResult = await db.query<{ email: string; name: string }>(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );
      const tenantResult = await db.query<{ name: string }>(
        'SELECT name FROM tenants WHERE id = $1',
        [tenantId]
      );

      if (userResult.rows.length > 0 && tenantResult.rows.length > 0) {
        // In production, call notification service to send welcome email
        // await sendOnboardingWelcome(userResult.rows[0].email, userResult.rows[0].name, tenantResult.rows[0].name);
        logger.info('Welcome email queued', { email: userResult.rows[0].email });
      }
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        logger.warn('Failed to send welcome email', { error: normalizedError.message });
      }

    return sessionId;
  }

  async getSession(sessionId: string): Promise<OnboardingContext | null> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      current_state: string;
      session_data: unknown;
      completed_steps: string[];
      error_state: unknown;
    }>(
      `SELECT id, tenant_id, user_id, current_state, session_data, 
              completed_steps, error_state
       FROM onboarding_sessions
       WHERE id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      tenantId: row.tenant_id,
      userId: row.user_id,
      sessionId: row.id,
      currentState: row.current_state as OnboardingState,
      completedSteps: row.completed_steps || [],
      sessionData: (row.session_data as Record<string, unknown>) || {},
      errorState: row.error_state ? (row.error_state as OnboardingContext['errorState']) : undefined,
    };
  }

  async transitionState(
    sessionId: string,
    event: OnboardingEvent,
    eventData?: Record<string, unknown>
  ): Promise<OnboardingState> {
    const context = await this.getSession(sessionId);
    if (!context) {
      throw new Error('Session not found');
    }

    const currentState = context.currentState;

    // Find valid transition
    const transition = STATE_TRANSITIONS.find(
      t => t.from === currentState && t.event === event
    );

    if (!transition) {
      throw new Error(`Invalid transition from ${currentState} with event ${event}`);
    }

    // Check condition if present
    if (transition.condition && !transition.condition(context)) {
      throw new Error(`Transition condition not met for ${currentState} -> ${transition.to}`);
    }

    const newState = transition.to;

    // Update session
    const updatedSessionData = {
      ...context.sessionData,
      ...eventData,
    };

    const stateHistory = await db.query<{ state_history: unknown }>(
      'SELECT state_history FROM onboarding_sessions WHERE id = $1',
      [sessionId]
    );

    const history = (stateHistory.rows[0]?.state_history as Array<{ state: string; timestamp: string; event: string }>) || [];
    history.push({
      state: newState,
      timestamp: new Date().toISOString(),
      event,
    });

    await db.query(
      `UPDATE onboarding_sessions
       SET current_state = $1,
           session_data = $2::jsonb,
           state_history = $3::jsonb,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [newState, JSON.stringify(updatedSessionData), JSON.stringify(history), sessionId]
    );

    logger.info('State transitioned', { sessionId, from: currentState, to: newState, event });

    // Emit event for downstream processing
    this.emit('state_changed', {
      sessionId,
      from: currentState,
      to: newState,
      event,
      context: { ...context, currentState: newState, sessionData: updatedSessionData },
    });

    // Trigger provisioning if needed
    if (newState === 'kyc_approved') {
      await this.triggerProvisioning(sessionId);
    }

    return newState;
  }

  async triggerProvisioning(sessionId: string): Promise<void> {
    const context = await this.getSession(sessionId);
    if (!context) {
      throw new Error('Session not found');
    }

    logger.info('Triggering provisioning', { sessionId, tenantId: context.tenantId });

    try {
      // Provision chart of accounts
      await this.provisionChartOfAccounts(context);

      // Generate filing calendar
      await this.generateFilingCalendar(context);

      // Create AI memory documents
      await this.createAIMemoryDocuments(context);

      // Transition to completed state
      await this.transitionState(sessionId, 'provision_complete');
      
      // Complete the session
      await this.completeSession(sessionId);
    } catch (error) {
      logger.error('Provisioning failed', error instanceof Error ? error : new Error(String(error)));
      await this.setErrorState(sessionId, error instanceof Error ? error.message : 'Provisioning failed');
      throw error;
    }
  }

  private async provisionChartOfAccounts(context: OnboardingContext): Promise<void> {
    const intentProfile = await db.query<{
      industry: string;
      accounting_method: string;
    }>(
      'SELECT industry, accounting_method FROM intent_profiles WHERE tenant_id = $1',
      [context.tenantId]
    );

    if (intentProfile.rows.length === 0) {
      logger.warn('No intent profile found for chart provisioning', { tenantId: context.tenantId });
      return;
    }

    const profile = intentProfile.rows[0];
    const template = this.getChartTemplate(profile.industry || 'standard');

    // Insert chart of accounts
    for (const account of template) {
      await db.query(
        `INSERT INTO chart_of_accounts (tenant_id, code, name, type, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [context.tenantId, account.code, account.name, account.type, true]
      );
    }

    logger.info('Chart of accounts provisioned', { tenantId: context.tenantId, accountCount: template.length });
  }

  private getChartTemplate(industry: string): Array<{ code: string; name: string; type: string }> {
    // Standard UK GAAP chart
    const standard = [
      { code: '1000', name: 'Cash and Bank', type: 'asset' },
      { code: '1100', name: 'Accounts Receivable', type: 'asset' },
      { code: '2000', name: 'Accounts Payable', type: 'liability' },
      { code: '3000', name: 'Equity', type: 'equity' },
      { code: '4000', name: 'Revenue', type: 'revenue' },
      { code: '5000', name: 'Cost of Sales', type: 'expense' },
      { code: '6000', name: 'Operating Expenses', type: 'expense' },
    ];

    // Industry-specific additions
    const industryAdditions: Record<string, Array<{ code: string; name: string; type: string }>> = {
      retail: [
        { code: '1200', name: 'Inventory', type: 'asset' },
        { code: '4100', name: 'Sales Revenue', type: 'revenue' },
      ],
      saas: [
        { code: '4100', name: 'Subscription Revenue', type: 'revenue' },
        { code: '4200', name: 'Professional Services Revenue', type: 'revenue' },
        { code: '1300', name: 'Deferred Revenue', type: 'liability' },
      ],
      services: [
        { code: '4100', name: 'Service Revenue', type: 'revenue' },
        { code: '5100', name: 'Direct Labor', type: 'expense' },
      ],
    };

    return [...standard, ...(industryAdditions[industry] || [])];
  }

  private async generateFilingCalendar(context: OnboardingContext): Promise<void> {
    const intentProfile = await db.query<{
      tax_obligations: string[];
      filing_frequency: string;
      primary_jurisdiction: string;
    }>(
      'SELECT tax_obligations, filing_frequency, primary_jurisdiction FROM intent_profiles WHERE tenant_id = $1',
      [context.tenantId]
    );

    if (intentProfile.rows.length === 0) {
      return;
    }

    const profile = intentProfile.rows[0];
    const obligations = (profile.tax_obligations as string[]) || [];
    const frequency = profile.filing_frequency || 'quarterly';
    const jurisdiction = profile.primary_jurisdiction;

    for (const obligation of obligations) {
      const filingType = this.mapObligationToFilingType(obligation);
      if (!filingType) continue;

      const nextDueDate = this.calculateNextDueDate(frequency);

      await db.query(
        `INSERT INTO filing_calendars (
          tenant_id, filing_type, jurisdiction, frequency, next_due_date,
          reminder_enabled, reminder_days_before, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT DO NOTHING`,
        [
          context.tenantId,
          filingType,
          jurisdiction,
          frequency,
          nextDueDate,
          true,
          5,
          true,
        ]
      );
    }

    logger.info('Filing calendar generated', { tenantId: context.tenantId, obligationCount: obligations.length });
  }

  private mapObligationToFilingType(obligation: string): string | null {
    const mapping: Record<string, string> = {
      vat: 'vat',
      corporation_tax: 'corporation_tax',
      self_assessment: 'self_assessment',
      paye: 'payroll',
      sales_tax: 'sales_tax',
    };
    return mapping[obligation] || null;
  }

  private calculateNextDueDate(frequency: string): Date {
    const now = new Date();
    const next = new Date(now);

    switch (frequency) {
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        next.setDate(7); // 7th of next month
        break;
      case 'quarterly':
        const quarter = Math.floor(now.getMonth() / 3);
        next.setMonth((quarter + 1) * 3);
        next.setDate(7); // 7th of next quarter
        break;
      case 'annually':
        next.setFullYear(next.getFullYear() + 1);
        next.setMonth(0);
        next.setDate(31); // End of January
        break;
      default:
        next.setMonth(next.getMonth() + 1);
        next.setDate(7);
    }

    return next;
  }

  private async createAIMemoryDocuments(context: OnboardingContext): Promise<void> {
    const intentProfile = await db.query<{
      business_name: string;
      business_description: string;
      primary_goals: string[];
      key_contacts: unknown;
      tax_obligations: string[];
    }>(
      `SELECT business_name, business_description, primary_goals, 
              key_contacts, tax_obligations
       FROM intent_profiles WHERE tenant_id = $1`,
      [context.tenantId]
    );

    if (intentProfile.rows.length === 0) {
      return;
    }

    const profile = intentProfile.rows[0];

    // Create intent summary document
    const intentSummary = {
      title: 'Business Intent Summary',
      content: this.generateIntentSummary(profile),
      documentType: 'intent_summary',
      category: 'onboarding',
      priority: 10,
    };

    await db.query(
      `INSERT INTO ai_memory_documents (
        tenant_id, document_type, title, content, category, priority, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        context.tenantId,
        intentSummary.documentType,
        intentSummary.title,
        intentSummary.content,
        intentSummary.category,
        intentSummary.priority,
        true,
      ]
    );

    logger.info('AI memory document created', { tenantId: context.tenantId });
  }

  private generateIntentSummary(profile: {
    business_name: string;
    business_description: string | null;
    primary_goals: string[];
    tax_obligations: string[];
  }): string {
    return `Business: ${profile.business_name}

${profile.business_description || 'No description provided'}

Primary Goals:
${profile.primary_goals.map(g => `- ${g}`).join('\n')}

Tax Obligations:
${profile.tax_obligations.map(o => `- ${o}`).join('\n')}

This business is using the AI accountant to automate bookkeeping, tax compliance, and financial management.`;
  }

  async setErrorState(sessionId: string, error: string): Promise<void> {
    const context = await this.getSession(sessionId);
    if (!context) {
      throw new Error('Session not found');
    }

    const retryCount = (context.errorState?.retryCount || 0) + 1;

    await db.query(
      `UPDATE onboarding_sessions
       SET current_state = $1,
           status = $2,
           error_state = $3::jsonb,
           retry_count = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [
        'error',
        'error',
        JSON.stringify({ error, retryCount }),
        retryCount,
        sessionId,
      ]
    );

    logger.error(
      'Onboarding session error',
      undefined,
      { sessionId, error, retryCount }
    );
  }

  async completeSession(sessionId: string): Promise<void> {
    const context = await this.getSession(sessionId);
    if (!context) {
      throw new Error('Session not found');
    }

    await db.query(
      `UPDATE onboarding_sessions
       SET status = $1, completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      ['completed', sessionId]
    );

    logger.info('Onboarding session completed', { sessionId });

    // Send completion email
    try {
      const userResult = await db.query<{ email: string; name: string }>(
        'SELECT email, name FROM users WHERE id = $1',
        [context.userId]
      );
      const tenantResult = await db.query<{ name: string }>(
        'SELECT name FROM tenants WHERE id = $1',
        [context.tenantId]
      );

      // Get connector and filing calendar counts
        const connectorResult = await db.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM connector_registry WHERE tenant_id = $1 AND is_enabled = true',
        [context.tenantId]
      );
        const filingResult = await db.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM filing_calendars WHERE tenant_id = $1 AND is_active = true',
        [context.tenantId]
      );

      if (userResult.rows.length > 0 && tenantResult.rows.length > 0) {
        // In production, call notification service to send completion email
        // await sendOnboardingComplete(
        //   userResult.rows[0].email,
        //   userResult.rows[0].name,
        //   tenantResult.rows[0].name,
        //   {
        //     connectorsConnected: parseInt(connectorResult.rows[0]?.count || '0', 10),
        //     filingCalendarsCreated: parseInt(filingResult.rows[0]?.count || '0', 10),
        //     nextSteps: [
        //       'Review your chart of accounts',
        //       'Connect your bank accounts',
        //       'Upload your first document',
        //     ],
        //   }
        // );
        logger.info('Completion email queued', { 
          email: userResult.rows[0].email,
          connectors: parseInt(connectorResult.rows[0]?.count || '0', 10),
          filings: parseInt(filingResult.rows[0]?.count || '0', 10),
        });
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.warn('Failed to send completion email', { error: normalizedError.message });
    }
  }
}

export const orchestrator = new OnboardingOrchestrator();
