import axios from 'axios';
import { createHash } from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';

interface StatuteSource {
  authority: string;
  jurisdiction: string;
  topic: string;
  url: string;
}

export interface StatuteScanResult {
  authority: string;
  jurisdiction: string;
  topic: string;
  url: string;
  status: 'updated' | 'unchanged' | 'failed';
  hash?: string;
  rulepacksTouched?: string[];
  error?: string;
}

const logger = createLogger('statute-monitor');

const DEFAULT_SOURCES: StatuteSource[] = [
  {
    authority: 'HMRC',
    jurisdiction: 'GB',
    topic: 'VAT Notices',
    url: 'https://www.gov.uk/government/collections/vat-notices',
  },
  {
    authority: 'HMRC',
    jurisdiction: 'GB',
    topic: 'PAYE updates',
    url: 'https://www.gov.uk/government/collections/paye',
  },
  {
    authority: 'IRS',
    jurisdiction: 'US',
    topic: 'Modernized e-File',
    url: 'https://www.irs.gov/e-file-providers/modernized-e-file-mef-status',
  },
  {
    authority: 'CRA',
    jurisdiction: 'CA',
    topic: 'GST/HST news',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses.html',
  },
  {
    authority: 'EU Commission',
    jurisdiction: 'EU',
    topic: 'VAT OSS',
    url: 'https://ec.europa.eu/taxation_customs/vat_en',
  },
];

type RulepackMetadata = Record<string, unknown> & {
  statuteDigests?: Array<{
    authority: string;
    jurisdiction: string;
    topic: string;
    url: string;
    hash: string;
    checkedAt: string;
    previousHash?: string;
  }>;
  pendingStatuteReview?: boolean;
};

export class StatuteMonitorService {
  constructor(private readonly sources: StatuteSource[] = DEFAULT_SOURCES) {}

  async scanAndRecord(): Promise<StatuteScanResult[]> {
    const results: StatuteScanResult[] = [];

    for (const source of this.sources) {
      try {
        const response = await axios.get<string>(source.url, {
          timeout: 15000,
          responseType: 'text',
        });
        const payload = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const hash = createHash('sha256').update(payload).digest('hex');

        const updatedRulepacks = await this.recordHash(source, hash);

        results.push({
          ...source,
          status: updatedRulepacks.length > 0 ? 'updated' : 'unchanged',
          hash,
          rulepacksTouched: updatedRulepacks,
        });
      } catch (error) {
        logger.warn('Statute source fetch failed', {
          source,
          error: error instanceof Error ? error.message : error,
        });
        results.push({
          ...source,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  private async recordHash(source: StatuteSource, hash: string): Promise<string[]> {
    const rulepackResult = await db.query<{
      id: string;
      metadata: unknown;
    }>(
      `SELECT id, metadata
         FROM rulepack_registry
        WHERE jurisdiction = $1`,
      [source.jurisdiction]
    );

    const touched: string[] = [];
    const now = new Date().toISOString();

    for (const row of rulepackResult.rows) {
      const metadata = this.parseMetadata(row.metadata);
      const digests = metadata.statuteDigests || [];
      const lastEntry = digests.find(
        entry => entry.authority === source.authority && entry.topic === source.topic
      );

      if (lastEntry && lastEntry.hash === hash) {
        continue;
      }

      const newEntry = {
        authority: source.authority,
        jurisdiction: source.jurisdiction,
        topic: source.topic,
        url: source.url,
        hash,
        checkedAt: now,
        previousHash: lastEntry?.hash,
      };

      metadata.statuteDigests = [newEntry, ...digests].slice(0, 25);
      metadata.pendingStatuteReview = true;

      await db.query(
        `UPDATE rulepack_registry
            SET metadata = $1::jsonb,
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify(metadata), row.id]
      );

      touched.push(row.id);
    }

    return touched;
  }

  private parseMetadata(payload: unknown): RulepackMetadata {
    if (payload && typeof payload === 'object') {
      return payload as RulepackMetadata;
    }
    return {};
  }
}

export const statuteMonitorService = new StatuteMonitorService();
