import amqp from 'amqplib';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('document-ingest-service');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const OCR_QUEUE = 'ocr_processing';
const CLASSIFICATION_QUEUE = 'document_classification';

let connection: amqp.Connection | null = null;
let channel: amqp.Channel | null = null;
let connectingPromise: Promise<void> | null = null;

export async function connectQueue(): Promise<void> {
  if (channel && connection) {
    return;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    try {
      const conn = await amqp.connect(RABBITMQ_URL);
      connection = conn;
      const ch = await conn.createChannel();
      channel = ch;

      await ch.assertQueue(OCR_QUEUE, { durable: true });
      await ch.assertQueue(CLASSIFICATION_QUEUE, { durable: true });

      logger.info('Connected to message queue');
    } catch (error) {
      logger.error('Failed to connect to message queue', error instanceof Error ? error : new Error(String(error)));
      connection = null;
      channel = null;
      throw error;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

async function getChannel(): Promise<amqp.Channel> {
  if (!channel) {
    await connectQueue();
  }

  if (!channel) {
    throw new Error('Message queue not connected');
  }

  return channel;
}

export async function publishOCRJob(documentId: string, storageKey: string): Promise<void> {
  try {
    const ch = await getChannel();
    const message = JSON.stringify({ documentId, storageKey });
    ch.sendToQueue(OCR_QUEUE, Buffer.from(message), { persistent: true });
    logger.info('OCR job published', { documentId, storageKey });
  } catch (error) {
    logger.error('Failed to publish OCR job', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function publishClassificationJob(documentId: string, extractedText: string): Promise<void> {
  try {
    const ch = await getChannel();
    const message = JSON.stringify({ documentId, extractedText });
    ch.sendToQueue(CLASSIFICATION_QUEUE, Buffer.from(message), { persistent: true });
    logger.info('Classification job published', { documentId });
  } catch (error) {
    logger.error('Failed to publish classification job', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function closeQueue(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (connection as any).close();
      connection = null;
    }
  } catch (error) {
    logger.error('Error closing queue connection', error instanceof Error ? error : new Error(String(error)));
  }
}
