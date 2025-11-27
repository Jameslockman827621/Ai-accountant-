import pdfParse from 'pdf-parse';
import imageSize from 'image-size';
import {
  DocumentType,
  DocumentQualityIssue,
  DocumentChecklistItem,
} from '@ai-accountant/shared-types';

export interface QualityAssessmentResult {
  score: number;
  issues: DocumentQualityIssue[];
  checklist: DocumentChecklistItem[];
  pageCount: number;
  suggestedType: DocumentType;
}

export interface QualityGateDecision {
  status: 'passed' | 'needs_review';
  reasons: DocumentQualityIssue[];
}

const DEFAULT_CHECKLISTS: Record<DocumentType, DocumentChecklistItem[]> = {
  [DocumentType.INVOICE]: [
    { id: 'vendor', label: 'Supplier name & address visible', completed: true },
    { id: 'totals', label: 'Subtotal, tax, and grand total readable', completed: true },
    { id: 'invoice-number', label: 'Invoice number or reference present', completed: true },
    { id: 'dates', label: 'Invoice date clearly shown', completed: true },
  ],
  [DocumentType.RECEIPT]: [
    { id: 'merchant', label: 'Merchant name visible', completed: true },
    { id: 'amount', label: 'Total amount & tax visible', completed: true },
    { id: 'date', label: 'Purchase date readable', completed: true },
  ],
  [DocumentType.STATEMENT]: [
    { id: 'institution', label: 'Bank/institution name visible', completed: true },
    { id: 'dates', label: 'Statement period dates readable', completed: true },
    { id: 'balances', label: 'Opening & closing balances visible', completed: true },
  ],
  [DocumentType.PAYSLIP]: [
    { id: 'employee', label: 'Employee & employer names present', completed: true },
    { id: 'gross-net', label: 'Gross & net pay readable', completed: true },
    { id: 'taxes', label: 'Tax & NI deductions visible', completed: true },
  ],
  [DocumentType.TAX_FORM]: [
    { id: 'reference', label: 'Tax reference / UTR visible', completed: true },
    { id: 'period', label: 'Tax period or filing date readable', completed: true },
    { id: 'totals', label: 'Declared totals clearly shown', completed: true },
  ],
  [DocumentType.OTHER]: [
    { id: 'readable', label: 'Document is legible end-to-end', completed: true },
    { id: 'context', label: 'Includes enough context to classify', completed: true },
  ],
};

const FILE_SIZE_WARN_LOW = 30 * 1024; // 30 KB
const FILE_SIZE_WARN_HIGH = 20 * 1024 * 1024; // 20 MB
const MIN_IMAGE_DIMENSION = 900;
const MAX_RECOMMENDED_PAGES = 25;
const MIN_TEXT_LENGTH_PER_PAGE = 20;
const MIN_BYTES_PER_MEGAPIXEL = 45_000; // heuristic for blur/over-compression

const KNOWN_KEYWORDS: Array<{ pattern: RegExp; type: DocumentType }> = [
  { pattern: /invoice/i, type: DocumentType.INVOICE },
  { pattern: /receipt|till/i, type: DocumentType.RECEIPT },
  { pattern: /statement/i, type: DocumentType.STATEMENT },
  { pattern: /payslip|paystub/i, type: DocumentType.PAYSLIP },
  { pattern: /vat|tax/i, type: DocumentType.TAX_FORM },
];

function inferDocumentType(
  fileName: string,
  declaredType?: DocumentType
): DocumentType {
  if (declaredType) {
    return declaredType;
  }
  for (const keyword of KNOWN_KEYWORDS) {
    if (keyword.pattern.test(fileName)) {
      return keyword.type;
    }
  }
  return DocumentType.OTHER;
}

function cloneChecklist(type: DocumentType): DocumentChecklistItem[] {
  return (DEFAULT_CHECKLISTS[type] ?? DEFAULT_CHECKLISTS[DocumentType.OTHER]).map(item => ({
    ...item,
  }));
}

function flagChecklist(
  checklist: DocumentChecklistItem[],
  ids: string[]
): void {
  ids.forEach(id => {
    const item = checklist.find(entry => entry.id === id);
    if (item) {
      item.completed = false;
    }
  });
}

export async function assessDocumentQuality(
  file: Express.Multer.File,
  declaredType?: DocumentType
): Promise<QualityAssessmentResult> {
  let score = 100;
  let pageCount = 1;
  const issues: DocumentQualityIssue[] = [];
  const suggestedType = inferDocumentType(file.originalname, declaredType);
  const checklist = cloneChecklist(suggestedType);

  if (file.size < FILE_SIZE_WARN_LOW) {
    issues.push({
      id: 'file_too_small',
      severity: 'warning',
      message: 'The file looks very small and may be unreadable.',
      recommendation: 'Rescan or export at a higher resolution before uploading.',
    });
    score -= 15;
    flagChecklist(checklist, ['totals', 'amount', 'readable']);
  }

  if (file.size > FILE_SIZE_WARN_HIGH) {
    issues.push({
      id: 'file_too_large',
      severity: 'info',
      message: 'Large file detected; processing may take longer.',
      recommendation: 'Consider compressing the PDF or image.',
    });
    score -= 5;
  }

  const mime = file.mimetype.toLowerCase();
  const isPdf = mime.includes('pdf') || file.originalname.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    try {
      const pdfData = await pdfParse(file.buffer);
      pageCount = pdfData.numpages || 1;
      const textLength = pdfData.text?.trim().length || 0;
      if (pageCount > MAX_RECOMMENDED_PAGES) {
        issues.push({
          id: 'too_many_pages',
          severity: 'warning',
          message: `This PDF has ${pageCount} pages. Long statements slow down OCR.`,
          recommendation: 'Split long statements into monthly extracts for best accuracy.',
        });
        score -= 10;
      }

      if (textLength < MIN_TEXT_LENGTH_PER_PAGE * Math.max(1, pageCount)) {
        issues.push({
          id: 'missing_content',
          severity: 'critical',
          message: 'The PDF looks mostly empty or unparseable.',
          recommendation: 'Verify the export settings or re-download from the source system.',
        });
        score -= 35;
        flagChecklist(checklist, ['readable', 'totals', 'amount']);
      }
    } catch (error) {
      issues.push({
        id: 'pdf_unreadable',
        severity: 'critical',
        message: 'Unable to parse PDF. The file may be encrypted or corrupted.',
        recommendation: 'Download the PDF again or export it without password protection.',
      });
      score -= 35;
      flagChecklist(checklist, ['readable']);
    }
  } else if (mime.startsWith('image/')) {
    try {
      const dimensions = imageSize(file.buffer);
      const width = dimensions.width || 0;
      const height = dimensions.height || 0;
      if (Math.min(width, height) < MIN_IMAGE_DIMENSION) {
        issues.push({
          id: 'low_resolution',
          severity: 'warning',
          message: `Image resolution (${width}×${height}) may be too low for OCR.`,
          recommendation: 'Capture photos in good lighting and ensure text covers most of the frame.',
        });
        score -= 15;
        flagChecklist(checklist, ['totals', 'amount', 'readable']);
      }
      const ratio = height === 0 ? 1 : width / height;
      if (ratio > 2 || ratio < 0.5) {
        issues.push({
          id: 'orientation',
          severity: 'info',
          message: 'Image looks heavily landscape or portrait.',
          recommendation: 'Crop away large margins so the document fills the image.',
        });
        score -= 5;
      }

      const megapixels = width && height ? (width * height) / 1_000_000 : 0;
      const bytesPerMegapixel = megapixels > 0 ? file.size / megapixels : 0;
      if (megapixels > 0 && bytesPerMegapixel < MIN_BYTES_PER_MEGAPIXEL) {
        issues.push({
          id: 'blur_detected',
          severity: 'warning',
          message: 'Image appears heavily compressed or blurred.',
          recommendation: 'Retake the photo in better lighting or export a higher-resolution image.',
        });
        score -= 20;
        flagChecklist(checklist, ['readable', 'totals', 'amount']);
      }
    } catch (error) {
      issues.push({
        id: 'image_unreadable',
        severity: 'critical',
        message: 'Unable to read image metadata.',
        recommendation: 'Try re-exporting the file as JPG or PNG.',
      });
      score -= 25;
    }
  } else if (mime === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
    issues.push({
      id: 'csv_upload',
      severity: 'info',
      message: 'CSV detected. Use statement CSVs only for bank imports.',
      recommendation: 'PDF statements provide richer context for automated reconciliation.',
    });
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    issues,
    checklist,
    pageCount,
    suggestedType,
  };
}

export function evaluateQualityGate(result: QualityAssessmentResult): QualityGateDecision {
  const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
  const gateFailed = criticalIssues.length > 0 || result.score < 70;

  return {
    status: gateFailed ? 'needs_review' : 'passed',
    reasons: gateFailed ? criticalIssues : [],
  };
}
