import type { ExtractedInvoice } from './types.js';

export async function extractWithMock(): Promise<ExtractedInvoice> {
  return {
    is_invoice: true,
    document_type: 'invoice',
    supplier: 'TOO Mock Supplier',
    invoice_date: '2026-06-30',
    invoice_number: 'MOCK-001',
    items: [
      {
        name: 'Metal support',
        quantity: 10,
        unit: 'pcs',
        unit_price: 14500,
        total_price: 145000,
        currency: 'KZT',
      },
      {
        name: 'Cable VVGng 3x2.5',
        quantity: 100,
        unit: 'm',
        unit_price: 420,
        total_price: 42000,
        currency: 'KZT',
      },
    ],
    confidence: 0.99,
    warnings: [],
  };
}
