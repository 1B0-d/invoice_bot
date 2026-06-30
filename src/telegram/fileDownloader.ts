import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type TelegramFileClient = {
  telegram: {
    getFileLink(fileId: string): Promise<URL>;
  };
};

export function sanitizeFilename(filename: string) {
  return filename.replace(/[^\w.\-а-яА-ЯёЁ]/g, '_');
}

export async function downloadTelegramFile(
  bot: TelegramFileClient,
  fileId: string,
  originalName: string
) {
  await mkdir('uploads', { recursive: true });

  const fileUrl = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileUrl.href);

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeName = sanitizeFilename(originalName);
  const filePath = path.join('uploads', `${randomUUID()}_${safeName}`);

  await writeFile(filePath, buffer);

  return filePath;
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
