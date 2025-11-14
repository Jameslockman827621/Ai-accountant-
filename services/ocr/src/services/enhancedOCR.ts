import { createLogger } from '@ai-accountant/shared-utils';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';

const logger = createLogger('ocr-service');

/**
 * Enhanced OCR with pre-processing and post-processing
 */
export async function performEnhancedOCR(
  imageBuffer: Buffer,
  options: {
    preprocess?: boolean;
    language?: string;
    psm?: number;
  } = {}
): Promise<{
  text: string;
  confidence: number;
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}> {
  let processedImage = imageBuffer;

  // Pre-processing
  if (options.preprocess !== false) {
    processedImage = await preprocessImage(imageBuffer);
  }

  // OCR with Tesseract
  const { data } = await Tesseract.recognize(processedImage, options.language || 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        logger.debug('OCR progress', { progress: m.progress });
      }
    },
  });

  // Post-processing
  const cleanedText = postProcessText(data.text);
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

  const avgConfidence = words.length > 0
    ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
    : 0;

  return {
    text: cleanedText,
    confidence: avgConfidence / 100, // Convert to 0-1 scale
    words,
  };
}

/**
 * Pre-process image for better OCR accuracy
 */
async function preprocessImage(imageBuffer: Buffer): Promise<Buffer> {
  try {
    // Convert to grayscale
    let processed = await sharp(imageBuffer)
      .greyscale()
      .toBuffer();

    // Enhance contrast
    processed = await sharp(processed)
      .normalize()
      .sharpen()
      .toBuffer();

    // Resize if too small (minimum 300 DPI equivalent)
    const metadata = await sharp(processed).metadata();
    if (metadata.width && metadata.width < 1200) {
      processed = await sharp(processed)
        .resize(1200, null, { withoutEnlargement: true })
        .toBuffer();
    }

    return processed;
  } catch (error) {
    logger.error('Image preprocessing failed', error);
    return imageBuffer; // Return original if preprocessing fails
  }
}

/**
 * Post-process OCR text to clean up common errors
 */
function postProcessText(text: string): string {
  // Remove excessive whitespace
  let cleaned = text.replace(/\s+/g, ' ').trim();

  // Fix common OCR errors
  const corrections: Record<string, string> = {
    '0': 'O', // Context-dependent, but common
    '1': 'I', // Context-dependent
    '5': 'S', // Context-dependent
    'rn': 'm', // Common OCR error
    'vv': 'w',
    'ii': 'n',
  };

  // Apply corrections (simplified - in production use ML-based correction)
  Object.entries(corrections).forEach(([wrong, correct]) => {
    cleaned = cleaned.replace(new RegExp(wrong, 'gi'), correct);
  });

  return cleaned;
}
