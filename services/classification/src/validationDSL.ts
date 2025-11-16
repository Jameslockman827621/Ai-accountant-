import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentType } from '@ai-accountant/shared-types';

const logger = createLogger('validation-dsl');

export interface ValidationRule {
  field: string;
  required: boolean;
  type: 'string' | 'number' | 'date' | 'email' | 'currency';
  min?: number;
  max?: number;
  pattern?: string;
  customValidator?: (value: unknown) => boolean;
  errorMessage?: string;
  autoCorrect?: (value: unknown) => unknown;
}

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{ field: string; message: string; suggestedValue?: unknown }>;
  warnings: Array<{ field: string; message: string }>;
}

/**
 * Validation DSL for document fields (Chunk 3)
 */
export class ValidationDSL {
  private rules: Map<DocumentType, ValidationRule[]> = new Map();

  constructor() {
    this.initializeRules();
  }

  /**
   * Validate document data against rules
   */
  validate(
    documentType: DocumentType,
    data: Record<string, unknown>
  ): ValidationResult {
    const rules = this.rules.get(documentType) || [];
    const errors: Array<{ field: string; message: string; suggestedValue?: unknown }> = [];
    const warnings: Array<{ field: string; message: string }> = [];

    for (const rule of rules) {
      const value = data[rule.field];

      // Check required fields
      if (rule.required && (value === null || value === undefined || value === '')) {
        errors.push({
          field: rule.field,
          message: rule.errorMessage || `${rule.field} is required`,
        });
        continue;
      }

      // Skip validation if field is empty and not required
      if (value === null || value === undefined || value === '') {
        continue;
      }

      // Type validation
      if (rule.type === 'number' && typeof value !== 'number') {
        const corrected = this.autoCorrect(rule, value);
        if (corrected !== undefined) {
          warnings.push({
            field: rule.field,
            message: `Invalid number format, suggested: ${corrected}`,
          });
        } else {
          errors.push({
            field: rule.field,
            message: `${rule.field} must be a number`,
          });
        }
      }

      if (rule.type === 'date' && !(value instanceof Date) && typeof value !== 'string') {
        errors.push({
          field: rule.field,
          message: `${rule.field} must be a date`,
        });
      }

      // Range validation
      if (rule.type === 'number' && typeof value === 'number') {
        if (rule.min !== undefined && value < rule.min) {
          errors.push({
            field: rule.field,
            message: `${rule.field} must be at least ${rule.min}`,
            suggestedValue: rule.min,
          });
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push({
            field: rule.field,
            message: `${rule.field} must be at most ${rule.max}`,
            suggestedValue: rule.max,
          });
        }
      }

      // Pattern validation
      if (rule.pattern && typeof value === 'string') {
        const regex = new RegExp(rule.pattern);
        if (!regex.test(value)) {
          errors.push({
            field: rule.field,
            message: rule.errorMessage || `${rule.field} format is invalid`,
          });
        }
      }

      // Custom validator
      if (rule.customValidator && !rule.customValidator(value)) {
        errors.push({
          field: rule.field,
          message: rule.errorMessage || `${rule.field} validation failed`,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Auto-correct field value
   */
  autoCorrect(rule: ValidationRule, value: unknown): unknown | undefined {
    if (rule.autoCorrect) {
      return rule.autoCorrect(value);
    }

    // Default auto-corrections
    if (rule.type === 'number' && typeof value === 'string') {
      const cleaned = value.replace(/[£$€,\s]/g, '');
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }

    if (rule.type === 'date' && typeof value === 'string') {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return undefined;
  }

  /**
   * Initialize validation rules per document type
   */
  private initializeRules(): void {
    // Invoice rules
    this.rules.set(DocumentType.INVOICE, [
      {
        field: 'vendor',
        required: true,
        type: 'string',
        errorMessage: 'Vendor name is required',
      },
      {
        field: 'date',
        required: true,
        type: 'date',
        errorMessage: 'Invoice date is required',
      },
      {
        field: 'total',
        required: true,
        type: 'number',
        min: 0,
        errorMessage: 'Total amount is required and must be positive',
        autoCorrect: (v) => {
          if (typeof v === 'string') {
            return parseFloat(v.replace(/[£$€,\s]/g, ''));
          }
          return v;
        },
      },
      {
        field: 'invoiceNumber',
        required: false,
        type: 'string',
        pattern: '^[A-Z0-9-]+$',
        errorMessage: 'Invoice number format is invalid',
      },
      {
        field: 'currency',
        required: false,
        type: 'string',
        pattern: '^[A-Z]{3}$',
        errorMessage: 'Currency must be a 3-letter code (e.g., GBP, USD)',
      },
    ]);

    // Receipt rules
    this.rules.set(DocumentType.RECEIPT, [
      {
        field: 'date',
        required: true,
        type: 'date',
        errorMessage: 'Receipt date is required',
      },
      {
        field: 'total',
        required: true,
        type: 'number',
        min: 0,
        errorMessage: 'Total amount is required',
      },
    ]);

    // Statement rules
    this.rules.set(DocumentType.STATEMENT, [
      {
        field: 'date',
        required: true,
        type: 'date',
        errorMessage: 'Statement date is required',
      },
    ]);
  }
}

export const validationDSL = new ValidationDSL();
