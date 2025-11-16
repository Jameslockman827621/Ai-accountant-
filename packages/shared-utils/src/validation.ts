import { z } from 'zod';

export const tenantIdSchema = z.string().uuid();
export const userIdSchema = z.string().uuid();
export const documentIdSchema = z.string().uuid();

export const emailSchema = z.string().email();
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters long')
  .max(128, 'Password must be less than 128 characters long')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter')
  .regex(/[0-9]/, 'Password must include at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must include at least one special character');

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function validateTenantId(id: unknown): string {
  return tenantIdSchema.parse(id);
}

export function validateUserId(id: unknown): string {
  return userIdSchema.parse(id);
}

export function validateEmail(email: unknown): string {
  return emailSchema.parse(email);
}

export function validatePassword(password: unknown): string {
  return passwordSchema.parse(password);
}
