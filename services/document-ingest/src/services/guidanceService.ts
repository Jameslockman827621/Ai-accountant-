import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentId } from '@ai-accountant/shared-types';

const logger = createLogger('guidance-service');

export interface GuidanceRecipe {
  id: string;
  recipeCode: string;
  recipeName: string;
  recipeDescription: string | null;
  triggerConditions: Record<string, unknown>;
  title: string;
  message: string;
  suggestedActions: string[];
  helpUrl: string | null;
  priority: number;
  enabled: boolean;
}

export interface DocumentGuidance {
  id: string;
  documentId: DocumentId;
  recipeId: string;
  recipe: GuidanceRecipe;
  acknowledged: boolean;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  createdAt: Date;
}

/**
 * Guidance Service (Chunk 4)
 * Attaches guidance recipes to documents based on conditions
 */
export class GuidanceService {
  /**
   * Evaluate and attach guidance to document
   */
  async evaluateGuidance(documentId: DocumentId): Promise<DocumentGuidance[]> {
    // Get document data
    const docResult = await db.query<{
      quality_score: number | null;
      confidence_score: number | null;
      extracted_data: unknown;
      quality_issues: unknown;
    }>(
      `SELECT quality_score, confidence_score, extracted_data, quality_issues
       FROM documents WHERE id = $1`,
      [documentId]
    );

    if (docResult.rows.length === 0) {
      return [];
    }

    const doc = docResult.rows[0];
    const extractedData = (doc.extracted_data as Record<string, unknown>) || {};
    const qualityIssues = (doc.quality_issues as Record<string, unknown>) || {};

    // Get all enabled guidance recipes
    const recipes = await this.getEnabledRecipes();

    const attachedGuidance: DocumentGuidance[] = [];

    for (const recipe of recipes) {
      if (this.matchesConditions(recipe, doc, extractedData, qualityIssues)) {
        const guidance = await this.attachGuidance(documentId, recipe.id);
        if (guidance) {
          attachedGuidance.push(guidance);
        }
      }
    }

    return attachedGuidance;
  }

  /**
   * Check if document matches recipe conditions
   */
  private matchesConditions(
    recipe: GuidanceRecipe,
    doc: {
      quality_score: number | null;
      confidence_score: number | null;
    },
    extractedData: Record<string, unknown>,
    qualityIssues: Record<string, unknown>
  ): boolean {
    const conditions = recipe.triggerConditions;

    // Check quality score
    if (conditions.quality_score) {
      const qsCondition = conditions.quality_score as Record<string, unknown>;
      if (qsCondition.$lt !== undefined && (doc.quality_score || 1) >= Number(qsCondition.$lt)) {
        return false;
      }
      if (qsCondition.$gt !== undefined && (doc.quality_score || 0) <= Number(qsCondition.$gt)) {
        return false;
      }
    }

    // Check confidence score
    if (conditions.confidence_score) {
      const csCondition = conditions.confidence_score as Record<string, unknown>;
      if (csCondition.$lt !== undefined && (doc.confidence_score || 1) >= Number(csCondition.$lt)) {
        return false;
      }
      if (csCondition.$gt !== undefined && (doc.confidence_score || 0) <= Number(csCondition.$gt)) {
        return false;
      }
    }

    // Check missing required fields
    if (conditions.missing_required_fields) {
      const requiredFields = conditions.missing_required_fields as string[];
      const hasAllFields = requiredFields.every(field => extractedData[field] !== undefined && extractedData[field] !== null);
      if (hasAllFields) {
        return false;
      }
    }

    // Check duplicate score
    if (conditions.duplicate_score) {
      const dupCondition = conditions.duplicate_score as Record<string, unknown>;
      if (dupCondition.$gt !== undefined) {
        // Would need to check duplicate detection results
        // For now, skip this check
      }
    }

    return true;
  }

  /**
   * Attach guidance to document
   */
  private async attachGuidance(
    documentId: DocumentId,
    recipeId: string
  ): Promise<DocumentGuidance | null> {
    // Check if already attached
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM document_guidance
       WHERE document_id = $1 AND recipe_id = $2`,
      [documentId, recipeId]
    );

    if (existing.rows.length > 0) {
      return null; // Already attached
    }

    // Attach guidance
    await db.query(
      `INSERT INTO document_guidance (id, document_id, recipe_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, NOW())`,
      [documentId, recipeId]
    );

    // Get full guidance with recipe
    return this.getDocumentGuidance(documentId, recipeId);
  }

  /**
   * Get guidance for document
   */
  async getDocumentGuidance(documentId: DocumentId): Promise<DocumentGuidance[]> {
    const result = await db.query<{
      id: string;
      document_id: string;
      recipe_id: string;
      acknowledged: boolean;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
      created_at: Date;
      recipe_code: string;
      recipe_name: string;
      recipe_description: string | null;
      title: string;
      message: string;
      suggested_actions: unknown;
      help_url: string | null;
      priority: number;
    }>(
      `SELECT 
        dg.id, dg.document_id, dg.recipe_id, dg.acknowledged,
        dg.acknowledged_at, dg.acknowledged_by, dg.created_at,
        gr.recipe_code, gr.recipe_name, gr.recipe_description,
        gr.title, gr.message, gr.suggested_actions, gr.help_url, gr.priority
      FROM document_guidance dg
      JOIN guidance_recipes gr ON gr.id = dg.recipe_id
      WHERE dg.document_id = $1
      ORDER BY gr.priority DESC`,
      [documentId]
    );

    return result.rows.map(row => ({
      id: row.id,
      documentId: row.document_id,
      recipeId: row.recipe_id,
      recipe: {
        id: row.recipe_id,
        recipeCode: row.recipe_code,
        recipeName: row.recipe_name,
        recipeDescription: row.recipe_description,
        triggerConditions: {}, // Not needed in response
        title: row.title,
        message: row.message,
        suggestedActions: (row.suggested_actions as string[]) || [],
        helpUrl: row.help_url,
        priority: row.priority,
        enabled: true,
      },
      acknowledged: row.acknowledged,
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBy: row.acknowledged_by,
      createdAt: row.created_at,
    }));
  }

  /**
   * Acknowledge guidance
   */
  async acknowledgeGuidance(
    guidanceId: string,
    userId: string
  ): Promise<void> {
    await db.query(
      `UPDATE document_guidance
       SET acknowledged = true,
           acknowledged_at = NOW(),
           acknowledged_by = $1
       WHERE id = $2`,
      [userId, guidanceId]
    );
  }

  /**
   * Get enabled recipes
   */
  private async getEnabledRecipes(): Promise<GuidanceRecipe[]> {
    const result = await db.query<{
      id: string;
      recipe_code: string;
      recipe_name: string;
      recipe_description: string | null;
      trigger_conditions: unknown;
      title: string;
      message: string;
      suggested_actions: unknown;
      help_url: string | null;
      priority: number;
      enabled: boolean;
    }>(
      `SELECT * FROM guidance_recipes
       WHERE enabled = true
       ORDER BY priority DESC`
    );

    return result.rows.map(row => ({
      id: row.id,
      recipeCode: row.recipe_code,
      recipeName: row.recipe_name,
      recipeDescription: row.recipe_description,
      triggerConditions: (row.trigger_conditions as Record<string, unknown>) || {},
      title: row.title,
      message: row.message,
      suggestedActions: (row.suggested_actions as string[]) || [],
      helpUrl: row.help_url,
      priority: row.priority,
      enabled: row.enabled,
    }));
  }
}

export const guidanceService = new GuidanceService();
