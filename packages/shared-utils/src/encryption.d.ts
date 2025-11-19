export interface EncryptedData {
    encrypted: string;
    iv: string;
    tag: string;
    salt: string;
}
/**
 * Encrypts data using AES-256-GCM
 */
export declare function encrypt(data: string, password: string): EncryptedData;
/**
 * Decrypts data using AES-256-GCM
 */
export declare function decrypt(encryptedData: EncryptedData, password: string): string;
/**
 * Hashes data using SHA-256
 */
export declare function hash(data: string): string;
//# sourceMappingURL=encryption.d.ts.map