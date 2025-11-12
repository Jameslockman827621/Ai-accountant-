import { z } from 'zod';

export const tenantIdSchema = z.string().uuid();
export const userIdSchema = z.string().uuid();
export const documentIdSchema = z.string().uuid();

export const emailSchema = z.string().email();
export const passwordSchema = z.string().min(8).max(128);

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
