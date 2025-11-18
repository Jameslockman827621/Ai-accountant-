import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('rulepack-dsl');

export interface RulepackDSL {
  version: string;
  jurisdiction: string;
  filingType: string;
  effectiveFrom: string;
  effectiveTo?: string;
  rules: Rule[];
  calculations: Calculation[];
  thresholds: Threshold[];
  references: Reference[];
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  condition: Condition;
  action: Action;
  priority?: number;
}

export interface Condition {
  type: 'and' | 'or' | 'not' | 'comparison' | 'exists' | 'in_range';
  field?: string;
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value?: unknown;
  conditions?: Condition[];
}

export interface Action {
  type: 'set' | 'calculate' | 'flag' | 'route';
  field?: string;
  value?: unknown;
  formula?: string;
  flag?: string;
  routeTo?: string;
}

export interface Calculation {
  id: string;
  name: string;
  formula: string;
  dependencies: string[];
  rounding?: {
    method: 'round' | 'floor' | 'ceiling';
    decimals: number;
  };
}

export interface Threshold {
  id: string;
  name: string;
  value: number;
  appliesTo: string[];
}

export interface Reference {
  id: string;
  type: 'statute' | 'guidance' | 'case_law' | 'regulation';
  title: string;
  url?: string;
  section?: string;
}

export interface RulepackEvaluationContext {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  data: Record<string, unknown>;
  previousFiling?: Record<string, unknown>;
}

export interface RulepackEvaluationResult {
  calculatedValues: Record<string, unknown>;
  appliedRules: Array<{
    ruleId: string;
    condition: boolean;
    action: Action;
  }>;
  flags: string[];
  explanations: Array<{
    field: string;
    value: unknown;
    calculation: string;
    rules: string[];
  }>;
}

export class RulepackDSLCompiler {
  /**
   * Compile DSL to executable JSON
   */
  compile(dsl: RulepackDSL): Record<string, unknown> {
    return {
      version: dsl.version,
      jurisdiction: dsl.jurisdiction,
      filingType: dsl.filingType,
      effectiveFrom: dsl.effectiveFrom,
      effectiveTo: dsl.effectiveTo,
      rules: dsl.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        condition: this.compileCondition(rule.condition),
        action: rule.action,
        priority: rule.priority || 0,
      })),
      calculations: dsl.calculations,
      thresholds: dsl.thresholds,
      references: dsl.references,
    };
  }

  private compileCondition(condition: Condition): Record<string, unknown> {
    const compiled: Record<string, unknown> = {
      type: condition.type,
    };

    if (condition.field) compiled.field = condition.field;
    if (condition.operator) compiled.operator = condition.operator;
    if (condition.value !== undefined) compiled.value = condition.value;
    if (condition.conditions) {
      compiled.conditions = condition.conditions.map((c) => this.compileCondition(c));
    }

    return compiled;
  }
}

export class RulepackInterpreter {
  /**
   * Evaluate rulepack against context
   */
  evaluate(
    compiledRulepack: Record<string, unknown>,
    context: RulepackEvaluationContext
  ): RulepackEvaluationResult {
    const rules = (compiledRulepack.rules as Rule[]) || [];
    const calculations = (compiledRulepack.calculations as Calculation[]) || [];

    const result: RulepackEvaluationResult = {
      calculatedValues: {},
      appliedRules: [],
      flags: [],
      explanations: [],
    };

    // Evaluate rules in priority order
    const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const rule of sortedRules) {
      const conditionMet = this.evaluateCondition(rule.condition, context.data);

      if (conditionMet) {
        result.appliedRules.push({
          ruleId: rule.id,
          condition: true,
          action: rule.action,
        });

        this.executeAction(rule.action, context.data, result);
      }
    }

    // Execute calculations
    for (const calc of calculations) {
      const value = this.evaluateCalculation(calc, context.data, result.calculatedValues);
      result.calculatedValues[calc.id] = value;

      result.explanations.push({
        field: calc.id,
        value,
        calculation: calc.formula,
        rules: result.appliedRules
          .filter((r) => r.action.type === 'calculate' && r.action.formula === calc.formula)
          .map((r) => r.ruleId),
      });
    }

    return result;
  }

  private evaluateCondition(condition: Condition, data: Record<string, unknown>): boolean {
    switch (condition.type) {
      case 'and':
        if (!condition.conditions) return false;
        return condition.conditions.every((c) => this.evaluateCondition(c, data));

      case 'or':
        if (!condition.conditions) return false;
        return condition.conditions.some((c) => this.evaluateCondition(c, data));

      case 'not': {
        const [firstCondition] = condition.conditions ?? [];
        if (!firstCondition) return false;
        return !this.evaluateCondition(firstCondition, data);
      }

      case 'comparison':
        if (!condition.field || !condition.operator || condition.value === undefined) return false;
        const fieldValue = this.getFieldValue(condition.field, data);
        return this.compare(fieldValue, condition.operator, condition.value);

      case 'exists':
        if (!condition.field) return false;
        return this.getFieldValue(condition.field, data) !== undefined;

      case 'in_range':
        if (!condition.field || !condition.value || typeof condition.value !== 'object')
          return false;
        const range = condition.value as { min: number; max: number };
        const val = this.getFieldValue(condition.field, data);
        if (typeof val !== 'number') return false;
        return val >= range.min && val <= range.max;

      default:
        return false;
    }
  }

  private compare(
    fieldValue: unknown,
    operator: Condition['operator'],
    expectedValue: unknown
  ): boolean {
    if (operator === 'eq') return fieldValue === expectedValue;
    if (operator === 'ne') return fieldValue !== expectedValue;

    const fieldNum = typeof fieldValue === 'number' ? fieldValue : parseFloat(String(fieldValue));
    const expectedNum =
      typeof expectedValue === 'number' ? expectedValue : parseFloat(String(expectedValue));

    if (isNaN(fieldNum) || isNaN(expectedNum)) return false;

    switch (operator) {
      case 'gt':
        return fieldNum > expectedNum;
      case 'gte':
        return fieldNum >= expectedNum;
      case 'lt':
        return fieldNum < expectedNum;
      case 'lte':
        return fieldNum <= expectedNum;
      default:
        return false;
    }
  }

  private getFieldValue(field: string, data: Record<string, unknown>): unknown {
    const parts = field.split('.');
    let value: unknown = data;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private executeAction(
    action: Action,
    data: Record<string, unknown>,
    result: RulepackEvaluationResult
  ): void {
    switch (action.type) {
      case 'set':
        if (action.field && action.value !== undefined) {
          this.setFieldValue(action.field, data, action.value);
        }
        break;

      case 'calculate':
        if (action.field && action.formula) {
          const value = this.evaluateFormula(action.formula, data, result.calculatedValues);
          this.setFieldValue(action.field, data, value);
        }
        break;

      case 'flag':
        if (action.flag) {
          result.flags.push(action.flag);
        }
        break;

      case 'route':
        // Routing logic would be handled by workflow engine
        break;
    }
  }

  private setFieldValue(field: string, data: Record<string, unknown>, value: unknown): void {
    const parts = field.split('.');
    let current: Record<string, unknown> = data;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) {
        continue;
      }
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1];
    if (!lastPart) {
      return;
    }
    current[lastPart] = value;
  }

  private evaluateCalculation(
    calc: Calculation,
    data: Record<string, unknown>,
    calculatedValues: Record<string, unknown>
  ): number {
    // Simple formula evaluator (in production, use a proper expression parser)
    let formula = calc.formula;

    // Replace field references with values
    for (const dep of calc.dependencies) {
      const value = calculatedValues[dep] ?? this.getFieldValue(dep, data);
      formula = formula.replace(new RegExp(`\\b${dep}\\b`, 'g'), String(value ?? 0));
    }

    // Evaluate formula (simplified - in production use safe eval or parser)
    try {
      const result = Function(`"use strict"; return (${formula})`)();
      const numResult = typeof result === 'number' ? result : parseFloat(String(result));

      if (calc.rounding) {
        const factor = Math.pow(10, calc.rounding.decimals);
        switch (calc.rounding.method) {
          case 'round':
            return Math.round(numResult * factor) / factor;
          case 'floor':
            return Math.floor(numResult * factor) / factor;
          case 'ceiling':
            return Math.ceil(numResult * factor) / factor;
        }
      }

      return numResult;
    } catch (error) {
      logger.error('Formula evaluation failed', {
        formula,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return 0;
    }
  }

  private evaluateFormula(
    formula: string,
    data: Record<string, unknown>,
    calculatedValues: Record<string, unknown>
  ): number {
    // Similar to evaluateCalculation but for inline formulas
    let f = formula;

    // Replace references
    for (const key in data) {
      f = f.replace(new RegExp(`\\b${key}\\b`, 'g'), String(data[key] ?? 0));
    }

    for (const key in calculatedValues) {
      f = f.replace(new RegExp(`\\b${key}\\b`, 'g'), String(calculatedValues[key] ?? 0));
    }

    try {
      const result = Function(`"use strict"; return (${f})`)();
      return typeof result === 'number' ? result : parseFloat(String(result));
    } catch {
      return 0;
    }
  }
}

export class RulepackManager {
  private compiler = new RulepackDSLCompiler();
  private interpreter = new RulepackInterpreter();

  /**
   * Register a new rulepack version
   */
  async registerRulepack(dsl: RulepackDSL, content: string, createdBy: string): Promise<string> {
    const compiled = this.compiler.compile(dsl);
    const contentHash = await this.hashContent(content);

    const result = await db.query<{ id: string }>(
      `INSERT INTO rulepack_catalog (
        name, jurisdiction, filing_type, version, effective_from, effective_to,
        status, description, metadata, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      RETURNING id`,
      [
        `${dsl.jurisdiction}_${dsl.filingType}`,
        dsl.jurisdiction,
        dsl.filingType,
        dsl.version,
        dsl.effectiveFrom,
        dsl.effectiveTo || null,
        'draft',
        `Rulepack for ${dsl.jurisdiction} ${dsl.filingType}`,
        JSON.stringify(compiled),
        createdBy,
      ]
    );

    const insertedRow = result.rows[0];
    if (!insertedRow) {
      throw new Error('Failed to create rulepack entry');
    }
    const rulepackId = insertedRow.id;

    await db.query(
      `INSERT INTO rulepack_content (rulepack_id, content_hash, content_text, compiled_json)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [rulepackId, contentHash, content, JSON.stringify(compiled)]
    );

    return rulepackId;
  }

  /**
   * Get active rulepack for jurisdiction and filing type
   */
  async getActiveRulepack(
    jurisdiction: string,
    filingType: string,
    effectiveDate: string
  ): Promise<Record<string, unknown> | null> {
    const result = await db.query<{ compiled_json: unknown }>(
      `SELECT rc.compiled_json
       FROM rulepack_catalog rp
       JOIN rulepack_content rc ON rc.rulepack_id = rp.id
       WHERE rp.jurisdiction = $1
         AND rp.filing_type = $2
         AND rp.status = 'active'
         AND rp.effective_from <= $3
         AND (rp.effective_to IS NULL OR rp.effective_to >= $3)
       ORDER BY rp.effective_from DESC, rp.version DESC
       LIMIT 1`,
      [jurisdiction, filingType, effectiveDate]
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return row.compiled_json as Record<string, unknown>;
  }

  /**
   * Evaluate rulepack for filing
   */
  async evaluateForFiling(
    jurisdiction: string,
    filingType: string,
    context: RulepackEvaluationContext
  ): Promise<RulepackEvaluationResult> {
    const rulepack = await this.getActiveRulepack(jurisdiction, filingType, context.periodEnd);

    if (!rulepack) {
      throw new Error(`No active rulepack found for ${jurisdiction} ${filingType}`);
    }

    return this.interpreter.evaluate(rulepack, context);
  }

  private async hashContent(content: string): Promise<string> {
    // In production, use crypto.createHash
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export const rulepackManager = new RulepackManager();
