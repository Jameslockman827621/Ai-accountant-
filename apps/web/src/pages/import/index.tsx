import React, { useMemo, useState } from 'react';

interface CsvRow {
  [key: string]: string;
}

const REQUIRED_FIELDS = ['date', 'description', 'amount'];
const STANDARD_FIELDS = ['date', 'description', 'amount', 'currency', 'category', 'counterparty'];

function parseCsv(content: string): CsvRow[] {
  const [headerLine, ...rows] = content.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((h) => h.trim());

  return rows
    .filter(Boolean)
    .map((line) => {
      const values = line.split(',');
      const row: CsvRow = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx]?.trim() ?? '';
      });
      return row;
    });
}

const SAMPLE_COLUMNS = ['transaction_date', 'details', 'value', 'currency', 'merchant'];

export default function ImportPage(): JSX.Element {
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [mergePreview, setMergePreview] = useState<CsvRow[]>([]);

  const availableColumns = useMemo(() => {
    if (rows.length === 0) return SAMPLE_COLUMNS;
    return Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  }, [rows]);

  const mappedPreview = useMemo(() => {
    return mergePreview.map((row) => {
      const mappedRow: CsvRow = {};
      Object.entries(mapping).forEach(([source, target]) => {
        if (target) {
          mappedRow[target] = row[source];
        }
      });
      return mappedRow;
    });
  }, [mergePreview, mapping]);

  const handleParse = (): void => {
    try {
      const parsed = parseCsv(csvText);
      setRows(parsed);
      setMergePreview(parsed.slice(0, 5));
      setValidationErrors([]);
    } catch (error) {
      setValidationErrors(['Unable to read CSV content. Please check formatting.']);
    }
  };

  const handleMappingChange = (source: string, target: string): void => {
    setMapping((prev) => ({ ...prev, [source]: target }));
  };

  const validateBeforeMerge = (): boolean => {
    const errors: string[] = [];
    REQUIRED_FIELDS.forEach((field) => {
      const hasMapping = Object.values(mapping).includes(field);
      if (!hasMapping) {
        errors.push(`Map a column to required field: ${field}`);
      }
    });

    mergePreview.forEach((row, idx) => {
      const mappedRow: Record<string, string> = {};
      Object.entries(mapping).forEach(([source, target]) => {
        if (target) mappedRow[target] = row[source];
      });

      if (mappedRow.amount && isNaN(parseFloat(mappedRow.amount))) {
        errors.push(`Row ${idx + 1}: Amount must be numeric`);
      }
      if (mappedRow.date && Number.isNaN(Date.parse(mappedRow.date))) {
        errors.push(`Row ${idx + 1}: Date is invalid`);
      }
    });

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleMerge = (): void => {
    if (!validateBeforeMerge()) return;

    const mergedRows = rows.map((row) => {
      const mappedRow: CsvRow = {};
      Object.entries(mapping).forEach(([source, target]) => {
        if (target) {
          mappedRow[target] = row[source];
        }
      });
      return mappedRow;
    });

    // Here we would POST to the API with validation guards; for now we preview the transformation
    setMergePreview(mergedRows.slice(0, 5));
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-wide text-blue-600">Data import fallback</p>
          <h1 className="text-3xl font-semibold">Upload CSV, map columns, and merge safely</h1>
          <p className="text-gray-600">
            Use the manual importer when connectors are unavailable. Map your CSV columns to our ledger schema and run
            validation before merging.
          </p>
        </header>

        <section className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-xl font-semibold">1. Paste or drop CSV</h2>
          <textarea
            className="mt-3 w-full rounded border border-gray-300 p-3 font-mono text-sm"
            rows={8}
            placeholder="date,description,amount\n2024-01-01,Coffee,-3.50"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <div className="mt-3 flex gap-3">
            <button
              onClick={handleParse}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Parse CSV
            </button>
            <span className="text-sm text-gray-500">{rows.length} rows detected</span>
          </div>
        </section>

        <section className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-xl font-semibold">2. Map columns</h2>
          <p className="text-gray-600">Align your CSV headers to standard fields. Required fields are highlighted.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {availableColumns.map((source) => (
              <div key={source} className="space-y-1 rounded border border-gray-200 p-3">
                <div className="text-sm font-medium">{source}</div>
                <select
                  className="w-full rounded border border-gray-300 p-2"
                  value={mapping[source] || ''}
                  onChange={(e) => handleMappingChange(source, e.target.value)}
                >
                  <option value="">Do not import</option>
                  {STANDARD_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
                {REQUIRED_FIELDS.includes(mapping[source] || '') && (
                  <p className="text-xs text-green-700">Maps to required field</p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-xl font-semibold">3. Validate and merge</h2>
          <p className="text-gray-600">
            We enforce required mappings, validate dates and numeric amounts, and surface a preview of the first few rows before
            merging.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              onClick={handleMerge}
              className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
            >
              Validate &amp; preview merge
            </button>
          </div>
          {validationErrors.length > 0 && (
            <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-semibold">Please fix the following:</p>
              <ul className="list-disc pl-5">
                {validationErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          {mappedPreview.length > 0 && validationErrors.length === 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-700">Preview of mapped rows</p>
              <div className="overflow-auto rounded border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      {STANDARD_FIELDS.filter((f) => Object.values(mapping).includes(f)).map((field) => (
                        <th key={field} className="px-3 py-2 text-left font-semibold text-gray-700">
                          {field}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedPreview.map((row, idx) => (
                      <tr key={`${row.date}-${idx}`} className="odd:bg-white even:bg-gray-50">
                        {STANDARD_FIELDS.filter((f) => Object.values(mapping).includes(f)).map((field) => (
                          <td key={`${field}-${idx}`} className="px-3 py-2 text-gray-800">
                            {row[field] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
