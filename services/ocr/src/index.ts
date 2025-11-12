import amqp from 'amqplib';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { processOCRJob } from './processor';
import { db } from '@ai-accountant/database';
import { DocumentStatus } from '@ai-accountant/shared-types';
import { getFile } from './storage/s3';

config();

const logger = createLogger('ocr-service');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const OCR_QUEUE = 'ocr_processing';

async function startWorker(): Promise<void> {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(OCR_QUEUE, { durable: true });
    channel.prefetch(1); // Process one job at a time

    logger.info('OCR worker started, waiting for jobs...');

    channel.consume(OCR_QUEUE, async (msg) => {
      if (!msg) {
        return;
      }

      try {
        const { documentId, storageKey } = JSON.parse(msg.content.toString());
        logger.info('Processing OCR job', { documentId, storageKey });

        // Get file from storage
        const fileBuffer = await getFile(storageKey);

        // Process OCR
        const extractedText = await processOCRJob(fileBuffer, storageKey);

        // Update document with extracted text
        await db.query(
          `UPDATE documents
           SET extracted_data = jsonb_build_object('rawText', $1),
               status = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [extractedText, DocumentStatus.EXTRACTED, documentId]
        );

        // Publish classification job
        // (This would be handled by classification service)

        channel.ack(msg);
        logger.info('OCR job completed', { documentId });
      } catch (error) {
        logger.error('OCR job failed', error instanceof Error ? error : new Error(String(error)));
        
        // Update document status to error
        try {
          const { documentId } = JSON.parse(msg.content.toString());
          await db.query(
            `UPDATE documents
             SET status = $1,
                 error_message = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [
              DocumentStatus.ERROR,
              error instanceof Error ? error.message : 'OCR processing failed',
              documentId,
            ]
          );
        } catch (updateError) {
          logger.error('Failed to update document status', updateError instanceof Error ? updateError : new Error(String(updateError)));
        }

        channel.nack(msg, false, false); // Don't requeue failed jobs
      }
    });
  } catch (error) {
    logger.error('Failed to start OCR worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

startWorker();
