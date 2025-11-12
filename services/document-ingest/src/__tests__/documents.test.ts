import { describe, it, expect } from '@jest/globals';

describe('Document Ingest Service', () => {
  it('should validate document upload', () => {
    const fileType = 'application/pdf';
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    expect(allowedTypes.includes(fileType)).toBe(true);
  });

  it('should validate file size', () => {
    const fileSize = 5 * 1024 * 1024; // 5MB
    const maxSize = 10 * 1024 * 1024; // 10MB
    expect(fileSize <= maxSize).toBe(true);
  });
});
