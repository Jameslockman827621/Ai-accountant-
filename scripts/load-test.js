#!/usr/bin/env node

// Load testing script using k6 or artillery
const { spawn } = require('child_process');

console.log('Starting load tests...');

// In production, use k6 or artillery
// k6 run load-test.js
// artillery run load-test.yml

const scenarios = [
  {
    name: 'API Load Test',
    endpoint: '/api/documents',
    method: 'POST',
    rate: 100, // requests per second
    duration: '5m',
  },
  {
    name: 'Report Generation Test',
    endpoint: '/api/reports/profit-loss',
    method: 'GET',
    rate: 10,
    duration: '2m',
  },
];

console.log('Load test scenarios:', scenarios);
