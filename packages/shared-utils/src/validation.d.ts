import { z } from 'zod';
export declare const tenantIdSchema: any;
export declare const userIdSchema: any;
export declare const documentIdSchema: any;
export declare const emailSchema: any;
export declare const passwordSchema: any;
export declare const paginationSchema: any;
export type Pagination = z.infer<typeof paginationSchema>;
export declare function validateTenantId(id: unknown): string;
export declare function validateUserId(id: unknown): string;
export declare function validateEmail(email: unknown): string;
export declare function validatePassword(password: unknown): string;
//# sourceMappingURL=validation.d.ts.map