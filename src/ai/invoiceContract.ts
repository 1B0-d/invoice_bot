export const invoiceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_invoice',
    'document_type',
    'supplier',
    'invoice_date',
    'invoice_number',
    'items',
    'confidence',
    'warnings',
  ],
  properties: {
    is_invoice: { type: 'boolean' },
    document_type: { type: 'string' },
    supplier: { type: 'string' },
    invoice_date: { type: 'string' },
    invoice_number: { type: 'string' },
    confidence: { type: 'number' },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unit', 'unit_price', 'total_price', 'currency'],
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          unit_price: { type: 'number' },
          total_price: { type: 'number' },
          currency: { type: 'string' },
        },
      },
    },
  },
} as const;

export const invoiceExtractionPrompt =
  'Сначала определи, является ли файл счетом, накладной, чеком, актом поставки или коммерческим документом с позициями и ценами. ' +
  'Если это НЕ такой документ, верни is_invoice=false, document_type с предполагаемым типом, supplier="", invoice_date="", invoice_number="", items=[], confidence=0 и добавь предупреждение в warnings. ' +
  'Если это счет или закупочный документ, верни is_invoice=true и извлеки данные по документу. ' +
  'Верни только валидный JSON, без markdown и пояснений. ' +
  'Дата должна быть в формате YYYY-MM-DD. Количество и цены должны быть числами. ' +
  'Если используется тенге, указывай currency как KZT. ' +
  'Если поле отсутствует, используй пустую строку или 0 и добавь предупреждение. ' +
  'Каждая строка документа должна быть отдельным item. ' +
  'Используй такую структуру JSON: ' +
  JSON.stringify({
    is_invoice: true,
    document_type: 'invoice',
    supplier: 'string',
    invoice_date: 'YYYY-MM-DD',
    invoice_number: 'string',
    items: [
      {
        name: 'string',
        quantity: 0,
        unit: 'string',
        unit_price: 0,
        total_price: 0,
        currency: 'KZT',
      },
    ],
    confidence: 0.9,
    warnings: ['string'],
  });
