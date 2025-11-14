import amqp from 'amqplib';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { postDocumentToLedger } from './services/posting';
import { db } from '@ai-accountant/database';

config();

const logger = createLogger('ledger-service');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const LEDGER_QUEUE = 'ledger_posting';

async function startWorker(): Promise<void> {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(LEDGER_QUEUE, { durable: true });
    channel.prefetch(1);

    logger.info('Ledger posting worker started, waiting for jobs...');

    channel.consume(LEDGER_QUEUE, async (msg) => {
      if (!msg) {
        return;
      }

      try {
        const { documentId, classification } = JSON.parse(msg.content.toString());
        logger.info('Processing ledger posting job', { documentId });

        // Get tenant and user info
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

        const doc = docResult.rows[0];

        // Post to ledger
        await postDocumentToLedger(doc.tenant_id, documentId, doc.uploaded_by);

        channel.ack(msg);
        logger.info('Ledger posting job completed', { documentId });
      } catch (error) {
        logger.error('Ledger posting job failed', error instanceof Error ? error : new Error(String(error)));

        // Update document status to error
        try {
          const { documentId } = JSON.parse(msg.content.toString());
          await db.query(
            `UPDATE documents
             SET status = 'error',
                 error_message = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [error instanceof Error ? error.message : 'Ledger posting failed', documentId]
          );
        } catch (updateError) {
          logger.error('Failed to update document status', updateError instanceof Error ? updateError : new Error(String(updateError)));
        }

        channel.nack(msg, false, false);
      }
    });
  } catch (error) {
    logger.error('Failed to start ledger worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

startWorker();
