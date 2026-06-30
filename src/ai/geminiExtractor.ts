import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';

import { invoiceExtractionPrompt, invoiceJsonSchema } from './invoiceContract.js';
import type { AiRuntimeConfig, ExtractedInvoice } from './types.js';

export async function extractWithGemini(
  filePath: string,
  _filename: string,
  mimeType: string,
  runtimeConfig: AiRuntimeConfig = {}
): Promise<ExtractedInvoice> {
  const apiKey = runtimeConfig.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing in .env');
  }

  const gemini = new GoogleGenAI({ apiKey });
  const fileBuffer = await readFile(filePath);
  const base64 = fileBuffer.toString('base64');

  const response = await gemini.models.generateContent({
    model: runtimeConfig.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64,
            },
          },
          {
            text: invoiceExtractionPrompt,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: invoiceJsonSchema as never,
    },
  });

  const raw = response.text;

  if (!raw) {
    throw new Error('Gemini returned empty output');
  }

  return JSON.parse(raw) as ExtractedInvoice;
}
