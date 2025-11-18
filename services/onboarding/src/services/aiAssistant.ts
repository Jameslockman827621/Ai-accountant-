import { TenantId } from '@ai-accountant/shared-types';

export interface QuestionnaireResponse {
  question: string;
  answer: string;
  confidence?: number;
  suggestions?: string[];
}

export interface IntentSummary {
  businessName: string;
  summary: string;
  keyGoals: string[];
  taxObligations: string[];
  riskProfile: string;
  recommendations: string[];
}

export class AIAssistantService {
  async clarifyQuestion(
    question: string,
    answer: string,
    _context?: Record<string, unknown>
  ): Promise<{
    isAmbiguous: boolean;
    clarificationQuestions?: string[];
    suggestedAnswer?: string;
    confidence: number;
  }> {
    // In production, this would use an LLM to analyze the answer
    // For now, return a simple analysis

    const isAmbiguous = this.detectAmbiguity(answer);
    const confidence = this.calculateConfidence(answer);

    if (isAmbiguous) {
      const clarificationQuestions = this.generateClarificationQuestions(question, answer);
      return {
        isAmbiguous: true,
        clarificationQuestions,
        confidence,
      };
    }

    return {
      isAmbiguous: false,
      confidence,
    };
  }

  async summarizeIntent(
    _tenantId: TenantId,
    questionnaireResponses: QuestionnaireResponse[],
    uploadedDocuments?: Array<{ type: string; content: string }>
  ): Promise<IntentSummary> {
    // In production, this would use an LLM to generate a comprehensive summary
    // For now, create a structured summary from the responses

    const businessName = questionnaireResponses.find(r => r.question.includes('business name'))?.answer || 'Unknown';
    const goals = questionnaireResponses
      .filter(r => r.question.toLowerCase().includes('goal'))
      .map(r => r.answer);
    const obligations = questionnaireResponses
      .filter(r => r.question.toLowerCase().includes('tax') || r.question.toLowerCase().includes('obligation'))
      .map(r => r.answer);

    const summary = this.generateSummary(questionnaireResponses, uploadedDocuments);
    const riskProfile = this.assessRiskProfile(questionnaireResponses);
    const recommendations = this.generateRecommendations(questionnaireResponses);

    return {
      businessName,
      summary,
      keyGoals: goals,
      taxObligations: obligations,
      riskProfile,
      recommendations,
    };
  }

  async assessRiskScore(
    _tenantId: TenantId,
    intentProfile: Record<string, unknown>
  ): Promise<{
    score: number;
    level: 'low' | 'medium' | 'high';
    factors: string[];
    requiresReview: boolean;
  }> {
    let score = 0;
    const factors: string[] = [];

    // Check entity type
    const entityType = intentProfile.entityType as string;
    if (entityType === 'limited_company' || entityType === 'corporation') {
      score += 20;
      factors.push('Complex entity structure');
    }

    // Check revenue
    const revenueRange = intentProfile.annualRevenueRange as string;
    if (revenueRange === 'large' || revenueRange === 'enterprise') {
      score += 30;
      factors.push('High revenue threshold');
    }

    // Check jurisdictions
    const jurisdictions = intentProfile.additionalJurisdictions as string[] || [];
    if (jurisdictions.length > 1) {
      score += 25;
      factors.push('Multi-jurisdiction operations');
    }

    // Check tax obligations
    const obligations = intentProfile.taxObligations as string[] || [];
    if (obligations.length > 3) {
      score += 15;
      factors.push('Multiple tax obligations');
    }

    // Check risk tolerance
    const riskTolerance = intentProfile.riskTolerance as string;
    if (riskTolerance === 'aggressive') {
      score += 10;
      factors.push('Aggressive risk tolerance');
    }

    const level = score < 30 ? 'low' : score < 60 ? 'medium' : 'high';
    const requiresReview = score >= 50;

    return {
      score,
      level,
      factors,
      requiresReview,
    };
  }

  private detectAmbiguity(answer: string): boolean {
    const ambiguousPatterns = [
      /^(maybe|perhaps|i think|i guess|not sure|unsure)/i,
      /^(yes|no)$/i, // Too short
      /^(it depends|sometimes|occasionally)/i,
    ];

    return ambiguousPatterns.some(pattern => pattern.test(answer.trim()));
  }

  private calculateConfidence(answer: string): number {
    if (answer.length < 5) return 0.3;
    if (answer.length < 20) return 0.6;
    if (answer.length < 100) return 0.8;
    return 0.9;
  }

  private generateClarificationQuestions(_question: string, answer: string): string[] {
    const questions: string[] = [];

    if (answer.toLowerCase().includes('maybe') || answer.toLowerCase().includes('not sure')) {
      questions.push('Can you provide more specific details?');
      questions.push('What factors would help you decide?');
    }

    if (answer.length < 10) {
      questions.push('Could you elaborate on your answer?');
    }

    return questions;
  }

  private generateSummary(
    responses: QuestionnaireResponse[],
    _documents?: Array<{ type: string; content: string }>
  ): string {
    const businessInfo = responses
      .filter(r => r.question.includes('business'))
      .map(r => r.answer)
      .join(', ');

    const taxInfo = responses
      .filter(r => r.question.includes('tax'))
      .map(r => r.answer)
      .join(', ');

    return `This business ${businessInfo}. Tax obligations include: ${taxInfo}.`;
  }

  private assessRiskProfile(responses: QuestionnaireResponse[]): string {
    const riskIndicators = responses.filter(r =>
      r.answer.toLowerCase().includes('high') ||
      r.answer.toLowerCase().includes('complex') ||
      r.answer.toLowerCase().includes('multiple')
    );

    if (riskIndicators.length > 2) {
      return 'high';
    }
    if (riskIndicators.length > 0) {
      return 'medium';
    }
    return 'low';
  }

  private generateRecommendations(responses: QuestionnaireResponse[]): string[] {
    const recommendations: string[] = [];

    const hasVAT = responses.some(r => r.answer.toLowerCase().includes('vat'));
    if (hasVAT) {
      recommendations.push('Set up quarterly VAT filing reminders');
    }

    const hasPayroll = responses.some(r => r.answer.toLowerCase().includes('payroll'));
    if (hasPayroll) {
      recommendations.push('Configure PAYE automation');
    }

    recommendations.push('Review chart of accounts template');
    recommendations.push('Connect at least one bank account for reconciliation');

    return recommendations;
  }
}

export const aiAssistantService = new AIAssistantService();
