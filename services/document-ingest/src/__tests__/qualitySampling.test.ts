import pdfParse from 'pdf-parse';
import imageSize from 'image-size';
import { assessDocumentQuality, evaluateQualityGate } from '../services/qualityAssessment';

jest.mock('pdf-parse', () => jest.fn());
jest.mock('image-size', () => jest.fn());

const mockPdfParse = pdfParse as jest.Mock;
const mockImageSize = imageSize as jest.Mock;

function buildFile(overrides: Partial<Express.Multer.File> & { buffer?: Buffer }): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'sample.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: overrides.buffer?.length || 1024,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as any,
    buffer: overrides.buffer || Buffer.from(''),
    ...overrides,
  } as Express.Multer.File;
}

describe('quality sampling against golden fixtures', () => {
  beforeEach(() => {
    mockPdfParse.mockResolvedValue({ numpages: 2, text: 'Sample content across pages' });
    mockImageSize.mockReturnValue({ width: 1200, height: 900 });
  });

  it('flags incomplete PDFs for manual quality review', async () => {
    const goldenPdf = Buffer.from('%PDF-1.4\n% blank payload');
    mockPdfParse.mockResolvedValueOnce({ numpages: 2, text: '' });

    const quality = await assessDocumentQuality(
      buildFile({ buffer: goldenPdf, originalname: 'empty.pdf', mimetype: 'application/pdf' })
    );
    const gate = evaluateQualityGate(quality);

    expect(quality.issues.some(issue => issue.id === 'missing_content')).toBe(true);
    expect(gate.status).toBe('needs_review');
  });

  it('detects blurred or over-compressed images before OCR', async () => {
    const goldenImage = Buffer.alloc(16_000, 1);
    mockImageSize.mockReturnValue({ width: 2000, height: 1200 });

    const quality = await assessDocumentQuality(
      buildFile({
        buffer: goldenImage,
        originalname: 'blurry-receipt.jpg',
        mimetype: 'image/jpeg',
        size: goldenImage.length,
      })
    );

    expect(quality.issues.some(issue => issue.id === 'blur_detected')).toBe(true);
    expect(quality.score).toBeLessThan(100);
  });
});
