import { createLogger } from '@ai-accountant/shared-utils';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

const logger = createLogger('schema-detection');

export interface DetectedSchema {
  columns: Array<{
    name: string;
    type: 'string' | 'number' | 'date' | 'boolean' | 'currency';
    sampleValues: unknown[];
    nullable: boolean;
  }>;
  rowCount: number;
  hasHeader: boolean;
  delimiter?: string;
  encoding?: string;
}

export interface MappingSuggestion {
  sourceColumn: string;
  targetField: string;
  confidence: number;
  transformation?: string;
}

export class SchemaDetectionService {
  /**
   * Detect schema from CSV file
   */
  async detectCSVSchema(fileContent: Buffer, filename: string): Promise<DetectedSchema> {
    try {
      const text = fileContent.toString('utf-8');
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      
      if (lines.length === 0) {
        throw new Error('Empty CSV file');
      }

      // Detect delimiter
      const delimiter = this.detectDelimiter(lines[0]);

      // Parse first few rows to detect schema
      const sampleRows = parse(text, {
        delimiter,
        skip_empty_lines: true,
        to: 100, // First 100 rows
      });

      const hasHeader = this.detectHeader(sampleRows);
      const dataRows = hasHeader ? sampleRows.slice(1) : sampleRows;
      const headerRow = hasHeader ? sampleRows[0] : this.generateHeaders(sampleRows[0]?.length || 0);

      const columns = headerRow.map((colName: string, index: number) => {
        const columnData = dataRows.map(row => row[index]).filter(val => val !== undefined && val !== '');
        return {
          name: colName,
          type: this.detectColumnType(columnData),
          sampleValues: columnData.slice(0, 5),
          nullable: columnData.length < dataRows.length,
        };
      });

      return {
        columns,
        rowCount: dataRows.length,
        hasHeader,
        delimiter,
        encoding: 'utf-8',
      };
    } catch (error) {
      logger.error('CSV schema detection failed', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Detect schema from Excel file
   */
  async detectExcelSchema(fileContent: Buffer, filename: string): Promise<DetectedSchema> {
    try {
      const workbook = XLSX.read(fileContent, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: null });

      if (data.length === 0) {
        throw new Error('Empty Excel file');
      }

      const hasHeader = this.detectHeader(data);
      const dataRows = hasHeader ? data.slice(1) : data;
      const headerRow = hasHeader
        ? (data[0] as string[])
        : this.generateHeaders((data[0] as unknown[])?.length || 0);

      const columns = headerRow.map((colName: string, index: number) => {
        const columnData = dataRows
          .map(row => (row as unknown[])[index])
          .filter(val => val !== undefined && val !== null && val !== '');
        
        return {
          name: colName,
          type: this.detectColumnType(columnData),
          sampleValues: columnData.slice(0, 5),
          nullable: columnData.length < dataRows.length,
        };
      });

      return {
        columns,
        rowCount: dataRows.length,
        hasHeader,
        encoding: 'utf-8',
      };
    } catch (error) {
      logger.error('Excel schema detection failed', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Suggest field mappings
   */
  suggestMappings(schema: DetectedSchema): MappingSuggestion[] {
    const suggestions: MappingSuggestion[] = [];
    const fieldPatterns: Record<string, RegExp[]> = {
      date: [/date/i, /time/i, /created/i, /transaction.*date/i],
      amount: [/amount/i, /total/i, /price/i, /cost/i, /value/i, /sum/i],
      description: [/description/i, /memo/i, /note/i, /details/i, /item/i],
      vendor: [/vendor/i, /supplier/i, /merchant/i, /payee/i, /from/i],
      category: [/category/i, /type/i, /class/i, /account/i],
      invoiceNumber: [/invoice/i, /inv.*#/i, /reference/i, /ref/i],
    };

    for (const column of schema.columns) {
      let bestMatch: { field: string; confidence: number } | null = null;

      for (const [field, patterns] of Object.entries(fieldPatterns)) {
        for (const pattern of patterns) {
          if (pattern.test(column.name)) {
            const confidence = this.calculateMappingConfidence(column, field);
            if (!bestMatch || confidence > bestMatch.confidence) {
              bestMatch = { field, confidence };
            }
          }
        }
      }

      if (bestMatch && bestMatch.confidence > 0.5) {
        suggestions.push({
          sourceColumn: column.name,
          targetField: bestMatch.field,
          confidence: bestMatch.confidence,
          transformation: this.suggestTransformation(column, bestMatch.field),
        });
      }
    }

    return suggestions;
  }

  /**
   * Detect delimiter
   */
  private detectDelimiter(firstLine: string): string {
    const delimiters = [',', ';', '\t', '|'];
    let maxCount = 0;
    let bestDelimiter = ',';

    for (const delim of delimiters) {
      const count = (firstLine.match(new RegExp(`\\${delim}`, 'g')) || []).length;
      if (count > maxCount) {
        maxCount = count;
        bestDelimiter = delim;
      }
    }

    return bestDelimiter;
  }

  /**
   * Detect if first row is header
   */
  private detectHeader(rows: unknown[][]): boolean {
    if (rows.length < 2) return false;

    const firstRow = rows[0] as string[];
    const secondRow = rows[1] as unknown[];

    // Check if first row contains mostly strings and second row contains data
    const firstRowStrings = firstRow.filter(cell => typeof cell === 'string' && isNaN(Number(cell))).length;
    const secondRowNumbers = secondRow.filter(cell => typeof cell === 'number' || !isNaN(Number(cell))).length;

    return firstRowStrings > firstRow.length * 0.7 && secondRowNumbers > secondRow.length * 0.3;
  }

  /**
   * Generate default headers
   */
  private generateHeaders(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `Column${i + 1}`);
  }

  /**
   * Detect column type
   */
  private detectColumnType(values: unknown[]): 'string' | 'number' | 'date' | 'boolean' | 'currency' {
    if (values.length === 0) return 'string';

    // Check for currency
    const currencyPattern = /^[\$£€]?\s*[\d,]+\.?\d*$/;
    if (values.every(v => typeof v === 'string' && currencyPattern.test(v))) {
      return 'currency';
    }

    // Check for numbers
    if (values.every(v => typeof v === 'number' || !isNaN(Number(v)))) {
      return 'number';
    }

    // Check for dates
    const datePattern = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
    if (values.every(v => typeof v === 'string' && datePattern.test(v))) {
      return 'date';
    }

    // Check for booleans
    if (values.every(v => typeof v === 'boolean' || v === 'true' || v === 'false' || v === 'yes' || v === 'no')) {
      return 'boolean';
    }

    return 'string';
  }

  /**
   * Calculate mapping confidence
   */
  private calculateMappingConfidence(
    column: DetectedSchema['columns'][0],
    targetField: string
  ): number {
    let confidence = 0.5;

    // Type matching
    const typeMatches: Record<string, string[]> = {
      date: ['date'],
      amount: ['number', 'currency'],
      description: ['string'],
      vendor: ['string'],
      category: ['string'],
    };

    if (typeMatches[targetField]?.includes(column.type)) {
      confidence += 0.3;
    }

    // Name similarity
    const nameLower = column.name.toLowerCase();
    if (nameLower.includes(targetField)) {
      confidence += 0.2;
    }

    return Math.min(1, confidence);
  }

  /**
   * Suggest transformation
   */
  private suggestTransformation(
    column: DetectedSchema['columns'][0],
    targetField: string
  ): string | undefined {
    if (targetField === 'amount' && column.type === 'string') {
      return 'parse_currency';
    }
    if (targetField === 'date' && column.type === 'string') {
      return 'parse_date';
    }
    return undefined;
  }
}

export const schemaDetectionService = new SchemaDetectionService();
