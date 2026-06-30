import type { InvoiceRow } from '../ai/types.js';
import type { InvoiceFieldKey } from '../settings/userSettings.js';
import { buildMappedRow } from './sheetMapping.js';

type SheetWriteOptions = {
  spreadsheetId: string;
  sheetName?: string;
  columnMapping?: Partial<Record<InvoiceFieldKey, string>>;
};

export async function appendRowToGoogleSheet(row: InvoiceRow, options: SheetWriteOptions) {
  const url = process.env.GOOGLE_SCRIPT_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  const { spreadsheetId, sheetName, columnMapping } = options;

  if (!url) {
    throw new Error('GOOGLE_SCRIPT_URL is missing in .env');
  }

  if (!secret) {
    throw new Error('SHEETS_WEBHOOK_SECRET is missing in .env');
  }

  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID is missing in .env');
  }

  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      secret,
      spreadsheetId,
      sheetName,
      row,
      mappedRow: buildMappedRow(row, columnMapping),
      columnMapping,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const text = await response.text();

  let data: { ok?: boolean; error?: string };
  try {
    data = JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    throw new Error(`Apps Script returned non-JSON response: ${text}`);
  }

  if (!data.ok) {
    throw new Error(`Apps Script error: ${data.error || 'unknown error'}`);
  }

  return data;
}
