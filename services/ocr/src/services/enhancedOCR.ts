import { createWorker, Worker } from 'tesseract.js';
import sharp from 'sharp';
import { createLogger } from '@ai-accountant/shared-utils';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const logger = createLogger('ocr-service');

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true,
});

let worker: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          logger.debug('OCR progress', { progress: m.progress });
        }
      },
    });
  }
  return worker;
}

export interface EnhancedOCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
  tables?: Array<{
    rows: Array<Array<string>>;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

export async function enhancedOCR(
  bucket: string,
  key: string,
  language: string = 'eng'
): Promise<EnhancedOCRResult> {
  logger.info('Starting enhanced OCR', { bucket, key, language });

  try {
    // Download image from S3
    const getObjectCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(getObjectCommand);
    
    if (!response.Body) {
      throw new Error('No image data received from S3');
    }

    const imageBuffer = Buffer.from(await response.Body.transformToByteArray());

    // Preprocess image for better OCR accuracy
    const processedImage = await preprocessImage(imageBuffer);

    // Initialize worker with appropriate language
    const ocrWorker = await getWorker();
    if (language !== 'eng') {
      await ocrWorker.loadLanguage(language);
      await ocrWorker.initialize(language);
    }

    // Perform OCR with detailed output
    const { data } = await ocrWorker.recognize(processedImage, {
      rectangle: undefined, // Process entire image
    });

    // Extract words with bounding boxes
    const words = data.words.map(word => ({
      text: word.text,
      confidence: word.confidence || 0,
      bbox: {
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1,
      },
    }));

    // Detect tables (simplified - in production, use dedicated table detection)
    const tables = detectTables(words);

    // Calculate overall confidence
    const confidence = words.length > 0
      ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
      : 0;

    logger.info('Enhanced OCR completed', {
      bucket,
      key,
      textLength: data.text.length,
      wordCount: words.length,
      confidence,
      tableCount: tables.length,
    });

    return {
      text: data.text,
      confidence: Math.round(confidence * 100) / 100,
      words,
      tables: tables.length > 0 ? tables : undefined,
    };
  } catch (error) {
    logger.error('Enhanced OCR failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

async function preprocessImage(imageBuffer: Buffer): Promise<Buffer> {
  try {
    // Apply image preprocessing for better OCR accuracy
    const processed = await sharp(imageBuffer)
      .greyscale() // Convert to grayscale
      .normalize() // Normalize contrast
      .sharpen() // Sharpen edges
      .threshold(128) // Binarize (convert to black and white)
      .png()
      .toBuffer();

    return processed;
  } catch (error) {
    logger.warn('Image preprocessing failed, using original', error instanceof Error ? error : new Error(String(error)));
    return imageBuffer;
  }
}

function detectTables(words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>): Array<{
  rows: Array<Array<string>>;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}> {
  // Simplified table detection - groups words by rows and columns
  // In production, use a dedicated table detection library
  
  if (words.length < 4) {
    return [];
  }

  // Group words by approximate row (y-coordinate)
  const rowTolerance = 10;
  const rows: Array<Array<{ text: string; x: number }>> = [];

  for (const word of words) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    
    // Find existing row or create new one
    let foundRow = false;
    for (const row of rows) {
      if (row.length > 0) {
        const firstWordY = (words.find(w => w.text === row[0]?.text)?.bbox.y0 || 0) + 
                          (words.find(w => w.text === row[0]?.text)?.bbox.y1 || 0) / 2;
        if (Math.abs(y - firstWordY) < rowTolerance) {
          row.push({ text: word.text, x: (word.bbox.x0 + word.bbox.x1) / 2 });
          foundRow = true;
          break;
        }
      }
    }

    if (!foundRow) {
      rows.push([{ text: word.text, x: (word.bbox.x0 + word.bbox.x1) / 2 }]);
    }
  }

  // Sort rows by y-coordinate
  rows.sort((a, b) => {
    const aY = words.find(w => w.text === a[0]?.text)?.bbox.y0 || 0;
    const bY = words.find(w => w.text === b[0]?.text)?.bbox.y0 || 0;
    return aY - bY;
  });

  // Sort words within each row by x-coordinate
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
  }

  // Detect if this looks like a table (multiple rows with similar structure)
  if (rows.length >= 2 && rows.every(row => row.length >= 2)) {
    const tableRows = rows.map(row => row.map(w => w.text));
    const minX = Math.min(...words.map(w => w.bbox.x0));
    const maxX = Math.max(...words.map(w => w.bbox.x1));
    const minY = Math.min(...words.map(w => w.bbox.y0));
    const maxY = Math.max(...words.map(w => w.bbox.y1));

    return [{
      rows: tableRows,
      bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
    }];
  }

  return [];
}

export async function multiLanguageOCR(
  bucket: string,
  key: string,
  languages: string[] = ['eng']
): Promise<EnhancedOCRResult> {
  logger.info('Starting multi-language OCR', { bucket, key, languages });

  // Try each language and return the best result
  let bestResult: EnhancedOCRResult | null = null;
  let bestConfidence = 0;

  for (const lang of languages) {
    try {
      const result = await enhancedOCR(bucket, key, lang);
      if (result.confidence > bestConfidence) {
        bestConfidence = result.confidence;
        bestResult = result;
      }
    } catch (error) {
      logger.warn(`OCR failed for language ${lang}`, error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (!bestResult) {
    throw new Error('OCR failed for all languages');
  }

  return bestResult;
}
