/**
 * Comprehensive Input Validation
 */

import { createLogger } from '@ai-accountant/shared-utils';
import validator from 'validator';

const logger = createLogger('input-validation');

export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'email' | 'url' | 'date' | 'uuid' | 'json';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: unknown) => boolean | string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}

export class InputValidator {
  validate(data: Record<string, unknown>, rules: ValidationRule[]): ValidationResult {
    const errors: Array<{ field: string; message: string }> = [];

    for (const rule of rules) {
      const value = data[rule.field];

      // Check required
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: rule.field,
          message: `${rule.field} is required`,
        });
        continue;
      }

      // Skip validation if value is empty and not required
      if (value === undefined || value === null || value === '') {
        continue;
      }

      // Type validation
      const typeError = this.validateType(value, rule);
      if (typeError) {
        errors.push({ field: rule.field, message: typeError });
        continue;
      }

      // Length validation
      if (rule.type === 'string') {
        const lengthError = this.validateLength(value as string, rule);
        if (lengthError) {
          errors.push({ field: rule.field, message: lengthError });
          continue;
        }
      }

      // Range validation
      if (rule.type === 'number') {
        const rangeError = this.validateRange(value as number, rule);
        if (rangeError) {
          errors.push({ field: rule.field, message: rangeError });
          continue;
        }
      }

      // Pattern validation
      if (rule.pattern && typeof value === 'string') {
        if (!rule.pattern.test(value)) {
          errors.push({
            field: rule.field,
            message: `${rule.field} does not match required pattern`,
          });
          continue;
        }
      }

      // Custom validation
      if (rule.custom) {
        const customResult = rule.custom(value);
        if (customResult !== true) {
          errors.push({
            field: rule.field,
            message: typeof customResult === 'string' ? customResult : `${rule.field} is invalid`,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private validateType(value: unknown, rule: ValidationRule): string | null {
    switch (rule.type) {
      case 'string':
        if (typeof value !== 'string') {
          return `${rule.field} must be a string`;
        }
        break;
      case 'number':
        if (typeof value !== 'number' && !validator.isNumeric(String(value))) {
          return `${rule.field} must be a number`;
        }
        break;
      case 'email':
        if (typeof value !== 'string' || !validator.isEmail(value)) {
          return `${rule.field} must be a valid email address`;
        }
        break;
      case 'url':
        if (typeof value !== 'string' || !validator.isURL(value)) {
          return `${rule.field} must be a valid URL`;
        }
        break;
      case 'date':
        if (!(value instanceof Date) && !validator.isISO8601(String(value))) {
          return `${rule.field} must be a valid date`;
        }
        break;
      case 'uuid':
        if (typeof value !== 'string' || !validator.isUUID(value)) {
          return `${rule.field} must be a valid UUID`;
        }
        break;
      case 'json':
        if (typeof value !== 'string') {
          try {
            JSON.parse(String(value));
          } catch {
            return `${rule.field} must be valid JSON`;
          }
        }
        break;
    }
    return null;
  }

  private validateLength(value: string, rule: ValidationRule): string | null {
    if (rule.minLength && value.length < rule.minLength) {
      return `${rule.field} must be at least ${rule.minLength} characters`;
    }
    if (rule.maxLength && value.length > rule.maxLength) {
      return `${rule.field} must be at most ${rule.maxLength} characters`;
    }
    return null;
  }

  private validateRange(value: number, rule: ValidationRule): string | null {
    if (rule.min !== undefined && value < rule.min) {
      return `${rule.field} must be at least ${rule.min}`;
    }
    if (rule.max !== undefined && value > rule.max) {
      return `${rule.field} must be at most ${rule.max}`;
    }
    return null;
  }

  // SQL Injection prevention
  sanitizeSQL(input: string): string {
    // Remove SQL keywords and special characters
    return input
      .replace(/['";\\]/g, '')
      .replace(/--/g, '')
      .replace(/\/\*/g, '')
      .replace(/\*\//g, '');
  }

  // XSS prevention
  sanitizeHTML(input: string): string {
    return validator.escape(input);
  }

  // Path traversal prevention
  sanitizePath(input: string): string {
    return input
      .replace(/\.\./g, '')
      .replace(/\/\//g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  }
}

// Common validation rules
export const VALIDATION_RULES = {
  email: (required = true): ValidationRule => ({
    field: 'email',
    type: 'email',
    required,
    maxLength: 255,
  }),

  password: (required = true): ValidationRule => ({
    field: 'password',
    type: 'string',
    required,
    minLength: 12,
    maxLength: 128,
    pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    custom: (value) => {
      if (typeof value !== 'string') return false;
      if (value.length < 12) return 'Password must be at least 12 characters';
      if (!/[a-z]/.test(value)) return 'Password must contain lowercase letter';
      if (!/[A-Z]/.test(value)) return 'Password must contain uppercase letter';
      if (!/\d/.test(value)) return 'Password must contain number';
      if (!/[@$!%*?&]/.test(value)) return 'Password must contain special character';
      return true;
    },
  }),

  uuid: (required = true): ValidationRule => ({
    field: 'id',
    type: 'uuid',
    required,
  }),

  amount: (required = true): ValidationRule => ({
    field: 'amount',
    type: 'number',
    required,
    min: 0,
    max: 999999999.99,
  }),

  date: (required = true): ValidationRule => ({
    field: 'date',
    type: 'date',
    required,
  }),
};

export const inputValidator = new InputValidator();
