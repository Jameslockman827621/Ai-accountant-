/**
 * k6 Load Testing Script
 * Tests peak filing deadlines and ensures P95 latencies within SLO
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 200 }, // Ramp up to 200 users
    { duration: '5m', target: 200 }, // Stay at 200 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must be below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate must be below 1%
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.AUTH_TOKEN || '';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  };

  // Test document upload
  const uploadRes = http.post(
    `${BASE_URL}/api/documents/upload`,
    {
      file: http.file(open('sample-invoice.pdf', 'b'), 'invoice.pdf'),
    },
    { headers }
  );
  check(uploadRes, {
    'upload status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(1);

  // Test assistant query
  const assistantRes = http.post(
    `${BASE_URL}/api/assistant/query`,
    JSON.stringify({ question: 'What is our VAT liability?' }),
    { headers }
  );
  check(assistantRes, {
    'assistant status is 200': (r) => r.status === 200,
    'assistant has answer': (r) => JSON.parse(r.body).response.answer.length > 0,
  }) || errorRate.add(1);

  sleep(1);

  // Test filing generation
  const filingRes = http.post(
    `${BASE_URL}/api/filings/generate`,
    JSON.stringify({
      filingType: 'vat',
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
    }),
    { headers }
  );
  check(filingRes, {
    'filing status is 200 or 202': (r) => r.status === 200 || r.status === 202,
  }) || errorRate.add(1);

  sleep(2);
}
