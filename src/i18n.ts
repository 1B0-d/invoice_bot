import { invoiceFieldOrder, mergeColumnMapping } from './sheets/sheetMapping.js';
import type { BotLanguage, InvoiceFieldKey, UserSettings } from './settings/userSettings.js';
import type { AiProvider } from './ai/types.js';

type Dictionary = {
  languageButton: string;
  aiProviderButton: string;
  sheetIdButton: string;
  sheetNameButton: string;
  columnsButton: string;
  columnsHelpButton: string;
  geminiKeyButton: string;
  openaiKeyButton: string;
  showSettingsButton: string;
  closeButton: string;
  backButton: string;
  chooseConfig: string;
  chooseLanguage: string;
  chooseProvider: string;
  currentSettings: string;
  languageLabel: string;
  aiProviderLabel: string;
  geminiKeyLabel: string;
  openaiKeyLabel: string;
  googleSheetIdLabel: string;
  sheetNameLabel: string;
  columnsLabel: string;
  notSet: string;
  defaultSheetName: string;
  setGeminiKeyFirst: string;
  setOpenAiKeyFirst: string;
  typeBackHint: string;
  firstSetSheetId: string;
  fileReceived: (provider: string) => string;
  setApiKeyFirst: string;
  providerOverloaded: (provider: string) => string;
  notInvoice: (documentType: string) => string;
  lowConfidence: (confidence: number) => string;
  validationFailedIntro: string;
  doneRowsAdded: (count: number) => string;
  supplierLabel: string;
  dateLabel: string;
  invoiceLabel: string;
  sheetIdLabel: string;
  warningsLabel: string;
  emptyValue: string;
  configurationCanceled: string;
  sheetIdSaved: string;
  sheetNameSaved: string;
  columnMappingSaved: string;
  mappingParseError: (error: string) => string;
  geminiKeySaved: string;
  openAiKeySaved: string;
  startMessage: string;
  nothingToCancel: string;
  actionCanceled: string;
  botRunning: string;
  currentProvider: (provider: string) => string;
  testRowAdded: string;
  failedToWriteSheet: (error: string) => string;
  sendGoogleSheetId: string;
  sendSheetName: string;
  sendGeminiKey: string;
  sendOpenAiKey: string;
  menuClosedToast: string;
  menuClosedMessage: string;
  providerSwitched: (provider: string) => string;
  unsupportedFile: (filename: string, mimeType: string) => string;
  documentProcessingError: (error: string) => string;
  photoNotFound: string;
  photoProcessingError: (error: string) => string;
  columnMappingPrompt: string;
  statusText: (provider: string, sheetId: string, sheetName: string) => string;
  languageChanged: (languageName: string) => string;
  availableFields: string;
  mappingExample: string;
  columnHelpIntro: string;
  columnHelpRule: string;
  columnHelpExample: string;
  columnHelpOnlySome: string;
  commands: Array<{ command: string; description: string }>;
};

export const languageLabels: Record<BotLanguage, string> = {
  ru: 'Русский',
  kk: 'Қазақша',
  en: 'English',
};

const fieldLabels: Record<BotLanguage, Record<InvoiceFieldKey, string>> = {
  ru: {
    uploaded_at: 'время загрузки',
    invoice_date: 'дата счета',
    supplier: 'поставщик',
    item: 'товар',
    quantity: 'количество',
    unit: 'единица',
    unit_price: 'цена за единицу',
    total_price: 'сумма',
    currency: 'валюта',
    invoice_number: 'номер счета',
    source: 'источник файла',
  },
  kk: {
    uploaded_at: 'жүктелген уақыты',
    invoice_date: 'шот күні',
    supplier: 'жеткізуші',
    item: 'тауар',
    quantity: 'саны',
    unit: 'өлшем бірлігі',
    unit_price: 'бірлік бағасы',
    total_price: 'жалпы сома',
    currency: 'валюта',
    invoice_number: 'шот нөмірі',
    source: 'файл көзі',
  },
  en: {
    uploaded_at: 'upload time',
    invoice_date: 'invoice date',
    supplier: 'supplier',
    item: 'item',
    quantity: 'quantity',
    unit: 'unit',
    unit_price: 'unit price',
    total_price: 'total price',
    currency: 'currency',
    invoice_number: 'invoice number',
    source: 'file source',
  },
};

const dictionaries: Record<BotLanguage, Dictionary> = {
  ru: {
    languageButton: 'Язык',
    aiProviderButton: 'AI модель',
    sheetIdButton: 'ID таблицы',
    sheetNameButton: 'Лист',
    columnsButton: 'Колонки',
    columnsHelpButton: 'Подробнее о колонках',
    geminiKeyButton: 'Gemini API ключ',
    openaiKeyButton: 'OpenAI API ключ',
    showSettingsButton: 'Показать настройки',
    closeButton: 'Закрыть',
    backButton: 'Назад',
    chooseConfig: 'Выбери, что хочешь настроить:',
    chooseLanguage: 'Выбери язык бота:',
    chooseProvider: 'Выбери AI модель:',
    currentSettings: 'Текущие настройки',
    languageLabel: 'Язык',
    aiProviderLabel: 'AI модель',
    geminiKeyLabel: 'Gemini ключ',
    openaiKeyLabel: 'OpenAI ключ',
    googleSheetIdLabel: 'Google Sheet ID',
    sheetNameLabel: 'Название листа',
    columnsLabel: 'Колонки',
    notSet: 'не задано',
    defaultSheetName: 'по умолчанию',
    setGeminiKeyFirst: 'Для Gemini сначала укажи Gemini API ключ в /settings.',
    setOpenAiKeyFirst: 'Для OpenAI сначала укажи OpenAI API ключ в /settings.',
    typeBackHint: 'Можешь написать "назад" или /cancel.',
    firstSetSheetId: 'Сначала открой /settings и укажи Google Sheet ID.',
    fileReceived: (provider) => `Файл получен. Скачиваю и обрабатываю через ${provider}...`,
    setApiKeyFirst: 'Сначала укажи API ключ в /settings.',
    providerOverloaded: (provider) =>
      `Сервис ${provider} сейчас перегружен. Попробуй позже или переключи AI модель в /settings.`,
    notInvoice: (documentType) =>
      `Это не похоже на инвойс.\nТип документа: ${documentType}\nНичего не было записано в Google Sheets.`,
    lowConfidence: (confidence) =>
      `Документ распознан с низкой уверенностью.\nУверенность: ${confidence}\nНичего не было записано в Google Sheets.`,
    validationFailedIntro: 'Я нашел данные, похожие на инвойс, но пока небезопасно записывать их в таблицу.',
    doneRowsAdded: (count) => `Готово. В Google Sheets добавлено строк: ${count}`,
    supplierLabel: 'Поставщик',
    dateLabel: 'Дата',
    invoiceLabel: 'Счет',
    sheetIdLabel: 'Sheet ID',
    warningsLabel: 'Предупреждения',
    emptyValue: 'Пустое значение нельзя отправлять. Попробуй еще раз или напиши "назад".',
    configurationCanceled: 'Настройка отменена.',
    sheetIdSaved: 'Google Sheet ID сохранен.',
    sheetNameSaved: 'Название листа сохранено.',
    columnMappingSaved: 'Настройка колонок сохранена.',
    mappingParseError: (error) =>
      `Не удалось разобрать маппинг: ${error}\n\nПример:\nsupplier=C\ninvoice_date=B\nitem=F`,
    geminiKeySaved: 'Gemini API ключ сохранен.',
    openAiKeySaved: 'OpenAI API ключ сохранен.',
    startMessage:
      'Отправь PDF, JPG или PNG со счетом. Я распознаю позиции и запишу их в Google Sheets.\n\nОткрой /settings для личной настройки.',
    nothingToCancel: 'Сейчас нечего отменять.',
    actionCanceled: 'Действие отменено.',
    botRunning: 'Бот работает.',
    currentProvider: (provider) => `Текущая AI модель: ${provider}`,
    testRowAdded: 'Тестовая строка добавлена в Google Sheets.',
    failedToWriteSheet: (error) => `Не удалось записать в Google Sheets: ${error}`,
    sendGoogleSheetId: 'Отправь Google Sheet ID.',
    sendSheetName: 'Отправь название листа внутри таблицы. Пример: Invoices',
    sendGeminiKey: 'Отправь свой Gemini API ключ.',
    sendOpenAiKey: 'Отправь свой OpenAI API ключ.',
    menuClosedToast: 'Меню закрыто',
    menuClosedMessage: 'Окей, меню настроек закрыто.',
    providerSwitched: (provider) => `AI модель переключена на ${provider}.`,
    unsupportedFile: (filename, mimeType) =>
      `Этот тип файла не поддерживается.\n\nФайл: ${filename}\nТип: ${mimeType}\n\nОтправь только PDF, JPG или PNG.`,
    documentProcessingError: (error) => `Ошибка при обработке документа: ${error}`,
    photoNotFound: 'Фото не найдено в сообщении.',
    photoProcessingError: (error) => `Ошибка при обработке фото: ${error}`,
    columnMappingPrompt:
      'Теперь отправь маппинг колонок в формате field=column.\n\nПример:\nuploaded_at=A\ninvoice_date=B\nsupplier=C\nitem=D\nquantity=E',
    statusText: (provider, sheetId, sheetName) =>
      `Бот работает.\nAI модель: ${provider}\nGoogle Sheet ID: ${sheetId}\nНазвание листа: ${sheetName}`,
    languageChanged: (languageName) => `Язык переключен на ${languageName}.`,
    availableFields: 'Доступные поля',
    mappingExample: 'Пример маппинга',
    columnHelpIntro: 'Как работает настройка колонок',
    columnHelpRule: 'Слева ключ бота, справа буква колонки Google Sheets.',
    columnHelpExample: 'Например: supplier=C значит "писать поставщика в колонку C".',
    columnHelpOnlySome: 'Можно указать только те поля, которые хочешь перекинуть. Остальные останутся по умолчанию.',
    commands: [
      { command: 'start', description: 'Запустить бота' },
      { command: 'settings', description: 'Настроить AI и таблицу' },
      { command: 'status', description: 'Проверить настройки' },
      { command: 'provider', description: 'Показать текущий AI' },
      { command: 'test', description: 'Проверить запись в таблицу' },
    ],
  },
  kk: {
    languageButton: 'Тіл',
    aiProviderButton: 'AI моделі',
    sheetIdButton: 'Кесте ID',
    sheetNameButton: 'Парақ',
    columnsButton: 'Бағандар',
    columnsHelpButton: 'Бағандар туралы',
    geminiKeyButton: 'Gemini API кілті',
    openaiKeyButton: 'OpenAI API кілті',
    showSettingsButton: 'Баптауларды көрсету',
    closeButton: 'Жабу',
    backButton: 'Артқа',
    chooseConfig: 'Нені баптағың келетінін таңда:',
    chooseLanguage: 'Бот тілін таңда:',
    chooseProvider: 'AI моделін таңда:',
    currentSettings: 'Қазіргі баптаулар',
    languageLabel: 'Тіл',
    aiProviderLabel: 'AI моделі',
    geminiKeyLabel: 'Gemini кілті',
    openaiKeyLabel: 'OpenAI кілті',
    googleSheetIdLabel: 'Google Sheet ID',
    sheetNameLabel: 'Парақ атауы',
    columnsLabel: 'Бағандар',
    notSet: 'орнатылмаған',
    defaultSheetName: 'әдепкі',
    setGeminiKeyFirst: 'Gemini үшін алдымен /settings ішінде Gemini API кілтін енгіз.',
    setOpenAiKeyFirst: 'OpenAI үшін алдымен /settings ішінде OpenAI API кілтін енгіз.',
    typeBackHint: 'Қаласаң "артқа" деп жаз немесе /cancel жібер.',
    firstSetSheetId: 'Алдымен /settings ішінен Google Sheet ID енгіз.',
    fileReceived: (provider) => `Файл қабылданды. Жүктеп, ${provider} арқылы өңдеп жатырмын...`,
    setApiKeyFirst: '/settings ішінде алдымен API кілтін енгіз.',
    providerOverloaded: (provider) =>
      `${provider} сервисі қазір жүктемеде. Кейінірек қайталап көр немесе /settings ішінде AI моделін ауыстыр.`,
    notInvoice: (documentType) =>
      `Бұл инвойсқа ұқсамайды.\nҚұжат түрі: ${documentType}\nGoogle Sheets-ке ештеңе жазылмады.`,
    lowConfidence: (confidence) =>
      `Құжат сенімділігі төмен болып танылды.\nСенімділік: ${confidence}\nGoogle Sheets-ке ештеңе жазылмады.`,
    validationFailedIntro: 'Инвойсқа ұқсас деректер табылды, бірақ оларды кестеге жазу әзірше қауіпсіз емес.',
    doneRowsAdded: (count) => `Дайын. Google Sheets-ке қосылған жол саны: ${count}`,
    supplierLabel: 'Жеткізуші',
    dateLabel: 'Күні',
    invoiceLabel: 'Шот',
    sheetIdLabel: 'Sheet ID',
    warningsLabel: 'Ескертулер',
    emptyValue: 'Бос мән жіберуге болмайды. Қайта жаз немесе "артқа" деп жаз.',
    configurationCanceled: 'Баптау тоқтатылды.',
    sheetIdSaved: 'Google Sheet ID сақталды.',
    sheetNameSaved: 'Парақ атауы сақталды.',
    columnMappingSaved: 'Баған баптауы сақталды.',
    mappingParseError: (error) =>
      `Маппингті оқу мүмкін болмады: ${error}\n\nМысал:\nsupplier=C\ninvoice_date=B\nitem=F`,
    geminiKeySaved: 'Gemini API кілті сақталды.',
    openAiKeySaved: 'OpenAI API кілті сақталды.',
    startMessage:
      'Шоттың PDF, JPG немесе PNG файлын жібер. Мен жолдарды танып, Google Sheets-ке жазамын.\n\nЖеке баптау үшін /settings аш.',
    nothingToCancel: 'Қазір тоқтататын ештеңе жоқ.',
    actionCanceled: 'Әрекет тоқтатылды.',
    botRunning: 'Бот жұмыс істеп тұр.',
    currentProvider: (provider) => `Қазіргі AI моделі: ${provider}`,
    testRowAdded: 'Сынақ жолы Google Sheets-ке қосылды.',
    failedToWriteSheet: (error) => `Google Sheets-ке жазу сәтсіз болды: ${error}`,
    sendGoogleSheetId: 'Google Sheet ID жібер.',
    sendSheetName: 'Кесте ішіндегі парақ атауын жібер. Мысалы: Invoices',
    sendGeminiKey: 'Gemini API кілтіңді жібер.',
    sendOpenAiKey: 'OpenAI API кілтіңді жібер.',
    menuClosedToast: 'Мәзір жабылды',
    menuClosedMessage: 'Жарайды, баптау мәзірі жабылды.',
    providerSwitched: (provider) => `AI моделі ${provider} болып ауысты.`,
    unsupportedFile: (filename, mimeType) =>
      `Бұл файл түрі қолдау таппайды.\n\nФайл: ${filename}\nТүрі: ${mimeType}\n\nТек PDF, JPG немесе PNG жібер.`,
    documentProcessingError: (error) => `Құжатты өңдеу қатесі: ${error}`,
    photoNotFound: 'Хабарламада фото табылмады.',
    photoProcessingError: (error) => `Фотоны өңдеу қатесі: ${error}`,
    columnMappingPrompt:
      'Енді баған маппингін field=column форматында жібер.\n\nМысал:\nuploaded_at=A\ninvoice_date=B\nsupplier=C\nitem=D\nquantity=E',
    statusText: (provider, sheetId, sheetName) =>
      `Бот жұмыс істеп тұр.\nAI моделі: ${provider}\nGoogle Sheet ID: ${sheetId}\nПарақ атауы: ${sheetName}`,
    languageChanged: (languageName) => `Тіл ${languageName} болып ауысты.`,
    availableFields: 'Қолжетімді өрістер',
    mappingExample: 'Маппинг мысалы',
    columnHelpIntro: 'Баған баптауы қалай жұмыс істейді',
    columnHelpRule: 'Сол жақта боттың кілті, оң жақта Google Sheets бағанының әрпі.',
    columnHelpExample: 'Мысалы: supplier=C дегені "жеткізушіні C бағанына жазу".',
    columnHelpOnlySome: 'Тек ауыстырғың келетін өрістерді ғана көрсете аласың. Қалғаны әдепкі күйде қалады.',
    commands: [
      { command: 'start', description: 'Ботты іске қосу' },
      { command: 'settings', description: 'AI мен кестені баптау' },
      { command: 'status', description: 'Баптауды тексеру' },
      { command: 'provider', description: 'Қазіргі AI-ды көрсету' },
      { command: 'test', description: 'Кестеге жазуды тексеру' },
    ],
  },
  en: {
    languageButton: 'Language',
    aiProviderButton: 'AI provider',
    sheetIdButton: 'Sheet ID',
    sheetNameButton: 'Sheet name',
    columnsButton: 'Columns',
    columnsHelpButton: 'Columns help',
    geminiKeyButton: 'Gemini API key',
    openaiKeyButton: 'OpenAI API key',
    showSettingsButton: 'Show settings',
    closeButton: 'Close',
    backButton: 'Back',
    chooseConfig: 'Choose what you want to configure:',
    chooseLanguage: 'Choose bot language:',
    chooseProvider: 'Choose AI provider:',
    currentSettings: 'Current settings',
    languageLabel: 'Language',
    aiProviderLabel: 'AI provider',
    geminiKeyLabel: 'Gemini key',
    openaiKeyLabel: 'OpenAI key',
    googleSheetIdLabel: 'Google Sheet ID',
    sheetNameLabel: 'Sheet name',
    columnsLabel: 'Columns',
    notSet: 'not set',
    defaultSheetName: 'default',
    setGeminiKeyFirst: 'For Gemini, first set your Gemini API key in /settings.',
    setOpenAiKeyFirst: 'For OpenAI, first set your OpenAI API key in /settings.',
    typeBackHint: 'You can type "back" or /cancel.',
    firstSetSheetId: 'First open /settings and set Google Sheet ID.',
    fileReceived: (provider) => `File received. Downloading and processing with ${provider}...`,
    setApiKeyFirst: 'First set your API key in /settings.',
    providerOverloaded: (provider) =>
      `The ${provider} service is temporarily overloaded. Try again later or switch AI provider in /settings.`,
    notInvoice: (documentType) =>
      `This does not look like an invoice.\nDocument type: ${documentType}\nNothing was written to Google Sheets.`,
    lowConfidence: (confidence) =>
      `The document was recognized with low confidence.\nConfidence: ${confidence}\nNothing was written to Google Sheets.`,
    validationFailedIntro: 'I found invoice-like data, but it is not safe to write it yet.',
    doneRowsAdded: (count) => `Done. Rows added to Google Sheets: ${count}`,
    supplierLabel: 'Supplier',
    dateLabel: 'Date',
    invoiceLabel: 'Invoice',
    sheetIdLabel: 'Sheet ID',
    warningsLabel: 'Warnings',
    emptyValue: 'Empty value is not allowed. Try again or type "back".',
    configurationCanceled: 'Configuration canceled.',
    sheetIdSaved: 'Google Sheet ID saved.',
    sheetNameSaved: 'Sheet name saved.',
    columnMappingSaved: 'Column mapping saved.',
    mappingParseError: (error) =>
      `Could not parse mapping: ${error}\n\nExample:\nsupplier=C\ninvoice_date=B\nitem=F`,
    geminiKeySaved: 'Gemini API key saved.',
    openAiKeySaved: 'OpenAI API key saved.',
    startMessage:
      'Send PDF, JPG, or PNG with an invoice. I will extract line items and write them to Google Sheets.\n\nOpen /settings for personal configuration.',
    nothingToCancel: 'There is nothing to cancel right now.',
    actionCanceled: 'Action canceled.',
    botRunning: 'Bot is running.',
    currentProvider: (provider) => `Current AI provider: ${provider}`,
    testRowAdded: 'Test row was added to Google Sheets.',
    failedToWriteSheet: (error) => `Failed to write to Google Sheets: ${error}`,
    sendGoogleSheetId: 'Send Google Sheet ID.',
    sendSheetName: 'Send sheet name inside the spreadsheet. Example: Invoices',
    sendGeminiKey: 'Send your Gemini API key.',
    sendOpenAiKey: 'Send your OpenAI API key.',
    menuClosedToast: 'Menu closed',
    menuClosedMessage: 'Okay, settings menu closed.',
    providerSwitched: (provider) => `Provider switched to ${provider}.`,
    unsupportedFile: (filename, mimeType) =>
      `This file type is not supported.\n\nFile: ${filename}\nType: ${mimeType}\n\nSend only PDF, JPG, or PNG.`,
    documentProcessingError: (error) => `Document processing error: ${error}`,
    photoNotFound: 'Photo was not found in the message.',
    photoProcessingError: (error) => `Photo processing error: ${error}`,
    columnMappingPrompt:
      'Now send your column mapping in the format field=column.\n\nExample:\nuploaded_at=A\ninvoice_date=B\nsupplier=C\nitem=D\nquantity=E',
    statusText: (provider, sheetId, sheetName) =>
      `Bot is running.\nAI provider: ${provider}\nGoogle Sheet ID: ${sheetId}\nSheet name: ${sheetName}`,
    languageChanged: (languageName) => `Language switched to ${languageName}.`,
    availableFields: 'Available fields',
    mappingExample: 'Example mapping',
    columnHelpIntro: 'How column mapping works',
    columnHelpRule: 'On the left is the bot field, on the right is the Google Sheets column letter.',
    columnHelpExample: 'Example: supplier=C means "write supplier to column C".',
    columnHelpOnlySome: 'You can specify only the fields you want to remap. The rest stay on defaults.',
    commands: [
      { command: 'start', description: 'Start the bot' },
      { command: 'settings', description: 'Configure AI and spreadsheet' },
      { command: 'status', description: 'Check current settings' },
      { command: 'provider', description: 'Show current AI provider' },
      { command: 'test', description: 'Test writing to spreadsheet' },
    ],
  },
};

export function getDictionary(language: BotLanguage) {
  return dictionaries[language];
}

export function normalizeLanguage(value?: string | null): BotLanguage | null {
  if (!value) return null;

  if (value === 'ru') return 'ru';
  if (value === 'kk' || value === 'kz') return 'kk';
  if (value === 'en') return 'en';

  return null;
}

export function getFallbackLanguage(telegramLanguageCode?: string) {
  const normalized = String(telegramLanguageCode || '').toLowerCase();

  if (normalized.startsWith('ru')) return 'ru' as const;
  if (normalized.startsWith('kk') || normalized.startsWith('kz')) return 'kk' as const;

  return 'en' as const;
}

export function resolveLanguage(settings?: UserSettings, telegramLanguageCode?: string): BotLanguage {
  return normalizeLanguage(settings?.language) || getFallbackLanguage(telegramLanguageCode);
}

export function formatColumnMappingLocalized(
  mapping: UserSettings['columnMapping'],
  language: BotLanguage
) {
  const merged = mergeColumnMapping(mapping);

  return invoiceFieldOrder
    .map((field) => `${field} (${fieldLabels[language][field]}) = ${merged[field]}`)
    .join('\n');
}

export function getColumnMappingHelpText(language: BotLanguage) {
  const t = getDictionary(language);

  const fields = invoiceFieldOrder
    .map((field) => `${field} - ${fieldLabels[language][field]}`)
    .join('\n');

  const example = invoiceFieldOrder
    .map((field) => `${field}=${mergeColumnMapping()[field]}`)
    .join('\n');

  return (
    `${t.columnHelpIntro}:\n\n` +
    `${t.columnHelpRule}\n` +
    `${t.columnHelpExample}\n\n` +
    `${t.availableFields}:\n` +
    `${fields}\n\n` +
    `${t.mappingExample}:\n` +
    `${example}\n\n` +
    `${t.columnHelpOnlySome}`
  );
}

export function getLanguageMenuText(language: BotLanguage) {
  return `${getDictionary(language).chooseLanguage}\n\n${Object.entries(languageLabels)
    .map(([code, label]) => `${code} - ${label}`)
    .join('\n')}`;
}

export function getLanguageButtonLabel(language: BotLanguage) {
  return languageLabels[language];
}

export function getProviderButtonLabel(provider: AiProvider, currentProvider: AiProvider) {
  return provider === currentProvider ? `${provider} *` : provider;
}

export function isBackWord(value: string) {
  const normalized = value.trim().toLowerCase();
  return ['back', 'назад', 'артқа', 'кейін'].includes(normalized);
}
