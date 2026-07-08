import type { InvoiceRow } from '../ai/types.js';
import type { InvoiceFieldKey } from '../settings/userSettings.js';

export const invoiceFieldOrder: InvoiceFieldKey[] = [
  'uploaded_at',
  'invoice_date',
  'supplier',
  'item',
  'quantity',
  'unit',
  'unit_price',
  'total_price',
  'currency',
  'invoice_number',
  'source',
];

export const defaultColumnMapping: Record<InvoiceFieldKey, string> = {
  uploaded_at: 'A',
  invoice_date: 'B',
  supplier: 'C',
  item: 'D',
  quantity: 'E',
  unit: 'F',
  unit_price: 'G',
  total_price: 'H',
  currency: 'I',
  invoice_number: 'J',
  source: 'K',
};

export function normalizeColumnLetter(value: string) {
  return value.trim().toUpperCase();
}

export function isValidInvoiceFieldKey(value: string): value is InvoiceFieldKey {
  return invoiceFieldOrder.includes(value as InvoiceFieldKey);
}

export function isValidColumnLetter(value: string) {
  return /^[A-Z]+$/.test(normalizeColumnLetter(value));
}

export function mergeColumnMapping(
  mapping?: Partial<Record<InvoiceFieldKey, string>>
): Record<InvoiceFieldKey, string> {
  return {
    ...defaultColumnMapping,
    ...mapping,
  };
}

export function formatColumnMapping(mapping?: Partial<Record<InvoiceFieldKey, string>>) {
  const merged = mergeColumnMapping(mapping);
  return invoiceFieldOrder.map((field) => `${field}=${merged[field]}`).join('\n');
}

export function buildMappedRow(
  row: InvoiceRow,
  mapping?: Partial<Record<InvoiceFieldKey, string>>
): Record<string, string | number> {
  const merged = mergeColumnMapping(mapping);
  const mappedRow: Record<string, string | number> = {};

  for (const field of invoiceFieldOrder) {
    mappedRow[merged[field]] = row[field];
  }

  return mappedRow;
}

export function parseColumnMappingInput(input: string) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error('Empty mapping. Send lines in the format supplier=C');
  }

  const mapping: Partial<Record<InvoiceFieldKey, string>> = {};

  for (const line of lines) {
    const [rawField, rawColumn] = line.split('=').map((part) => part?.trim());

    if (!rawField || !rawColumn) {
      throw new Error(`Invalid line format: ${line}`);
    }

    if (!isValidInvoiceFieldKey(rawField)) {
      throw new Error(`Unknown field: ${rawField}`);
    }

    if (!isValidColumnLetter(rawColumn)) {
      throw new Error(`Invalid column for ${rawField}: ${rawColumn}`);
    }

    mapping[rawField] = normalizeColumnLetter(rawColumn);
  }

  return mapping;
}
