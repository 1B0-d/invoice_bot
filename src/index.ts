import 'dotenv/config';
import { Markup, session, Telegraf } from 'telegraf';
import type { Context } from 'telegraf';

import { extractInvoiceFromFile, getAiProvider } from './ai/extractor.js';
import type { AiProvider, AiRuntimeConfig, ExtractedInvoice, InvoiceRow } from './ai/types.js';
import { appendRowToGoogleSheet } from './sheets/googleSheets.js';
import {
  defaultColumnMapping,
  formatColumnMapping,
  parseColumnMappingInput,
} from './sheets/sheetMapping.js';
import { getUserSettings, updateUserSettings } from './settings/userSettings.js';
import type { UserSettings } from './settings/userSettings.js';
import {
  detectMimeType,
  downloadTelegramFile,
  isSupportedInvoiceFile,
} from './telegram/fileDownloader.js';

type AwaitingInputMode =
  | 'sheet_id'
  | 'sheet_name'
  | 'column_mapping'
  | 'gemini_api_key'
  | 'openai_api_key';

type SessionState = {
  awaitingInput: AwaitingInputMode | undefined;
};

type BotContext = Context & {
  session: SessionState;
};

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

if (!telegramToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is missing in .env');
}

const bot = new Telegraf<BotContext>(telegramToken);
bot.use(session({ defaultSession: () => ({ awaitingInput: undefined }) }));

function getUserId(ctx: BotContext) {
  const userId = ctx.from?.id;

  if (!userId) {
    throw new Error('Could not determine Telegram user.');
  }

  return String(userId);
}

function maskSecret(value?: string) {
  if (!value) return 'not set';
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function maskSheetId(value?: string) {
  if (!value) return 'not set';
  if (value.length <= 10) return `${value.slice(0, 3)}***${value.slice(-3)}`;
  return `${value.slice(0, 6)}***${value.slice(-6)}`;
}

function getSheetIdForUser(settings: UserSettings) {
  return settings.googleSheetId;
}

function getSheetNameForUser(settings: UserSettings) {
  return settings.googleSheetName;
}

function getColumnMappingForUser(settings: UserSettings) {
  return settings.columnMapping || defaultColumnMapping;
}

function buildSettingsKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('AI provider', 'settings:provider'),
      Markup.button.callback('Sheet ID', 'settings:sheet'),
    ],
    [
      Markup.button.callback('Sheet name', 'settings:sheet_name'),
      Markup.button.callback('Columns', 'settings:columns'),
    ],
    [Markup.button.callback('Columns help', 'settings:columns_help')],
    [
      Markup.button.callback('Gemini API key', 'settings:gemini_key'),
      Markup.button.callback('OpenAI API key', 'settings:openai_key'),
    ],
    [
      Markup.button.callback('Show settings', 'settings:show'),
      Markup.button.callback('Close', 'settings:close'),
    ],
  ]);
}

function buildProviderKeyboard(currentProvider: AiProvider) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(currentProvider === 'gemini' ? 'Gemini *' : 'Gemini', 'provider:gemini'),
      Markup.button.callback(currentProvider === 'openai' ? 'OpenAI *' : 'OpenAI', 'provider:openai'),
      Markup.button.callback(currentProvider === 'mock' ? 'Mock *' : 'Mock', 'provider:mock'),
    ],
    [
      Markup.button.callback('Back', 'settings:menu'),
      Markup.button.callback('Close', 'settings:close'),
    ],
  ]);
}

async function getRuntimeConfigForUser(userId: string): Promise<AiRuntimeConfig> {
  const settings = await getUserSettings(userId);
  const runtimeConfig: AiRuntimeConfig = {};

  if (settings.provider) runtimeConfig.provider = settings.provider;
  if (settings.geminiApiKey) runtimeConfig.geminiApiKey = settings.geminiApiKey;
  if (settings.openaiApiKey) runtimeConfig.openaiApiKey = settings.openaiApiKey;
  if (process.env.GEMINI_MODEL) runtimeConfig.geminiModel = process.env.GEMINI_MODEL;
  if (process.env.OPENAI_MODEL) runtimeConfig.openaiModel = process.env.OPENAI_MODEL;

  return runtimeConfig;
}

async function buildSettingsSummary(userId: string) {
  const settings = await getUserSettings(userId);
  const provider = settings.provider || getAiProvider();

  return (
    `Current settings:\n` +
    `AI provider: ${provider}\n` +
    `Gemini key: ${maskSecret(settings.geminiApiKey)}\n` +
    `OpenAI key: ${maskSecret(settings.openaiApiKey)}\n` +
    `Google Sheet ID: ${maskSheetId(getSheetIdForUser(settings))}\n` +
    `Sheet name: ${getSheetNameForUser(settings) || 'not set'}\n` +
    `Columns:\n${formatColumnMapping(settings.columnMapping)}`
  );
}

function getProviderSetupError(provider: AiProvider, settings: UserSettings) {
  if (provider === 'gemini' && !settings.geminiApiKey) {
    return 'For Gemini, first set your Gemini API key in /settings.';
  }

  if (provider === 'openai' && !settings.openaiApiKey) {
    return 'For OpenAI, first set your OpenAI API key in /settings.';
  }

  return null;
}

async function showSettingsMenu(ctx: BotContext, text?: string) {
  ctx.session.awaitingInput = undefined;
  const message = text || (await buildSettingsSummary(getUserId(ctx)));
  await ctx.reply(`${message}\n\nChoose what you want to configure:`, buildSettingsKeyboard());
}

async function promptForInput(ctx: BotContext, mode: AwaitingInputMode, prompt: string) {
  ctx.session.awaitingInput = mode;
  await ctx.reply(`${prompt}\n\nYou can type "back" or /cancel.`);
}

function getColumnMappingHelpText() {
  return (
    `How column mapping works:\n\n` +
    `On the left is the bot field, on the right is the Google Sheets column letter.\n` +
    `Example: supplier=C means "write supplier to column C".\n\n` +
    `Available fields:\n` +
    `uploaded_at\ninvoice_date\nsupplier\nitem\nquantity\nunit\nunit_price\ntotal_price\ncurrency\ninvoice_number\nsource\n\n` +
    `Example mapping:\n` +
    `uploaded_at=A\ninvoice_date=B\nsupplier=C\nitem=D\nquantity=E\nunit=F\nunit_price=G\ntotal_price=H\ncurrency=I\ninvoice_number=J\nsource=K\n\n` +
    `You can specify only the fields you want to remap. The rest stay on defaults.`
  );
}

function buildSheetWriteOptions(settings: UserSettings) {
  const spreadsheetId = getSheetIdForUser(settings);

  if (!spreadsheetId) {
    throw new Error('First set Google Sheet ID in /settings.');
  }

  const options = {
    spreadsheetId,
    columnMapping: getColumnMappingForUser(settings),
  };

  const sheetName = getSheetNameForUser(settings);

  if (!sheetName) {
    return options;
  }

  return {
    ...options,
    sheetName,
  };
}

function validateInvoiceForWrite(invoice: ExtractedInvoice) {
  const errors: string[] = [];

  if (!invoice.supplier.trim()) errors.push('Supplier was not detected');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoice_date)) {
    errors.push('Invoice date is missing or has invalid format');
  }
  if (!invoice.items.length) errors.push('No line items were detected');

  for (const item of invoice.items) {
    if (!item.name.trim()) errors.push('One of the items has no name');
    if (item.quantity <= 0) errors.push(`Invalid quantity for item: ${item.name || 'unnamed item'}`);
    if (item.unit_price <= 0) errors.push(`Invalid unit price for item: ${item.name || 'unnamed item'}`);
    if (item.total_price <= 0) errors.push(`Invalid total price for item: ${item.name || 'unnamed item'}`);
  }

  return errors;
}

async function writeInvoiceRows(
  items: ExtractedInvoice['items'],
  invoice: ExtractedInvoice,
  filename: string,
  settings: UserSettings
) {
  const sheetOptions = buildSheetWriteOptions(settings);

  for (const item of items) {
    const row: InvoiceRow = {
      uploaded_at: new Date().toISOString(),
      invoice_date: invoice.invoice_date,
      supplier: invoice.supplier,
      item: item.name,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      total_price: item.total_price,
      currency: item.currency,
      invoice_number: invoice.invoice_number,
      source: filename,
    };

    await appendRowToGoogleSheet(row, sheetOptions);
  }
}

async function processInvoiceFile(ctx: BotContext, fileId: string, filename: string, mimeType: string) {
  const userId = getUserId(ctx);
  const settings = await getUserSettings(userId);
  const runtimeConfig = await getRuntimeConfigForUser(userId);
  const provider = getAiProvider(runtimeConfig);
  const spreadsheetId = getSheetIdForUser(settings);
  const sheetName = getSheetNameForUser(settings);

  if (!spreadsheetId) {
    await ctx.reply('First open /settings and set Google Sheet ID.');
    return;
  }

  const providerSetupError = getProviderSetupError(provider, settings);

  if (providerSetupError) {
    await ctx.reply(providerSetupError);
    return;
  }

  await ctx.reply(`File received. Downloading and processing with ${provider}...`);

  const filePath = await downloadTelegramFile(bot, fileId, filename);
  let invoice: ExtractedInvoice;

  try {
    invoice = await extractInvoiceFromFile(filePath, filename, mimeType, runtimeConfig);
  } catch (error) {
    const message = String(error);

    if (message.includes('not configured for this user')) {
      await ctx.reply(providerSetupError || 'First set your API key in /settings.');
      return;
    }

    if (message.includes('"status":"UNAVAILABLE"') || message.includes('high demand')) {
      await ctx.reply(
        `The ${provider} service is temporarily overloaded. Try again later or switch AI provider in /settings.`
      );
      return;
    }

    throw error;
  }

  if (!invoice.is_invoice) {
    await ctx.reply(
      `This does not look like an invoice.\n` +
        `Document type: ${invoice.document_type || 'unknown'}\n` +
        `Nothing was written to Google Sheets.`
    );
    return;
  }

  if (invoice.confidence < 0.6) {
    await ctx.reply(
      `The document was recognized with low confidence.\n` +
        `Confidence: ${invoice.confidence}\n` +
        `Nothing was written to Google Sheets.`
    );
    return;
  }

  const validationErrors = validateInvoiceForWrite(invoice);

  if (validationErrors.length > 0) {
    await ctx.reply(
      `I found invoice-like data, but it is not safe to write yet.\n` +
        `${validationErrors.map((error) => `- ${error}`).join('\n')}`
    );
    return;
  }

  await writeInvoiceRows(invoice.items, invoice, filename, settings);

  const preview = invoice.items
    .slice(0, 5)
    .map((item) => `- ${item.name}: ${item.quantity} ${item.unit} x ${item.unit_price} ${item.currency}`)
    .join('\n');

  await ctx.reply(
    `Done. Rows added to Google Sheets: ${invoice.items.length}\n\n` +
      `Provider: ${provider}\n` +
      `Supplier: ${invoice.supplier}\n` +
      `Date: ${invoice.invoice_date}\n` +
      `Invoice: ${invoice.invoice_number}\n` +
      `Sheet ID: ${maskSheetId(spreadsheetId)}\n` +
      `Sheet name: ${sheetName || 'default'}\n\n` +
      `${preview}` +
      (invoice.warnings.length
        ? `\n\nWarnings:\n${invoice.warnings.map((item) => `- ${item}`).join('\n')}`
        : '')
  );
}

async function handleTextInput(ctx: BotContext) {
  if (!ctx.message || !('text' in ctx.message)) return false;

  const mode = ctx.session.awaitingInput;
  if (!mode) return false;

  const rawText = ctx.message.text.trim();

  if (!rawText) {
    await ctx.reply('Empty value is not allowed. Try again or type "back".');
    return true;
  }

  if (rawText.toLowerCase() === 'back' || rawText.toLowerCase() === 'назад' || rawText === '/cancel') {
    await showSettingsMenu(ctx, 'Configuration canceled.');
    return true;
  }

  const userId = getUserId(ctx);

  if (mode === 'sheet_id') {
    await updateUserSettings(userId, { googleSheetId: rawText });
    await showSettingsMenu(ctx, 'Google Sheet ID saved.');
    return true;
  }

  if (mode === 'sheet_name') {
    await updateUserSettings(userId, { googleSheetName: rawText });
    await showSettingsMenu(ctx, 'Sheet name saved.');
    return true;
  }

  if (mode === 'column_mapping') {
    try {
      const columnMapping = parseColumnMappingInput(rawText);
      await updateUserSettings(userId, { columnMapping });
      await showSettingsMenu(ctx, 'Column mapping saved.');
    } catch (error) {
      await ctx.reply(
        `Could not parse mapping: ${String(error)}\n\n` +
          `Example:\n` +
          `supplier=C\ninvoice_date=B\nitem=F`
      );
    }
    return true;
  }

  if (mode === 'gemini_api_key') {
    await updateUserSettings(userId, { geminiApiKey: rawText });
    await showSettingsMenu(ctx, 'Gemini API key saved.');
    return true;
  }

  await updateUserSettings(userId, { openaiApiKey: rawText });
  await showSettingsMenu(ctx, 'OpenAI API key saved.');
  return true;
}

bot.start(async (ctx) => {
  await ctx.reply(
    'Send PDF, JPG, or PNG with an invoice. I will extract line items and write them to Google Sheets.\n\nOpen /settings for personal configuration.'
  );
});

bot.command('settings', async (ctx) => {
  await showSettingsMenu(ctx);
});

bot.command('cancel', async (ctx) => {
  if (!ctx.session.awaitingInput) {
    await ctx.reply('There is nothing to cancel right now.');
    return;
  }

  await showSettingsMenu(ctx, 'Action canceled.');
});

bot.command('status', async (ctx) => {
  const userId = getUserId(ctx);
  const runtimeConfig = await getRuntimeConfigForUser(userId);
  const settings = await getUserSettings(userId);

  await ctx.reply(
    `Bot is running.\n` +
      `AI provider: ${getAiProvider(runtimeConfig)}\n` +
      `Google Sheet ID: ${maskSheetId(getSheetIdForUser(settings))}\n` +
      `Sheet name: ${getSheetNameForUser(settings) || 'not set'}`
  );
});

bot.command('provider', async (ctx) => {
  const runtimeConfig = await getRuntimeConfigForUser(getUserId(ctx));
  await ctx.reply(`Current AI provider: ${getAiProvider(runtimeConfig)}`);
});

bot.command('test', async (ctx) => {
  try {
    const settings = await getUserSettings(getUserId(ctx));

    if (!getSheetIdForUser(settings)) {
      await ctx.reply('First open /settings and set Google Sheet ID.');
      return;
    }

    await appendRowToGoogleSheet(
      {
        uploaded_at: new Date().toISOString(),
        invoice_date: '2026-05-12',
        supplier: 'TOO Test Supplier',
        item: 'Metal support',
        quantity: 10,
        unit: 'pcs',
        unit_price: 14500,
        total_price: 145000,
        currency: 'KZT',
        invoice_number: 'TEST-001',
        source: 'manual-test',
      },
      buildSheetWriteOptions(settings)
    );

    await ctx.reply('Test row was added to Google Sheets.');
  } catch (err) {
    console.error(err);
    await ctx.reply(`Failed to write to Google Sheets: ${String(err)}`);
  }
});

bot.action('settings:menu', async (ctx) => {
  await ctx.answerCbQuery();
  await showSettingsMenu(ctx);
});

bot.action('settings:provider', async (ctx) => {
  await ctx.answerCbQuery();
  const runtimeConfig = await getRuntimeConfigForUser(getUserId(ctx));
  await ctx.reply('Choose AI provider:', buildProviderKeyboard(getAiProvider(runtimeConfig)));
});

bot.action('settings:sheet', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(ctx, 'sheet_id', 'Send Google Sheet ID.');
});

bot.action('settings:sheet_name', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(ctx, 'sheet_name', 'Send sheet name inside the spreadsheet. Example: Invoices');
});

bot.action('settings:columns', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(getColumnMappingHelpText());
  await promptForInput(
    ctx,
    'column_mapping',
    'Now send your column mapping in the format field=column.\n\nExample:\nuploaded_at=A\ninvoice_date=B\nsupplier=C\nitem=D\nquantity=E'
  );
});

bot.action('settings:columns_help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(getColumnMappingHelpText());
});

bot.action('settings:gemini_key', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(ctx, 'gemini_api_key', 'Send your Gemini API key.');
});

bot.action('settings:openai_key', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(ctx, 'openai_api_key', 'Send your OpenAI API key.');
});

bot.action('settings:show', async (ctx) => {
  await ctx.answerCbQuery();
  await showSettingsMenu(ctx, await buildSettingsSummary(getUserId(ctx)));
});

bot.action('settings:close', async (ctx) => {
  await ctx.answerCbQuery('Menu closed');
  ctx.session.awaitingInput = undefined;
  await ctx.reply('Okay, settings menu closed.');
});

bot.action(/provider:(gemini|openai|mock)/, async (ctx) => {
  await ctx.answerCbQuery();
  const provider = ctx.match[1] as AiProvider;
  await updateUserSettings(getUserId(ctx), { provider });
  await showSettingsMenu(ctx, `Provider switched to ${provider}.`);
});

bot.on('text', async (ctx, next) => {
  const handled = await handleTextInput(ctx);
  if (!handled) await next();
});

bot.on('document', async (ctx) => {
  try {
    const document = ctx.message.document;
    const filename = document.file_name ?? `telegram_document_${document.file_id}`;
    const mimeType = detectMimeType(filename, document.mime_type);

    if (!isSupportedInvoiceFile(filename, mimeType)) {
      await ctx.reply(
        `This file type is not supported.\n\n` +
          `File: ${filename}\n` +
          `Type: ${mimeType}\n\n` +
          `Send only PDF, JPG, or PNG.`
      );
      return;
    }

    await processInvoiceFile(ctx, document.file_id, filename, mimeType);
  } catch (err) {
    console.error(err);
    await ctx.reply(`Document processing error: ${String(err)}`);
  }
});

bot.on('photo', async (ctx) => {
  try {
    const photos = ctx.message.photo;
    const biggestPhoto = photos[photos.length - 1];

    if (!biggestPhoto) {
      await ctx.reply('Photo was not found in the message.');
      return;
    }

    const filename = `telegram_photo_${biggestPhoto.file_id}.jpg`;
    await processInvoiceFile(ctx, biggestPhoto.file_id, filename, 'image/jpeg');
  } catch (err) {
    console.error(err);
    await ctx.reply(`Photo processing error: ${String(err)}`);
  }
});

console.log(`Invoice bot started with default AI provider: ${getAiProvider()}`);

await bot.telegram.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'settings', description: 'Configure AI and spreadsheet' },
  { command: 'status', description: 'Check current settings' },
  { command: 'provider', description: 'Show current AI provider' },
  { command: 'test', description: 'Test writing to spreadsheet' },
]);

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
