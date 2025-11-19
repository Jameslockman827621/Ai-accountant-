export interface JWTPayload {
    userId: string;
    tenantId: string;
    role: string;
    email: string;
    iat?: number;
    exp?: number;
}
export declare function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string;
export declare function verifyToken(token: string): JWTPayload;
export declare function decodeToken(token: string): JWTPayload | null;
//# sourceMappingURL=jwt.d.ts.map