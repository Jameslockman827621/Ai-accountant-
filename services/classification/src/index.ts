import amqp from 'amqplib';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { processClassificationJob } from './processor';
import { db } from '@ai-accountant/database';
import { DocumentStatus, DocumentType } from '@ai-accountant/shared-types';

config();

const logger = createLogger('classification-service');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const CLASSIFICATION_QUEUE = 'document_classification';
const CLASSIFICATION_DLQ = 'document_classification_dlq';
const LEDGER_QUEUE = 'ledger_posting';
const LEDGER_DLQ = 'ledger_posting_dlq';

async function startWorker(): Promise<void> {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

      await channel.assertQueue(CLASSIFICATION_QUEUE, { durable: true });
      await channel.assertQueue(CLASSIFICATION_DLQ, { durable: true });
      await channel.assertQueue(LEDGER_QUEUE, { durable: true });
      await channel.assertQueue(LEDGER_DLQ, { durable: true });
    channel.prefetch(1);

    logger.info('Classification worker started, waiting for jobs...');

    channel.consume(CLASSIFICATION_QUEUE, async (msg) => {
      if (!msg) {
        return;
      }

      try {
        const { documentId, extractedText } = JSON.parse(msg.content.toString());
        logger.info('Processing classification job', { documentId });

        // Process classification
        const result = await processClassificationJob(extractedText);

        // Update document
        await db.query(
          `UPDATE documents
           SET document_type = $1,
               extracted_data = jsonb_set(
                 COALESCE(extracted_data, '{}'::jsonb),
                 '{classification}',
                 $2::jsonb
               ),
               confidence_score = $3,
               status = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [
            result.documentType,
            JSON.stringify(result.extractedData),
            result.confidenceScore,
            DocumentStatus.CLASSIFIED,
            documentId,
          ]
        );

        // Publish to ledger processing queue if needed
          if (result.documentType === DocumentType.INVOICE || result.documentType === DocumentType.RECEIPT) {
            channel.sendToQueue(
              LEDGER_QUEUE,
              Buffer.from(JSON.stringify({ documentId, classification: result })),
              { persistent: true }
            );
            logger.info('Document queued for ledger posting', { documentId });
        }

        channel.ack(msg);
        logger.info('Classification job completed', { documentId, type: result.documentType });
      } catch (error) {
        logger.error('Classification job failed', error instanceof Error ? error : new Error(String(error)));

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
              error instanceof Error ? error.message : 'Classification failed',
              documentId,
            ]
          );
          } catch (updateError) {
          logger.error('Failed to update document status', updateError instanceof Error ? updateError : new Error(String(updateError)));
        }
          channel.sendToQueue(
            CLASSIFICATION_DLQ,
            Buffer.from(
              JSON.stringify({
                documentId,
                error: error instanceof Error ? error.message : 'Classification failed',
                failedAt: new Date().toISOString(),
              })
            ),
            { persistent: true }
          );
          channel.ack(msg);
      }
    });
  } catch (error) {
    logger.error('Failed to start classification worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

startWorker();
