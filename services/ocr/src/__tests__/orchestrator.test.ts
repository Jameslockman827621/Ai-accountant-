import { jest } from '@jest/globals';
import { OCROrchestrator, OCRJobConfig } from '../orchestrator';

const mockQuery = jest.fn(async (query: string, params?: unknown[]) => {
  if (query.includes('preferred_languages')) {
    return { rows: [{ preferred_languages: ['en'] }] };
  }
  return { rows: [] };
});

jest.mock('@ai-accountant/database', () => ({
  db: {
    query: (...args: unknown[]) => mockQuery(...(args as [string, unknown[]])),
  },
}));

describe('OCROrchestrator service contracts', () => {
  const orchestrator = new OCROrchestrator();
  const baseConfig: OCRJobConfig = {
    documentId: 'doc-123',
    storageKey: 'docs/doc-123.pdf',
    tenantId: 'tenant-xyz',
    preferredLanguages: ['en'],
    fileType: 'application/pdf',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_DOCUMENT_AI_ENABLED = 'true';
    process.env.AWS_TEXTRACT_ENABLED = 'false';
  });

  it('selects the cloud provider for English PDFs and records DB side-effects', async () => {
    const result = await orchestrator.processDocument(baseConfig, Buffer.from('pdf-bytes'));

    expect(result.rawText).toContain('Google Document AI');
    expect(mockQuery).toHaveBeenCalled();

    const usageInsert = mockQuery.mock.calls.find(([text]) => text.includes('ocr_usage_metrics'));
    expect(usageInsert?.[1]).toEqual(
      expect.arrayContaining(['tenant-xyz', 'doc-123', 'google_document_ai'])
    );

    const extractionInsert = mockQuery.mock.calls.find(([text]) => text.includes('document_extractions'));
    expect(extractionInsert?.[1]?.[0]).toBe('doc-123');
  });

  it('falls back to tesseract when cloud providers are disabled', async () => {
    process.env.GOOGLE_DOCUMENT_AI_ENABLED = 'false';
    process.env.AWS_TEXTRACT_ENABLED = 'false';

    const result = await orchestrator.processDocument(
      { ...baseConfig, storageKey: 'docs/doc-456.png', fileType: 'image/png' },
      Buffer.from('png-bytes')
    );

    expect(result.rawText).toContain('Tesseract');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('preferred_languages'),
      expect.arrayContaining(['tenant-xyz'])
    );
  });
});
