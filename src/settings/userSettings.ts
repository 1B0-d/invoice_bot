import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AiProvider } from '../ai/types.js';

export type InvoiceFieldKey =
  | 'uploaded_at'
  | 'invoice_date'
  | 'supplier'
  | 'item'
  | 'quantity'
  | 'unit'
  | 'unit_price'
  | 'total_price'
  | 'currency'
  | 'invoice_number'
  | 'source';

export type UserSettings = {
  provider?: AiProvider;
  geminiApiKey?: string;
  openaiApiKey?: string;
  googleSheetId?: string;
  googleSheetName?: string;
  columnMapping?: Partial<Record<InvoiceFieldKey, string>>;
};

type SettingsStore = Record<string, UserSettings>;

const settingsDir = path.join(process.cwd(), 'data');
const settingsFilePath = path.join(settingsDir, 'user-settings.json');

async function readStore(): Promise<SettingsStore> {
  try {
    const raw = await readFile(settingsFilePath, 'utf8');
    return JSON.parse(raw) as SettingsStore;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function writeStore(store: SettingsStore) {
  await mkdir(settingsDir, { recursive: true });
  await writeFile(settingsFilePath, JSON.stringify(store, null, 2), 'utf8');
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const store = await readStore();
  return store[userId] ?? {};
}

export async function updateUserSettings(
  userId: string,
  patch: Partial<UserSettings>
): Promise<UserSettings> {
  const store = await readStore();
  const current = store[userId] ?? {};
  const next = { ...current, ...patch };

  store[userId] = next;
  await writeStore(store);

  return next;
}
