import amqp from 'amqplib';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('document-ingest-service');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const OCR_QUEUE = 'ocr_processing';
const CLASSIFICATION_QUEUE = 'document_classification';

let connection: amqp.Connection | null = null;
let channel: amqp.ConfirmChannel | null = null;

export async function connectQueue(): Promise<void> {
  try {
    connection = await amqp.connect(RABBITMQ_URL);
    if (!connection) {
      throw new Error('Failed to connect to RabbitMQ');
    }
    channel = await connection.createConfirmChannel();

    // Declare queues
    await channel.assertQueue(OCR_QUEUE, { durable: true });
    await channel.assertQueue(CLASSIFICATION_QUEUE, { durable: true });

    logger.info('Connected to message queue');
  } catch (error) {
    logger.error('Failed to connect to message queue', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function publishOCRJob(documentId: string, storageKey: string): Promise<void> {
  if (!channel || !connection) {
    throw new Error('Message queue not connected');
  }

  try {
    const message = JSON.stringify({ documentId, storageKey });
    channel.sendToQueue(OCR_QUEUE, Buffer.from(message), { persistent: true });
    logger.info('OCR job published', { documentId, storageKey });
  } catch (error) {
    logger.error('Failed to publish OCR job', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function publishClassificationJob(documentId: string, extractedText: string): Promise<void> {
  if (!channel) {
    throw new Error('Message queue not connected');
  }

  try {
    const message = JSON.stringify({ documentId, extractedText });
    channel.sendToQueue(CLASSIFICATION_QUEUE, Buffer.from(message), { persistent: true });
    logger.info('Classification job published', { documentId });
  } catch (error) {
    logger.error('Failed to publish classification job', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function closeQueue(): Promise<void> {
  if (channel) {
    channel.close();
  }
  if (connection) {
    await connection.close();
  }
}
