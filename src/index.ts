import 'dotenv/config';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Markup, session, Telegraf } from 'telegraf';
import type { Context } from 'telegraf';

import { extractInvoiceFromFile, getAiProvider } from './ai/extractor.js';
import type { AiProvider, AiRuntimeConfig, ExtractedInvoice, InvoiceRow } from './ai/types.js';
import {
  createDocumentHistoryRecord,
  updateDocumentHistoryRecord,
} from './history/documentHistory.js';
import { appendRowToGoogleSheet } from './sheets/googleSheets.js';
import { defaultColumnMapping, parseColumnMappingInput } from './sheets/sheetMapping.js';
import { getUserSettings, updateUserSettings } from './settings/userSettings.js';
import type { BotLanguage, UserSettings } from './settings/userSettings.js';
import {
  cleanupDownloadedTelegramFile,
  detectMimeType,
  downloadTelegramFile,
  isSupportedInvoiceFile,
} from './telegram/fileDownloader.js';
import {
  formatColumnMappingLocalized,
  getColumnMappingHelpText,
  getDictionary,
  getFallbackLanguage,
  getLanguageButtonLabel,
  getLanguageMenuText,
  getProviderButtonLabel,
  isBackWord,
  languageLabels,
  normalizeLanguage,
  resolveLanguage,
} from './i18n.js';

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

const webhookPath = process.env.WEBHOOK_PATH || '/telegram/webhook';
const webhookSecretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
const webhookDomain = process.env.WEBHOOK_DOMAIN || process.env.RENDER_EXTERNAL_URL;
const serverHost = process.env.HOST || '0.0.0.0';
const serverPort = Number(process.env.PORT || 3000);

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

function getUserLanguageFromSettings(settings?: UserSettings, telegramLanguageCode?: string): BotLanguage {
  return resolveLanguage(settings, telegramLanguageCode);
}

async function getUserLanguage(ctx: BotContext, settings?: UserSettings) {
  return getUserLanguageFromSettings(settings, ctx.from?.language_code);
}

function buildSettingsKeyboard(language: BotLanguage) {
  const t = getDictionary(language);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t.languageButton, 'settings:language'),
      Markup.button.callback(t.aiProviderButton, 'settings:provider'),
    ],
    [
      Markup.button.callback(t.sheetIdButton, 'settings:sheet'),
      Markup.button.callback(t.sheetNameButton, 'settings:sheet_name'),
    ],
    [
      Markup.button.callback(t.columnsButton, 'settings:columns'),
      Markup.button.callback(t.columnsHelpButton, 'settings:columns_help'),
    ],
    [
      Markup.button.callback(t.geminiKeyButton, 'settings:gemini_key'),
      Markup.button.callback(t.openaiKeyButton, 'settings:openai_key'),
    ],
    [
      Markup.button.callback(t.showSettingsButton, 'settings:show'),
      Markup.button.callback(t.closeButton, 'settings:close'),
    ],
  ]);
}

function buildProviderKeyboard(currentProvider: AiProvider, language: BotLanguage) {
  const t = getDictionary(language);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(getProviderButtonLabel('gemini', currentProvider), 'provider:gemini'),
      Markup.button.callback(getProviderButtonLabel('openai', currentProvider), 'provider:openai'),
      Markup.button.callback(getProviderButtonLabel('mock', currentProvider), 'provider:mock'),
    ],
    [
      Markup.button.callback(t.backButton, 'settings:menu'),
      Markup.button.callback(t.closeButton, 'settings:close'),
    ],
  ]);
}

function buildLanguageKeyboard(currentLanguage: BotLanguage) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(getLanguageButtonLabel('ru') + (currentLanguage === 'ru' ? ' *' : ''), 'language:ru'),
      Markup.button.callback(getLanguageButtonLabel('kk') + (currentLanguage === 'kk' ? ' *' : ''), 'language:kk'),
      Markup.button.callback(getLanguageButtonLabel('en') + (currentLanguage === 'en' ? ' *' : ''), 'language:en'),
    ],
    [
      Markup.button.callback(getDictionary(currentLanguage).backButton, 'settings:menu'),
      Markup.button.callback(getDictionary(currentLanguage).closeButton, 'settings:close'),
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

async function buildSettingsSummary(userId: string, telegramLanguageCode?: string) {
  const settings = await getUserSettings(userId);
  const language = getUserLanguageFromSettings(settings, telegramLanguageCode);
  const t = getDictionary(language);
  const provider = settings.provider || getAiProvider();

  return (
    `${t.currentSettings}:\n` +
    `${t.languageLabel}: ${languageLabels[language]}\n` +
    `${t.aiProviderLabel}: ${provider}\n` +
    `${t.geminiKeyLabel}: ${maskSecret(settings.geminiApiKey)}\n` +
    `${t.openaiKeyLabel}: ${maskSecret(settings.openaiApiKey)}\n` +
    `${t.googleSheetIdLabel}: ${maskSheetId(getSheetIdForUser(settings))}\n` +
    `${t.sheetNameLabel}: ${getSheetNameForUser(settings) || t.notSet}\n` +
    `${t.columnsLabel}:\n${formatColumnMappingLocalized(settings.columnMapping, language)}`
  );
}

function getProviderSetupError(provider: AiProvider, settings: UserSettings, language: BotLanguage) {
  const t = getDictionary(language);

  if (provider === 'gemini' && !settings.geminiApiKey) {
    return t.setGeminiKeyFirst;
  }

  if (provider === 'openai' && !settings.openaiApiKey) {
    return t.setOpenAiKeyFirst;
  }

  return null;
}

async function showSettingsMenu(ctx: BotContext, text?: string) {
  ctx.session.awaitingInput = undefined;
  const userId = getUserId(ctx);
  const settings = await getUserSettings(userId);
  const language = await getUserLanguage(ctx, settings);
  const t = getDictionary(language);
  const message = text || (await buildSettingsSummary(userId, ctx.from?.language_code));
  await ctx.reply(`${message}\n\n${t.chooseConfig}`, buildSettingsKeyboard(language));
}

async function promptForInput(
  ctx: BotContext,
  mode: AwaitingInputMode,
  prompt: string,
  language: BotLanguage
) {
  ctx.session.awaitingInput = mode;
  await ctx.reply(`${prompt}\n\n${getDictionary(language).typeBackHint}`);
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

function validateInvoiceForWrite(invoice: ExtractedInvoice, language: BotLanguage) {
  const errors: string[] = [];

  const text =
    language === 'ru'
      ? {
          supplierMissing: 'Поставщик не распознан',
          invalidDate: 'Дата счета отсутствует или имеет неверный формат',
          noItems: 'Позиции не распознаны',
          itemNameMissing: 'У одной из позиций нет названия',
          invalidQuantity: (name: string) => `Неверное количество для позиции: ${name}`,
          invalidUnitPrice: (name: string) => `Неверная цена за единицу для позиции: ${name}`,
          invalidTotalPrice: (name: string) => `Неверная сумма для позиции: ${name}`,
          unnamed: 'без названия',
        }
      : language === 'kk'
        ? {
            supplierMissing: 'Жеткізуші танылмады',
            invalidDate: 'Шот күні жоқ немесе форматы қате',
            noItems: 'Позициялар танылмады',
            itemNameMissing: 'Позициялардың бірінде атау жоқ',
            invalidQuantity: (name: string) => `Позиция үшін саны қате: ${name}`,
            invalidUnitPrice: (name: string) => `Позиция үшін бірлік бағасы қате: ${name}`,
            invalidTotalPrice: (name: string) => `Позиция үшін жалпы сома қате: ${name}`,
            unnamed: 'атаусыз',
          }
        : {
            supplierMissing: 'Supplier was not detected',
            invalidDate: 'Invoice date is missing or has invalid format',
            noItems: 'No line items were detected',
            itemNameMissing: 'One of the items has no name',
            invalidQuantity: (name: string) => `Invalid quantity for item: ${name}`,
            invalidUnitPrice: (name: string) => `Invalid unit price for item: ${name}`,
            invalidTotalPrice: (name: string) => `Invalid total price for item: ${name}`,
            unnamed: 'unnamed item',
          };

  if (!invoice.supplier.trim()) errors.push(text.supplierMissing);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoice_date)) {
    errors.push(text.invalidDate);
  }
  if (!invoice.items.length) errors.push(text.noItems);

  for (const item of invoice.items) {
    if (!item.name.trim()) errors.push(text.itemNameMissing);
    if (item.quantity <= 0) errors.push(text.invalidQuantity(item.name || text.unnamed));
    if (item.unit_price <= 0) errors.push(text.invalidUnitPrice(item.name || text.unnamed));
    if (item.total_price <= 0) errors.push(text.invalidTotalPrice(item.name || text.unnamed));
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

async function safeCreateDocumentHistory(input: {
  telegramUserId: string;
  provider: AiProvider;
  fileName: string;
  mimeType: string;
}) {
  try {
    return await createDocumentHistoryRecord({
      ...input,
      status: 'received',
    });
  } catch (error) {
    console.error('Failed to create document history record:', error);
    return null;
  }
}

async function safeUpdateDocumentHistory(
  documentHistoryId: string | null,
  patch: {
    status?: 'received' | 'processed' | 'failed';
    errorMessage?: string;
    extractedInvoice?: ExtractedInvoice;
    storageKey?: string;
    storageUrl?: string;
  }
) {
  if (!documentHistoryId) {
    return;
  }

  try {
    await updateDocumentHistoryRecord(documentHistoryId, patch);
  } catch (error) {
    console.error('Failed to update document history record:', error);
  }
}

async function processInvoiceFile(ctx: BotContext, fileId: string, filename: string, mimeType: string) {
  const userId = getUserId(ctx);
  const settings = await getUserSettings(userId);
  const language = await getUserLanguage(ctx, settings);
  const t = getDictionary(language);
  const runtimeConfig = await getRuntimeConfigForUser(userId);
  const provider = getAiProvider(runtimeConfig);
  const spreadsheetId = getSheetIdForUser(settings);
  const sheetName = getSheetNameForUser(settings);

  if (!spreadsheetId) {
    await ctx.reply(t.firstSetSheetId);
    return;
  }

  const providerSetupError = getProviderSetupError(provider, settings, language);

  if (providerSetupError) {
    await ctx.reply(providerSetupError);
    return;
  }

  await ctx.reply(t.fileReceived(provider));
  const documentHistoryId = await safeCreateDocumentHistory({
    telegramUserId: userId,
    provider,
    fileName: filename,
    mimeType,
  });

  let filePath: string | null = null;

  try {
    const downloadedFile = await downloadTelegramFile(bot, fileId, filename, userId, mimeType);
    filePath = downloadedFile.filePath;

    await safeUpdateDocumentHistory(documentHistoryId, {
      ...(downloadedFile.storageKey ? { storageKey: downloadedFile.storageKey } : {}),
      ...(downloadedFile.storageUrl ? { storageUrl: downloadedFile.storageUrl } : {}),
    });

    let invoice: ExtractedInvoice;

    try {
      invoice = await extractInvoiceFromFile(filePath, filename, mimeType, runtimeConfig);
    } catch (error) {
      const message = String(error);

      if (message.includes('not configured for this user')) {
        await safeUpdateDocumentHistory(documentHistoryId, {
          status: 'failed',
          errorMessage: providerSetupError || 'API key is not configured for this user.',
        });
        await ctx.reply(providerSetupError || t.setApiKeyFirst);
        return;
      }

      if (message.includes('"status":"UNAVAILABLE"') || message.includes('high demand')) {
        await safeUpdateDocumentHistory(documentHistoryId, {
          status: 'failed',
          errorMessage: `${provider} is temporarily overloaded.`,
        });
        await ctx.reply(t.providerOverloaded(provider));
        return;
      }

      await safeUpdateDocumentHistory(documentHistoryId, {
        status: 'failed',
        errorMessage: message,
      });

      throw error;
    }

    if (!invoice.is_invoice) {
      await safeUpdateDocumentHistory(documentHistoryId, {
        status: 'failed',
        errorMessage: `Rejected: detected document type "${invoice.document_type || 'unknown'}".`,
        extractedInvoice: invoice,
      });
      await ctx.reply(
        t.notInvoice(invoice.document_type || 'unknown')
      );
      return;
    }

    if (invoice.confidence < 0.6) {
      await safeUpdateDocumentHistory(documentHistoryId, {
        status: 'failed',
        errorMessage: `Rejected: confidence ${invoice.confidence} is below threshold.`,
        extractedInvoice: invoice,
      });
      await ctx.reply(
        t.lowConfidence(invoice.confidence)
      );
      return;
    }

    const validationErrors = validateInvoiceForWrite(invoice, language);

    if (validationErrors.length > 0) {
      await safeUpdateDocumentHistory(documentHistoryId, {
        status: 'failed',
        errorMessage: validationErrors.join('; '),
        extractedInvoice: invoice,
      });
      await ctx.reply(
        `${t.validationFailedIntro}\n` +
          `${validationErrors.map((error) => `- ${error}`).join('\n')}`
      );
      return;
    }

    await writeInvoiceRows(invoice.items, invoice, filename, settings);
    await safeUpdateDocumentHistory(documentHistoryId, {
      status: 'processed',
      extractedInvoice: invoice,
    });

    const preview = invoice.items
      .slice(0, 5)
      .map((item) => `- ${item.name}: ${item.quantity} ${item.unit} x ${item.unit_price} ${item.currency}`)
      .join('\n');

    await ctx.reply(
      `${t.doneRowsAdded(invoice.items.length)}\n\n` +
        `${t.aiProviderLabel}: ${provider}\n` +
        `${t.supplierLabel}: ${invoice.supplier}\n` +
        `${t.dateLabel}: ${invoice.invoice_date}\n` +
        `${t.invoiceLabel}: ${invoice.invoice_number}\n` +
        `${t.sheetIdLabel}: ${maskSheetId(spreadsheetId)}\n` +
        `${t.sheetNameLabel}: ${sheetName || t.defaultSheetName}\n\n` +
        `${preview}` +
        (invoice.warnings.length
          ? `\n\n${t.warningsLabel}:\n${invoice.warnings.map((item) => `- ${item}`).join('\n')}`
          : '')
    );
  } catch (error) {
    await safeUpdateDocumentHistory(documentHistoryId, {
      status: 'failed',
      errorMessage: String(error),
    });
    throw error;
  } finally {
    if (filePath) {
      await cleanupDownloadedTelegramFile(filePath);
    }
  }
}

async function handleTextInput(ctx: BotContext) {
  if (!ctx.message || !('text' in ctx.message)) return false;

  const mode = ctx.session.awaitingInput;
  if (!mode) return false;

  const userId = getUserId(ctx);
  const settings = await getUserSettings(userId);
  const language = await getUserLanguage(ctx, settings);
  const t = getDictionary(language);
  const rawText = ctx.message.text.trim();

  if (!rawText) {
    await ctx.reply(t.emptyValue);
    return true;
  }

  if (isBackWord(rawText) || rawText === '/cancel') {
    await showSettingsMenu(ctx, t.configurationCanceled);
    return true;
  }

  if (mode === 'sheet_id') {
    await updateUserSettings(userId, { googleSheetId: rawText });
    await showSettingsMenu(ctx, t.sheetIdSaved);
    return true;
  }

  if (mode === 'sheet_name') {
    await updateUserSettings(userId, { googleSheetName: rawText });
    await showSettingsMenu(ctx, t.sheetNameSaved);
    return true;
  }

  if (mode === 'column_mapping') {
    try {
      const columnMapping = parseColumnMappingInput(rawText);
      await updateUserSettings(userId, { columnMapping });
      await showSettingsMenu(ctx, t.columnMappingSaved);
    } catch (error) {
      await ctx.reply(t.mappingParseError(String(error)));
    }
    return true;
  }

  if (mode === 'gemini_api_key') {
    await updateUserSettings(userId, { geminiApiKey: rawText });
    await showSettingsMenu(ctx, t.geminiKeySaved);
    return true;
  }

  await updateUserSettings(userId, { openaiApiKey: rawText });
  await showSettingsMenu(ctx, t.openAiKeySaved);
  return true;
}

function sendJson(res: ServerResponse<IncomingMessage>, statusCode: number, payload: Record<string, unknown>) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function createWebhookFallbackHandler(path: string) {
  return (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
    const requestPath = req.url || '/';

    if (req.method === 'GET' && (requestPath === '/' || requestPath === '/healthz')) {
      sendJson(res, 200, {
        ok: true,
        mode: 'webhook',
        path,
      });
      return;
    }

    if (req.method === 'POST' && requestPath === path) {
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: 'Not found',
    });
  };
}

bot.start(async (ctx) => {
  const language = getFallbackLanguage(ctx.from?.language_code);
  await ctx.reply(getDictionary(language).startMessage);
});

bot.command('settings', async (ctx) => {
  await showSettingsMenu(ctx);
});

bot.command('cancel', async (ctx) => {
  const settings = await getUserSettings(getUserId(ctx));
  const language = await getUserLanguage(ctx, settings);
  const t = getDictionary(language);

  if (!ctx.session.awaitingInput) {
    await ctx.reply(t.nothingToCancel);
    return;
  }

  await showSettingsMenu(ctx, t.actionCanceled);
});

bot.command('status', async (ctx) => {
  const userId = getUserId(ctx);
  const runtimeConfig = await getRuntimeConfigForUser(userId);
  const settings = await getUserSettings(userId);
  const language = await getUserLanguage(ctx, settings);
  const t = getDictionary(language);

  await ctx.reply(
    t.statusText(
      getAiProvider(runtimeConfig),
      maskSheetId(getSheetIdForUser(settings)),
      getSheetNameForUser(settings) || t.notSet
    )
  );
});

bot.command('provider', async (ctx) => {
  const runtimeConfig = await getRuntimeConfigForUser(getUserId(ctx));
  const settings = await getUserSettings(getUserId(ctx));
  const language = await getUserLanguage(ctx, settings);
  await ctx.reply(getDictionary(language).currentProvider(getAiProvider(runtimeConfig)));
});

bot.command('test', async (ctx) => {
  try {
    const settings = await getUserSettings(getUserId(ctx));
    const language = await getUserLanguage(ctx, settings);
    const t = getDictionary(language);

    if (!getSheetIdForUser(settings)) {
      await ctx.reply(t.firstSetSheetId);
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

    await ctx.reply(t.testRowAdded);
  } catch (err) {
    console.error(err);
    const settings = await getUserSettings(getUserId(ctx));
    const language = await getUserLanguage(ctx, settings);
    await ctx.reply(getDictionary(language).failedToWriteSheet(String(err)));
  }
});

bot.action('settings:menu', async (ctx) => {
  await ctx.answerCbQuery();
  await showSettingsMenu(ctx);
});

bot.action('settings:language', async (ctx) => {
  await ctx.answerCbQuery();
  const settings = await getUserSettings(getUserId(ctx));
  const language = await getUserLanguage(ctx, settings);
  await ctx.reply(getLanguageMenuText(language), buildLanguageKeyboard(language));
});

bot.action('settings:provider', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = getUserId(ctx);
  const runtimeConfig = await getRuntimeConfigForUser(userId);
  const settings = await getUserSettings(userId);
  const language = await getUserLanguage(ctx, settings);
  await ctx.reply(getDictionary(language).chooseProvider, buildProviderKeyboard(getAiProvider(runtimeConfig), language));
});

bot.action('settings:sheet', async (ctx) => {
  await ctx.answerCbQuery();
  const language = await getUserLanguage(ctx);
  await promptForInput(ctx, 'sheet_id', getDictionary(language).sendGoogleSheetId, language);
});

bot.action('settings:sheet_name', async (ctx) => {
  await ctx.answerCbQuery();
  const language = await getUserLanguage(ctx);
  await promptForInput(ctx, 'sheet_name', getDictionary(language).sendSheetName, language);
});

bot.action('settings:columns', async (ctx) => {
  await ctx.answerCbQuery();
  const language = await getUserLanguage(ctx);
  await ctx.reply(getColumnMappingHelpText(language));
  await promptForInput(ctx, 'column_mapping', getDictionary(language).columnMappingPrompt, language);
});

bot.action('settings:columns_help', async (ctx) => {
  await ctx.answerCbQuery();
  const language = await getUserLanguage(ctx);
  await ctx.reply(getColumnMappingHelpText(language));
});

bot.action('settings:gemini_key', async (ctx) => {
  await ctx.answerCbQuery();
  const language = await getUserLanguage(ctx);
  await promptForInput(ctx, 'gemini_api_key', getDictionary(language).sendGeminiKey, language);
});

bot.action('settings:openai_key', async (ctx) => {
  await ctx.answerCbQuery();
  const language = await getUserLanguage(ctx);
  await promptForInput(ctx, 'openai_api_key', getDictionary(language).sendOpenAiKey, language);
});

bot.action('settings:show', async (ctx) => {
  await ctx.answerCbQuery();
  await showSettingsMenu(ctx, await buildSettingsSummary(getUserId(ctx), ctx.from?.language_code));
});

bot.action('settings:close', async (ctx) => {
  const language = await getUserLanguage(ctx);
  const t = getDictionary(language);
  await ctx.answerCbQuery(t.menuClosedToast);
  ctx.session.awaitingInput = undefined;
  await ctx.reply(t.menuClosedMessage);
});

bot.action(/provider:(gemini|openai|mock)/, async (ctx) => {
  await ctx.answerCbQuery();
  const provider = ctx.match[1] as AiProvider;
  const userId = getUserId(ctx);
  const settings = await getUserSettings(userId);
  const language = await getUserLanguage(ctx, settings);
  await updateUserSettings(userId, { provider });
  await showSettingsMenu(ctx, getDictionary(language).providerSwitched(provider));
});

bot.action(/language:(ru|kk|en)/, async (ctx) => {
  await ctx.answerCbQuery();
  const language = normalizeLanguage(ctx.match[1]) || 'en';
  await updateUserSettings(getUserId(ctx), { language });
  await showSettingsMenu(ctx, getDictionary(language).languageChanged(languageLabels[language]));
});

bot.on('text', async (ctx, next) => {
  const handled = await handleTextInput(ctx);
  if (!handled) await next();
});

bot.on('document', async (ctx) => {
  try {
    const settings = await getUserSettings(getUserId(ctx));
    const language = await getUserLanguage(ctx, settings);
    const t = getDictionary(language);
    const document = ctx.message.document;
    const filename = document.file_name ?? `telegram_document_${document.file_id}`;
    const mimeType = detectMimeType(filename, document.mime_type);

    if (!isSupportedInvoiceFile(filename, mimeType)) {
      await ctx.reply(t.unsupportedFile(filename, mimeType));
      return;
    }

    await processInvoiceFile(ctx, document.file_id, filename, mimeType);
  } catch (err) {
    console.error(err);
    const settings = await getUserSettings(getUserId(ctx));
    const language = await getUserLanguage(ctx, settings);
    await ctx.reply(getDictionary(language).documentProcessingError(String(err)));
  }
});

bot.on('photo', async (ctx) => {
  try {
    const settings = await getUserSettings(getUserId(ctx));
    const language = await getUserLanguage(ctx, settings);
    const t = getDictionary(language);
    const photos = ctx.message.photo;
    const biggestPhoto = photos[photos.length - 1];

    if (!biggestPhoto) {
      await ctx.reply(t.photoNotFound);
      return;
    }

    const filename = `telegram_photo_${biggestPhoto.file_id}.jpg`;
    await processInvoiceFile(ctx, biggestPhoto.file_id, filename, 'image/jpeg');
  } catch (err) {
    console.error(err);
    const settings = await getUserSettings(getUserId(ctx));
    const language = await getUserLanguage(ctx, settings);
    await ctx.reply(getDictionary(language).photoProcessingError(String(err)));
  }
});

await bot.telegram.setMyCommands(getDictionary('en').commands);
await bot.telegram.setMyCommands(getDictionary('ru').commands, { language_code: 'ru' });
await bot.telegram.setMyCommands(getDictionary('kk').commands, { language_code: 'kk' });

async function launchBot() {
  if (webhookDomain) {
    const webhookConfig = {
      domain: webhookDomain,
      path: webhookPath,
      host: serverHost,
      port: serverPort,
      cb: createWebhookFallbackHandler(webhookPath),
      ...(webhookSecretToken ? { secretToken: webhookSecretToken } : {}),
    };

    await bot.launch({
      webhook: webhookConfig,
    });

    console.log(`Invoice bot started in webhook mode: ${webhookDomain}${webhookPath}`);
    return;
  }

  await bot.launch();
  console.log(`Invoice bot started in polling mode with default AI provider: ${getAiProvider()}`);
}

await launchBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
