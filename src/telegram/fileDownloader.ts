import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { uploadOriginalFileToR2 } from '../storage/r2.js';

type TelegramFileClient = {
  telegram: {
    getFileLink(fileId: string): Promise<URL>;
  };
};

export type DownloadedTelegramFile = {
  filePath: string;
  storageKey?: string;
  storageUrl?: string;
};

export function sanitizeFilename(filename: string) {
  return filename.replace(/[^\w.\-а-яА-ЯёЁ]/g, '_');
}

export async function downloadTelegramFile(
  bot: TelegramFileClient,
  fileId: string,
  originalName: string,
  userId: string,
  mimeType: string
) {
  const tempDir = path.join(os.tmpdir(), 'invoice-bot');
  await mkdir(tempDir, { recursive: true });

  const fileUrl = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileUrl.href);

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeName = sanitizeFilename(originalName);
  const filePath = path.join(tempDir, `${randomUUID()}_${safeName}`);

  await writeFile(filePath, buffer);

  let uploadResult: Awaited<ReturnType<typeof uploadOriginalFileToR2>> | null = null;

  try {
    uploadResult = await uploadOriginalFileToR2({
      buffer,
      contentType: mimeType,
      fileName: safeName,
      userId,
    });
  } catch (error) {
    console.error('R2 upload failed, continuing without archive copy:', error);
  }

  return {
    filePath,
    ...(uploadResult?.key ? { storageKey: uploadResult.key } : {}),
    ...(uploadResult?.url ? { storageUrl: uploadResult.url } : {}),
  } satisfies DownloadedTelegramFile;
}

export async function cleanupDownloadedTelegramFile(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

export function detectMimeType(filename: string, fallback?: string) {
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (fallback) return fallback;

  return 'application/octet-stream';
}

export function isSupportedInvoiceFile(filename: string, mimeType: string) {
  const ext = path.extname(filename).toLowerCase();
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
  const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];

  return allowedExtensions.includes(ext) && allowedMimeTypes.includes(mimeType);
}
