// Type declarations for optional bullmq dependency
declare module 'bullmq' {
  export class Queue<T = unknown> {
    constructor(name: string, options?: unknown);
    add(name: string, data: T, options?: unknown): Promise<{ id?: string }>;
  }

  export class Worker<T = unknown> {
    constructor(name: string, processor: (job: Job<T>) => Promise<void>, options?: unknown);
    on(event: string, handler: (...args: unknown[]) => void): void;
    name: string;
  }

  export class Job<T = unknown> {
    id?: string;
    data: T;
    attemptsMade: number;
    finishedOn?: number;
    processedOn?: number;
  }
}
