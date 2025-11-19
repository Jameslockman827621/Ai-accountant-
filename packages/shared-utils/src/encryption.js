"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hash = exports.decrypt = exports.encrypt = void 0;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
/**
 * Derives a key from a password using PBKDF2
 */
function deriveKey(password, salt) {
    return crypto_1.default.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha512');
}
/**
 * Encrypts data using AES-256-GCM
 */
function encrypt(data, password) {
    const salt = crypto_1.default.randomBytes(SALT_LENGTH);
    const key = deriveKey(password, salt);
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return {
        encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        salt: salt.toString('hex'),
    };
}
exports.encrypt = encrypt;
/**
 * Decrypts data using AES-256-GCM
 */
function decrypt(encryptedData, password) {
    const salt = Buffer.from(encryptedData.salt, 'hex');
    const key = deriveKey(password, salt);
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const tag = Buffer.from(encryptedData.tag, 'hex');
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
exports.decrypt = decrypt;
/**
 * Hashes data using SHA-256
 */
function hash(data) {
    return crypto_1.default.createHash('sha256').update(data).digest('hex');
}
exports.hash = hash;
//# sourceMappingURL=encryption.js.map