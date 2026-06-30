export type InvoiceRow = {
  uploaded_at: string;
  invoice_date: string;
  supplier: string;
  item: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  currency: string;
  invoice_number: string;
  source: string;
};

export type ExtractedInvoiceItem = {
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  currency: string;
};

export type ExtractedInvoice = {
  is_invoice: boolean;
  document_type: string;
  supplier: string;
  invoice_date: string;
  invoice_number: string;
  items: ExtractedInvoiceItem[];
  confidence: number;
  warnings: string[];
};

export type AiProvider = 'gemini' | 'openai' | 'mock';

export type AiRuntimeConfig = {
  provider?: AiProvider | undefined;
  geminiApiKey?: string | undefined;
  geminiModel?: string | undefined;
  openaiApiKey?: string | undefined;
  openaiModel?: string | undefined;
};
