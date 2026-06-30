import { extractWithGemini } from './geminiExtractor.js';
import { extractWithMock } from './mockExtractor.js';
import { extractWithOpenAI } from './openaiExtractor.js';
import type { AiProvider, AiRuntimeConfig, ExtractedInvoice } from './types.js';

export function getAiProvider(runtimeConfig: AiRuntimeConfig = {}): AiProvider {
  const provider = (runtimeConfig.provider || process.env.AI_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'gemini' || provider === 'openai' || provider === 'mock') {
    return provider;
  }

  throw new Error(`Unknown AI_PROVIDER: ${provider}`);
}

export async function extractInvoiceFromFile(
  filePath: string,
  filename: string,
  mimeType: string,
  runtimeConfig: AiRuntimeConfig = {}
): Promise<ExtractedInvoice> {
  const provider = getAiProvider(runtimeConfig);

  if (provider === 'gemini') {
    return extractWithGemini(filePath, filename, mimeType, runtimeConfig);
  }

  if (provider === 'openai') {
    return extractWithOpenAI(filePath, filename, mimeType, runtimeConfig);
  }

  return extractWithMock();
}
