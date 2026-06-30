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
    throw new Error('Не удалось определить пользователя Telegram.');
  }

  return String(userId);
}

function maskSecret(value?: string) {
  if (!value) return 'не задан';
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function maskSheetId(value?: string) {
  if (!value) return 'не задан';
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
      Markup.button.callback('Провайдер AI', 'settings:provider'),
      Markup.button.callback('Sheet ID', 'settings:sheet'),
    ],
    [
      Markup.button.callback('Sheet name', 'settings:sheet_name'),
      Markup.button.callback('Колонки', 'settings:columns'),
    ],
    [
      Markup.button.callback('Gemini API key', 'settings:gemini_key'),
      Markup.button.callback('OpenAI API key', 'settings:openai_key'),
    ],
    [
      Markup.button.callback('Показать настройки', 'settings:show'),
      Markup.button.callback('Закрыть', 'settings:close'),
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
      Markup.button.callback('Назад', 'settings:menu'),
      Markup.button.callback('Закрыть', 'settings:close'),
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
    `Текущие настройки:\n` +
    `Провайдер AI: ${provider}\n` +
    `Gemini key: ${maskSecret(settings.geminiApiKey)}\n` +
    `OpenAI key: ${maskSecret(settings.openaiApiKey)}\n` +
    `Google Sheet ID: ${maskSheetId(getSheetIdForUser(settings))}\n` +
    `Sheet name: ${getSheetNameForUser(settings) || 'не задан'}\n` +
    `Колонки:\n${formatColumnMapping(settings.columnMapping)}`
  );
}

async function showSettingsMenu(ctx: BotContext, text?: string) {
  ctx.session.awaitingInput = undefined;
  const message = text || (await buildSettingsSummary(getUserId(ctx)));
  await ctx.reply(`${message}\n\nВыбери, что хочешь настроить:`, buildSettingsKeyboard());
}

async function promptForInput(ctx: BotContext, mode: AwaitingInputMode, prompt: string) {
  ctx.session.awaitingInput = mode;
  await ctx.reply(`${prompt}\n\nМожно написать "назад" или /cancel.`);
}

function buildSheetWriteOptions(settings: UserSettings) {
  const spreadsheetId = getSheetIdForUser(settings);

  if (!spreadsheetId) {
    throw new Error('Сначала укажи Google Sheet ID в /settings.');
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

  if (!invoice.supplier.trim()) errors.push('Не найден поставщик');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoice_date)) {
    errors.push('Дата счета отсутствует или имеет неверный формат');
  }
  if (!invoice.items.length) errors.push('Не найдены позиции в документе');

  for (const item of invoice.items) {
    if (!item.name.trim()) errors.push('У одной из позиций нет названия');
    if (item.quantity <= 0) errors.push(`Некорректное количество у позиции: ${item.name || 'без названия'}`);
    if (item.unit_price <= 0) errors.push(`Некорректная цена у позиции: ${item.name || 'без названия'}`);
    if (item.total_price <= 0) errors.push(`Некорректная сумма у позиции: ${item.name || 'без названия'}`);
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
    await ctx.reply('Сначала открой /settings и укажи Google Sheet ID.');
    return;
  }

  await ctx.reply(`Файл получил. Скачиваю и обрабатываю через ${provider}...`);

  const filePath = await downloadTelegramFile(bot, fileId, filename);
  const invoice = await extractInvoiceFromFile(filePath, filename, mimeType, runtimeConfig);

  if (!invoice.is_invoice) {
    await ctx.reply(
      `Это не похоже на счет или накладную.\n` +
        `Тип документа: ${invoice.document_type || 'неизвестно'}\n` +
        `В Google Sheets ничего не записал.`
    );
    return;
  }

  if (invoice.confidence < 0.6) {
    await ctx.reply(
      `Документ распознан с низкой уверенностью.\n` +
        `Confidence: ${invoice.confidence}\n` +
        `В Google Sheets ничего не записал.`
    );
    return;
  }

  const validationErrors = validateInvoiceForWrite(invoice);

  if (validationErrors.length > 0) {
    await ctx.reply(
      `Я нашел данные, похожие на счет, но пока небезопасно записывать их в таблицу.\n` +
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
    `Готово. Строк добавлено в Google Sheets: ${invoice.items.length}\n\n` +
      `Провайдер: ${provider}\n` +
      `Поставщик: ${invoice.supplier}\n` +
      `Дата: ${invoice.invoice_date}\n` +
      `Счет: ${invoice.invoice_number}\n` +
      `Таблица: ${maskSheetId(spreadsheetId)}\n` +
      `Лист: ${sheetName || 'по умолчанию'}\n\n` +
      `${preview}` +
      (invoice.warnings.length
        ? `\n\nПредупреждения:\n${invoice.warnings.map((item) => `- ${item}`).join('\n')}`
        : '')
  );
}

async function handleTextInput(ctx: BotContext) {
  if (!ctx.message || !('text' in ctx.message)) return false;

  const mode = ctx.session.awaitingInput;
  if (!mode) return false;

  const rawText = ctx.message.text.trim();

  if (!rawText) {
    await ctx.reply('Пустое значение не подходит. Попробуй еще раз или напиши "назад".');
    return true;
  }

  if (rawText.toLowerCase() === 'назад' || rawText === '/cancel') {
    await showSettingsMenu(ctx, 'Настройка отменена.');
    return true;
  }

  const userId = getUserId(ctx);

  if (mode === 'sheet_id') {
    await updateUserSettings(userId, { googleSheetId: rawText });
    await showSettingsMenu(ctx, 'Google Sheet ID сохранен.');
    return true;
  }

  if (mode === 'sheet_name') {
    await updateUserSettings(userId, { googleSheetName: rawText });
    await showSettingsMenu(ctx, 'Sheet name сохранен.');
    return true;
  }

  if (mode === 'column_mapping') {
    try {
      const columnMapping = parseColumnMappingInput(rawText);
      await updateUserSettings(userId, { columnMapping });
      await showSettingsMenu(ctx, 'Маппинг колонок сохранен.');
    } catch (error) {
      await ctx.reply(
        `Не удалось разобрать маппинг: ${String(error)}\n\n` +
          `Пример:\n` +
          `supplier=C\ninvoice_date=B\nitem=F`
      );
    }
    return true;
  }

  if (mode === 'gemini_api_key') {
    await updateUserSettings(userId, { geminiApiKey: rawText });
    await showSettingsMenu(ctx, 'Gemini API key сохранен.');
    return true;
  }

  await updateUserSettings(userId, { openaiApiKey: rawText });
  await showSettingsMenu(ctx, 'OpenAI API key сохранен.');
  return true;
}

bot.start(async (ctx) => {
  await ctx.reply(
    'Пришли PDF, JPG или PNG со счетом. Я распознаю позиции и запишу их в Google Sheets.\n\nДля личных настроек открой /settings.'
  );
});

bot.command('settings', async (ctx) => {
  await showSettingsMenu(ctx);
});

bot.command('cancel', async (ctx) => {
  if (!ctx.session.awaitingInput) {
    await ctx.reply('Сейчас нечего отменять.');
    return;
  }

  await showSettingsMenu(ctx, 'Действие отменено.');
});

bot.command('status', async (ctx) => {
  const userId = getUserId(ctx);
  const runtimeConfig = await getRuntimeConfigForUser(userId);
  const settings = await getUserSettings(userId);

  await ctx.reply(
    `Бот работает.\n` +
      `Провайдер AI: ${getAiProvider(runtimeConfig)}\n` +
      `Google Sheet ID: ${maskSheetId(getSheetIdForUser(settings))}\n` +
      `Sheet name: ${getSheetNameForUser(settings) || 'не задан'}`
  );
});

bot.command('provider', async (ctx) => {
  const runtimeConfig = await getRuntimeConfigForUser(getUserId(ctx));
  await ctx.reply(`Текущий провайдер AI: ${getAiProvider(runtimeConfig)}`);
});

bot.command('test', async (ctx) => {
  try {
    const settings = await getUserSettings(getUserId(ctx));

    if (!getSheetIdForUser(settings)) {
      await ctx.reply('Сначала открой /settings и укажи Google Sheet ID.');
      return;
    }

    await appendRowToGoogleSheet(
      {
        uploaded_at: new Date().toISOString(),
        invoice_date: '2026-05-12',
        supplier: 'ТОО Test Supplier',
        item: 'Опора металлическая',
        quantity: 10,
        unit: 'шт',
        unit_price: 14500,
        total_price: 145000,
        currency: 'KZT',
        invoice_number: 'TEST-001',
        source: 'manual-test',
      },
      buildSheetWriteOptions(settings)
    );

    await ctx.reply('Тестовая строка добавлена в Google Sheets.');
  } catch (err) {
    console.error(err);
    await ctx.reply(`Не удалось записать в Google Sheets: ${String(err)}`);
  }
});

bot.action('settings:menu', async (ctx) => {
  await ctx.answerCbQuery();
  await showSettingsMenu(ctx);
});

bot.action('settings:provider', async (ctx) => {
  await ctx.answerCbQuery();
  const runtimeConfig = await getRuntimeConfigForUser(getUserId(ctx));
  await ctx.reply('Выбери AI-провайдера:', buildProviderKeyboard(getAiProvider(runtimeConfig)));
});

bot.action('settings:sheet', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(ctx, 'sheet_id', 'Отправь Google Sheet ID для записи данных.');
});

bot.action('settings:sheet_name', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(ctx, 'sheet_name', 'Отправь имя листа внутри таблицы. Например: Invoices');
});

bot.action('settings:columns', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(
    ctx,
    'column_mapping',
    'Отправь маппинг колонок строками в формате поле=колонка.\n\nПример:\nuploaded_at=A\ninvoice_date=B\nsupplier=C\nitem=D\nquantity=E'
  );
});

bot.action('settings:gemini_key', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(ctx, 'gemini_api_key', 'Отправь свой Gemini API key.');
});

bot.action('settings:openai_key', async (ctx) => {
  await ctx.answerCbQuery();
  await promptForInput(ctx, 'openai_api_key', 'Отправь свой OpenAI API key.');
});

bot.action('settings:show', async (ctx) => {
  await ctx.answerCbQuery();
  await showSettingsMenu(ctx, await buildSettingsSummary(getUserId(ctx)));
});

bot.action('settings:close', async (ctx) => {
  await ctx.answerCbQuery('Меню закрыто');
  ctx.session.awaitingInput = undefined;
  await ctx.reply('Ок, вышел из меню настроек.');
});

bot.action(/provider:(gemini|openai|mock)/, async (ctx) => {
  await ctx.answerCbQuery();
  const provider = ctx.match[1] as AiProvider;
  await updateUserSettings(getUserId(ctx), { provider });
  await showSettingsMenu(ctx, `Провайдер переключен на ${provider}.`);
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
        `Этот тип файла не поддерживается.\n\n` +
          `Файл: ${filename}\n` +
          `Тип: ${mimeType}\n\n` +
          `Отправь только PDF, JPG или PNG.`
      );
      return;
    }

    await processInvoiceFile(ctx, document.file_id, filename, mimeType);
  } catch (err) {
    console.error(err);
    await ctx.reply(`Ошибка при обработке документа: ${String(err)}`);
  }
});

bot.on('photo', async (ctx) => {
  try {
    const photos = ctx.message.photo;
    const biggestPhoto = photos[photos.length - 1];

    if (!biggestPhoto) {
      await ctx.reply('Фото не найдено в сообщении.');
      return;
    }

    const filename = `telegram_photo_${biggestPhoto.file_id}.jpg`;
    await processInvoiceFile(ctx, biggestPhoto.file_id, filename, 'image/jpeg');
  } catch (err) {
    console.error(err);
    await ctx.reply(`Ошибка при обработке фото: ${String(err)}`);
  }
});

console.log(`Invoice bot started with default AI provider: ${getAiProvider()}`);

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
