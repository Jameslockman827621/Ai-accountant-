"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePassword = exports.validateEmail = exports.validateUserId = exports.validateTenantId = exports.paginationSchema = exports.passwordSchema = exports.emailSchema = exports.documentIdSchema = exports.userIdSchema = exports.tenantIdSchema = void 0;
const zod_1 = require("zod");
exports.tenantIdSchema = zod_1.z.string().uuid();
exports.userIdSchema = zod_1.z.string().uuid();
exports.documentIdSchema = zod_1.z.string().uuid();
exports.emailSchema = zod_1.z.string().email();
exports.passwordSchema = zod_1.z
    .string()
    .min(12, 'Password must be at least 12 characters long')
    .max(128, 'Password must be less than 128 characters long')
    .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
    .regex(/[a-z]/, 'Password must include at least one lowercase letter')
    .regex(/[0-9]/, 'Password must include at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must include at least one special character');
exports.paginationSchema = zod_1.z.object({
    page: zod_1.z.number().int().positive().default(1),
    limit: zod_1.z.number().int().positive().max(100).default(20),
});
function validateTenantId(id) {
    return exports.tenantIdSchema.parse(id);
}
exports.validateTenantId = validateTenantId;
function validateUserId(id) {
    return exports.userIdSchema.parse(id);
}
exports.validateUserId = validateUserId;
function validateEmail(email) {
    return exports.emailSchema.parse(email);
}
exports.validateEmail = validateEmail;
function validatePassword(password) {
    return exports.passwordSchema.parse(password);
}
exports.validatePassword = validatePassword;
//# sourceMappingURL=validation.js.map