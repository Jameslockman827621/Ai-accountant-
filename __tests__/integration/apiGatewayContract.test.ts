import { jest } from '@jest/globals';
import express from 'express';
import http from 'http';

jest.mock(
  'http-proxy-middleware',
  () => ({
    createProxyMiddleware: ({ target }: { target: string }) =>
      async (req: any, res: any) => {
        const upstreamUrl = `${target}${req.originalUrl || req.url}`;
        const response = await fetch(upstreamUrl, {
          method: req.method,
          headers: { 'Content-Type': 'application/json' },
          body: req.method !== 'GET' && req.body ? JSON.stringify(req.body) : undefined,
        });
        const data = await response.json();
        res.status(response.status).json(data);
      },
  }),
  { virtual: true }
);
jest.mock('cors', () => () => (_req: unknown, _res: unknown, next: () => void) => next(), { virtual: true });
jest.mock('helmet', () => () => (_req: unknown, _res: unknown, next: () => void) => next(), { virtual: true });
jest.mock(
  'express-rate-limit',
  () => () => (_req: unknown, _res: unknown, next: () => void) => next(),
  { virtual: true }
);

describe('API Gateway ↔ service ↔ DB contracts', () => {
  const downstreamHits: Record<string, unknown[]> = { documents: [], ledger: [] };
  const servers: http.Server[] = [];
  let gatewayBaseUrl = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const documentUrl = await startStubService('/api/documents/upload', (body) => {
      downstreamHits.documents.push(body);
      return { documentId: 'doc-1', storageKey: '/uploads/doc-1.pdf' };
    });

    const ledgerUrl = await startStubService('/api/ledger/entries', (body) => {
      downstreamHits.ledger.push(body);
      return { entryId: 'entry-1', persisted: true };
    });

    process.env.DOCUMENT_SERVICE_URL = documentUrl;
    process.env.LEDGER_SERVICE_URL = ledgerUrl;

    jest.resetModules();
    const { startApiGateway } = await import('../../services/api-gateway/src/index');
    const gatewayServer = startApiGateway(0);
    servers.push(gatewayServer);

    const address = gatewayServer.address();
    if (address && typeof address === 'object') {
      gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  afterAll(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            server.close(() => resolve(true));
          })
      )
    );
  });

  it('routes document uploads through the gateway to the document service', async () => {
    const res = await fetch(`${gatewayBaseUrl}/api/documents/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'tenant-1', filename: 'invoice.pdf' }),
    });

    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload.documentId).toBe('doc-1');
    expect(downstreamHits.documents[0]).toMatchObject({ filename: 'invoice.pdf' });
  });

  it('persists ledger writes via downstream service and returns the contract payload', async () => {
    const res = await fetch(`${gatewayBaseUrl}/api/ledger/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'tenant-1', accountCode: '4000', amount: 1200 }),
    });

    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload.entryId).toBe('entry-1');
    expect(downstreamHits.ledger[0]).toMatchObject({ accountCode: '4000', amount: 1200 });
  });

  async function startStubService(
    route: string,
    handler: (body: Record<string, unknown>) => Record<string, unknown>
  ): Promise<string> {
    const app = express();
    app.use(express.json());

    app.all(route, (req, res) => {
      res.json(handler(req.body));
    });

    const server = app.listen(0);
    servers.push(server);

    const address = server.address();
    if (address && typeof address === 'object') {
      return `http://127.0.0.1:${address.port}`;
    }
    throw new Error('Failed to allocate port for stub service');
  }
});
