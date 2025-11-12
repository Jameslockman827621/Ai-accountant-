import Tesseract from 'tesseract.js';
import pdfParse from 'pdf-parse';
import sharp from 'sharp';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ocr-service');

export async function processOCRJob(buffer: Buffer, storageKey: string): Promise<string> {
  const fileExtension = storageKey.split('.').pop()?.toLowerCase();

  try {
    if (fileExtension === 'pdf') {
      return await processPDF(buffer);
    } else if (['jpg', 'jpeg', 'png'].includes(fileExtension || '')) {
      return await processImage(buffer);
    } else {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }
  } catch (error) {
    logger.error('OCR processing failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

async function processPDF(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    logger.error('PDF parsing failed', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function processImage(buffer: Buffer): Promise<string> {
  try {
    // Preprocess image for better OCR
    const processedImage = await sharp(buffer)
      .greyscale()
      .normalize()
      .sharpen()
      .toBuffer();

    // Run OCR with Tesseract
    const { data: { text } } = await Tesseract.recognize(processedImage, 'eng', {
      logger: (info) => {
        if (info.status === 'recognizing text') {
          logger.debug(`OCR progress: ${Math.round(info.progress * 100)}%`);
        }
      },
    });

    return text;
  } catch (error) {
    logger.error('Image OCR failed', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Image OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
