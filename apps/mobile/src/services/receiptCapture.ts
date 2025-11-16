/**
 * Receipt Capture Service with Camera Integration
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { launchCamera, launchImageLibrary, ImagePickerResponse, MediaType } from 'react-native-image-picker';
import { apiClient } from './apiClient';

const logger = createLogger('receipt-capture');

export interface ReceiptCaptureOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowsEditing?: boolean;
}

export interface ReceiptImage {
  uri: string;
  type: string;
  name: string;
  size?: number;
}

export interface ReceiptCaptureResult {
  image: ReceiptImage;
  extractedData?: {
    vendor?: string;
    date?: string;
    amount?: number;
    tax?: number;
    items?: Array<{ description: string; amount: number }>;
  };
  confidence?: number;
}

class ReceiptCaptureService {
  async captureFromCamera(options: ReceiptCaptureOptions = {}): Promise<ReceiptCaptureResult> {
    return new Promise((resolve, reject) => {
      launchCamera(
        {
          mediaType: 'photo' as MediaType,
          quality: options.quality || 0.8,
          maxWidth: options.maxWidth || 2048,
          maxHeight: options.maxHeight || 2048,
          allowsEditing: options.allowsEditing || false,
        },
        async (response: ImagePickerResponse) => {
          if (response.didCancel) {
            reject(new Error('User cancelled camera'));
            return;
          }

          if (response.errorCode) {
            reject(new Error(`Camera error: ${response.errorCode}`));
            return;
          }

          if (response.assets && response.assets[0]) {
            const asset = response.assets[0];
            const result = await this.processReceiptImage({
              uri: asset.uri || '',
              type: asset.type || 'image/jpeg',
              name: asset.fileName || `receipt_${Date.now()}.jpg`,
              size: asset.fileSize,
            });

            resolve(result);
          } else {
            reject(new Error('No image captured'));
          }
        }
      );
    });
  }

  async captureFromGallery(options: ReceiptCaptureOptions = {}): Promise<ReceiptCaptureResult> {
    return new Promise((resolve, reject) => {
      launchImageLibrary(
        {
          mediaType: 'photo' as MediaType,
          quality: options.quality || 0.8,
          maxWidth: options.maxWidth || 2048,
          maxHeight: options.maxHeight || 2048,
          allowsEditing: options.allowsEditing || false,
        },
        async (response: ImagePickerResponse) => {
          if (response.didCancel) {
            reject(new Error('User cancelled gallery'));
            return;
          }

          if (response.errorCode) {
            reject(new Error(`Gallery error: ${response.errorCode}`));
            return;
          }

          if (response.assets && response.assets[0]) {
            const asset = response.assets[0];
            const result = await this.processReceiptImage({
              uri: asset.uri || '',
              type: asset.type || 'image/jpeg',
              name: asset.fileName || `receipt_${Date.now()}.jpg`,
              size: asset.fileSize,
            });

            resolve(result);
          } else {
            reject(new Error('No image selected'));
          }
        }
      );
    });
  }

  private async processReceiptImage(image: ReceiptImage): Promise<ReceiptCaptureResult> {
    try {
      // Upload image for OCR processing
      const formData = new FormData();
      formData.append('file', {
        uri: image.uri,
        type: image.type,
        name: image.name,
      } as any);

      const result = await apiClient.post<{
        document: {
          id: string;
          extracted_data: Record<string, unknown>;
          confidence_score: number;
        };
      }>('/api/documents/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      return {
        image,
        extractedData: result.document.extracted_data as ReceiptCaptureResult['extractedData'],
        confidence: result.document.confidence_score,
      };
    } catch (error) {
      logger.error('Failed to process receipt image', error);
      // Return image without extracted data if processing fails
      return {
        image,
      };
    }
  }

  async saveReceipt(
    receipt: ReceiptCaptureResult,
    metadata?: {
      category?: string;
      notes?: string;
      tags?: string[];
    }
  ): Promise<string> {
    try {
      const result = await apiClient.post<{ documentId: string }>('/api/documents', {
        fileName: receipt.image.name,
        extractedData: receipt.extractedData,
        confidenceScore: receipt.confidence,
        metadata,
      });

      logger.info('Receipt saved', { documentId: result.documentId });
      return result.documentId;
    } catch (error) {
      logger.error('Failed to save receipt', error);
      throw error;
    }
  }
}

export const receiptCaptureService = new ReceiptCaptureService();
