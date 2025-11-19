"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeToken = exports.verifyToken = exports.generateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
function generateToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'ai-accountant',
        audience: 'ai-accountant-api',
    });
}
exports.generateToken = generateToken;
function verifyToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET, {
            issuer: 'ai-accountant',
            audience: 'ai-accountant-api',
        });
        return decoded;
    }
    catch (error) {
        throw new Error(`Invalid token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
exports.verifyToken = verifyToken;
function decodeToken(token) {
    try {
        return jsonwebtoken_1.default.decode(token);
    }
    catch {
        return null;
    }
}
exports.decodeToken = decodeToken;
//# sourceMappingURL=jwt.js.map