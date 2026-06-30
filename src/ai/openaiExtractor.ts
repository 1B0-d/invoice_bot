import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';

import { invoiceExtractionPrompt, invoiceJsonSchema } from './invoiceContract.js';
import type { AiRuntimeConfig, ExtractedInvoice } from './types.js';

export async function extractWithOpenAI(
  filePath: string,
  filename: string,
  mimeType: string,
  runtimeConfig: AiRuntimeConfig = {}
): Promise<ExtractedInvoice> {
  const apiKey = runtimeConfig.openaiApiKey || process.env.OPENAI_API_KEY;
  const model = runtimeConfig.openaiModel || process.env.OPENAI_MODEL || 'gpt-5.2';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing in .env');
  }

  const client = new OpenAI({ apiKey });
  const fileBuffer = await readFile(filePath);
  const base64 = fileBuffer.toString('base64');

  const content =
    mimeType === 'application/pdf'
      ? [
          {
            type: 'input_file' as const,
            filename,
            file_data: base64,
            detail: 'high' as const,
          },
        ]
      : [
          {
            type: 'input_image' as const,
            image_url: `data:${mimeType};base64,${base64}`,
            detail: 'high' as const,
          },
        ];

  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: invoiceExtractionPrompt,
          },
          ...content,
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'invoice_extraction',
        strict: true,
        schema: invoiceJsonSchema,
      },
      verbosity: 'low',
    },
  });

  const raw = response.output_text;

  if (!raw) {
    throw new Error('OpenAI returned empty output');
  }

  return JSON.parse(raw) as ExtractedInvoice;
}
