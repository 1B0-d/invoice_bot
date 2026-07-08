import { getSupabaseAdminClient } from '../lib/supabase.js';
import type { AiProvider, ExtractedInvoice } from '../ai/types.js';

export type DocumentHistoryStatus = 'received' | 'processed' | 'failed';

export type CreateDocumentHistoryInput = {
  telegramUserId: string;
  provider: AiProvider;
  fileName: string;
  mimeType: string;
  storageKey?: string;
  storageUrl?: string;
  status: DocumentHistoryStatus;
  errorMessage?: string;
  extractedInvoice?: ExtractedInvoice;
};

export type UpdateDocumentHistoryInput = {
  status?: DocumentHistoryStatus;
  errorMessage?: string;
  extractedInvoice?: ExtractedInvoice;
  storageKey?: string;
  storageUrl?: string;
};

function getDocumentHistoryTableName() {
  return process.env.SUPABASE_DOCUMENT_HISTORY_TABLE || 'document_history';
}

export async function createDocumentHistoryRecord(input: CreateDocumentHistoryInput) {
  const client = getSupabaseAdminClient();

  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from(getDocumentHistoryTableName())
    .insert({
      telegram_user_id: input.telegramUserId,
      provider: input.provider,
      file_name: input.fileName,
      mime_type: input.mimeType,
      storage_key: input.storageKey || null,
      storage_url: input.storageUrl || null,
      status: input.status,
      error_message: input.errorMessage || null,
      extracted_invoice: input.extractedInvoice || null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Supabase document history insert failed: ${error.message}`);
  }

  return data.id as string;
}

export async function updateDocumentHistoryRecord(
  documentId: string,
  patch: UpdateDocumentHistoryInput
) {
  const client = getSupabaseAdminClient();

  if (!client) {
    return;
  }

  const { error } = await client
    .from(getDocumentHistoryTableName())
    .update({
      status: patch.status,
      error_message: patch.errorMessage || null,
      extracted_invoice: patch.extractedInvoice || null,
      storage_key: patch.storageKey || null,
      storage_url: patch.storageUrl || null,
    })
    .eq('id', documentId);

  if (error) {
    throw new Error(`Supabase document history update failed: ${error.message}`);
  }
}
