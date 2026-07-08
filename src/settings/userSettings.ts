import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AiProvider } from '../ai/types.js';
import { getSupabaseAdminClient } from '../lib/supabase.js';

export type BotLanguage = 'ru' | 'kk' | 'en';

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
  language?: BotLanguage;
  geminiApiKey?: string;
  openaiApiKey?: string;
  googleSheetId?: string;
  googleSheetName?: string;
  columnMapping?: Partial<Record<InvoiceFieldKey, string>>;
};

type SettingsStore = Record<string, UserSettings>;

const settingsDir = path.join(process.cwd(), 'data');
const settingsFilePath = path.join(settingsDir, 'user-settings.json');

function getUserSettingsTableName() {
  return process.env.SUPABASE_USER_SETTINGS_TABLE || 'user_settings';
}

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
  const client = getSupabaseAdminClient();

  if (client) {
    const { data, error } = await client
      .from(getUserSettingsTableName())
      .select(
        'provider, language, gemini_api_key, openai_api_key, google_sheet_id, google_sheet_name, column_mapping'
      )
      .eq('telegram_user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase user settings read failed: ${error.message}`);
    }

    if (!data) {
      return {};
    }

    const settings: UserSettings = {};

    if (data.language) settings.language = data.language as BotLanguage;
    if (data.provider) settings.provider = data.provider;
    if (data.gemini_api_key) settings.geminiApiKey = data.gemini_api_key;
    if (data.openai_api_key) settings.openaiApiKey = data.openai_api_key;
    if (data.google_sheet_id) settings.googleSheetId = data.google_sheet_id;
    if (data.google_sheet_name) settings.googleSheetName = data.google_sheet_name;
    if (data.column_mapping) {
      settings.columnMapping = data.column_mapping as Partial<Record<InvoiceFieldKey, string>>;
    }

    return settings;
  }

  const store = await readStore();
  return store[userId] ?? {};
}

export async function updateUserSettings(
  userId: string,
  patch: Partial<UserSettings>
): Promise<UserSettings> {
  const client = getSupabaseAdminClient();

  if (client) {
    const current = await getUserSettings(userId);
    const next = { ...current, ...patch };

    const { error } = await client.from(getUserSettingsTableName()).upsert(
      {
        telegram_user_id: userId,
        provider: next.provider ?? null,
        language: next.language ?? null,
        gemini_api_key: next.geminiApiKey ?? null,
        openai_api_key: next.openaiApiKey ?? null,
        google_sheet_id: next.googleSheetId ?? null,
        google_sheet_name: next.googleSheetName ?? null,
        column_mapping: next.columnMapping ?? null,
      },
      {
        onConflict: 'telegram_user_id',
      }
    );

    if (error) {
      throw new Error(`Supabase user settings write failed: ${error.message}`);
    }

    return next;
  }

  const store = await readStore();
  const current = store[userId] ?? {};
  const next = { ...current, ...patch };

  store[userId] = next;
  await writeStore(store);

  return next;
}
