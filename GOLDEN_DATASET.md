# Golden Dataset for Testing

## Overview

The golden dataset contains known sample documents with expected extraction and classification results. This is used for regression testing of OCR and classification accuracy.

## Dataset Structure

```
golden-dataset/
  invoices/
    invoice-001.pdf - Expected: vendor, date, total, tax
    invoice-002.jpg - Expected: vendor, date, total, tax
  receipts/
    receipt-001.pdf - Expected: vendor, date, total
    receipt-002.jpg - Expected: vendor, date, total
  statements/
    statement-001.pdf - Expected: account, period, balance
```

## Expected Results

Each document has a corresponding JSON file with expected extraction results:

```json
{
  "documentType": "invoice",
  "vendor": "Acme Corp",
  "date": "2024-01-15",
  "total": 1000.00,
  "tax": 200.00,
  "taxRate": 0.20,
  "currency": "GBP",
  "confidenceScore": 0.95
}
```

## Usage

```bash
# Run golden dataset tests
npm run test:golden

# Update golden dataset
npm run test:golden -- --update
```

## Adding New Documents

1. Add document to appropriate folder
2. Create expected results JSON file
3. Run tests to verify
4. Commit both document and expected results

## Accuracy Targets

- OCR accuracy: > 95%
- Classification accuracy: > 90%
- Data extraction accuracy: > 85%
