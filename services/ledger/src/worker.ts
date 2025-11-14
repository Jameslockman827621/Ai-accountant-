import amqp from 'amqplib';
import { config } from 'dotenv';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { DocumentStatus } from '@ai-accountant/shared-types';
import { postDocumentToLedger } from './services/posting';

config();

const logger = createLogger('ledger-service');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const LEDGER_QUEUE = 'ledger_posting';
const LEDGER_DLQ = 'ledger_posting_dlq';

async function startWorker(): Promise<void> {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(LEDGER_QUEUE, { durable: true });
    await channel.assertQueue(LEDGER_DLQ, { durable: true });
    channel.prefetch(1);

    logger.info('Ledger posting worker started, waiting for jobs...');

    channel.consume(LEDGER_QUEUE, async (msg) => {
      if (!msg) {
        return;
      }

      const payload = JSON.parse(msg.content.toString()) as { documentId: string };
      const { documentId } = payload;

      try {
        logger.info('Processing ledger posting job', { documentId });

        const docResult = await db.query<{
          tenant_id: string;
          uploaded_by: string;
        }>(
          'SELECT tenant_id, uploaded_by FROM documents WHERE id = $1',
          [documentId]
        );

        if (docResult.rows.length === 0) {
          throw new Error('Document not found');
        }

        await db.query(
          `UPDATE documents
           SET status = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [DocumentStatus.PROCESSING, documentId]
        );

        const doc = docResult.rows[0];
        await postDocumentToLedger(doc.tenant_id, documentId, doc.uploaded_by);

        channel.ack(msg);
        logger.info('Ledger posting job completed', { documentId });
      } catch (error) {
        await handleLedgerFailure(channel, msg, documentId, error);
      }
    });
  } catch (error) {
    logger.error('Failed to start ledger worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

async function handleLedgerFailure(
  channel: amqp.Channel,
  msg: amqp.ConsumeMessage,
  documentId: string,
  error: unknown
): Promise<void> {
  logger.error('Ledger posting job failed', error instanceof Error ? error : new Error(String(error)));

  try {
    if (error instanceof ValidationError) {
      await db.query(
        `UPDATE documents
         SET status = $1,
             error_message = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [DocumentStatus.CLASSIFIED, error.message, documentId]
      );
      logger.warn('Ledger posting deferred for manual review', { documentId, reason: error.message });
    } else {
      await db.query(
        `UPDATE documents
         SET status = $1,
             error_message = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [DocumentStatus.ERROR, error instanceof Error ? error.message : 'Ledger posting failed', documentId]
      );

      channel.sendToQueue(
        LEDGER_DLQ,
        Buffer.from(
          JSON.stringify({
            documentId,
            error: error instanceof Error ? error.message : 'Ledger posting failed',
            failedAt: new Date().toISOString(),
          })
        ),
        { persistent: true }
      );
    }
  } catch (updateError) {
    logger.error('Failed to update document status', updateError instanceof Error ? updateError : new Error(String(updateError)));
  } finally {
    channel.ack(msg);
  }
}

startWorker();
