import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('rulepack-git-repo');
const execAsync = promisify(exec);

export interface RulepackDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

export interface PersistedSnapshot {
  absolutePath: string;
  relativePath: string;
  gitStatus?: string;
}

const DEFAULT_BASE_DIR =
  process.env.RULEPACK_REPO_DIR || path.join(process.cwd(), 'rulepack-registry');

export class RulepackGitRepository {
  constructor(private readonly baseDir: string = DEFAULT_BASE_DIR) {}

  async persistSnapshot(
    jurisdiction: string,
    version: string,
    payload: Record<string, unknown>
  ): Promise<PersistedSnapshot> {
    const normalizedJurisdiction = jurisdiction.toUpperCase();
    const dir = path.join(this.baseDir, normalizedJurisdiction);
    const filePath = path.join(dir, `${version}.json`);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');

    const relativePath = path.relative(process.cwd(), filePath);
    const gitStatus = await this.describeGitStatus(relativePath);

    logger.info('Persisted rulepack snapshot', {
      jurisdiction: normalizedJurisdiction,
      version,
      filePath: relativePath,
      gitStatus,
    });

    return { absolutePath: filePath, relativePath, gitStatus };
  }

  async getSnapshot(jurisdiction: string, version: string): Promise<Record<string, unknown>> {
    const filePath = this.resolveSnapshotPath(jurisdiction, version);
    const buffer = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(buffer) as Record<string, unknown>;
  }

  async diffSnapshots(
    jurisdiction: string,
    baselineVersion: string,
    compareVersion: string
  ): Promise<RulepackDiffEntry[]> {
    const baseline = await this.getSnapshot(jurisdiction, baselineVersion);
    const compare = await this.getSnapshot(jurisdiction, compareVersion);
    return this.computeDiff(baseline, compare);
  }

  async listSnapshots(jurisdiction: string): Promise<string[]> {
    const dir = path.join(this.baseDir, jurisdiction.toUpperCase());
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => entry.name.replace(/\.json$/, ''))
        .sort((a, b) => (a > b ? -1 : 1));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private resolveSnapshotPath(jurisdiction: string, version: string): string {
    return path.join(this.baseDir, jurisdiction.toUpperCase(), `${version}.json`);
  }

  private async describeGitStatus(relativePath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(`git status --short ${relativePath}`, {
        cwd: process.cwd(),
      });
      return stdout.trim() || undefined;
    } catch (error) {
      logger.debug('Unable to describe git status for snapshot', {
        path: relativePath,
        error: error instanceof Error ? error.message : error,
      });
      return undefined;
    }
  }

  private computeDiff(
    before: unknown,
    after: unknown,
    currentPath: string[] = []
  ): RulepackDiffEntry[] {
    if (this.valuesEqual(before, after)) {
      return [];
    }

    const diffs: RulepackDiffEntry[] = [];

    if (!this.isObject(before) || !this.isObject(after)) {
      diffs.push({
        path: currentPath.join('.') || '(root)',
        before,
        after,
      });
      return diffs;
    }

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
      const nextPath = [...currentPath, key];
      const beforeValue = (before as Record<string, unknown>)[key];
      const afterValue = (after as Record<string, unknown>)[key];

      if (this.valuesEqual(beforeValue, afterValue)) {
        continue;
      }

      if (this.isObject(beforeValue) && this.isObject(afterValue)) {
        diffs.push(...this.computeDiff(beforeValue, afterValue, nextPath));
      } else {
        diffs.push({
          path: nextPath.join('.'),
          before: beforeValue,
          after: afterValue,
        });
      }
    }

    return diffs;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

export const rulepackGitRepository = new RulepackGitRepository();
