const SECRET_TOKEN = 'my-secret-123';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SECRET_TOKEN) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    const spreadsheetId = body.spreadsheetId;
    const sheetName = body.sheetName || 'Invoices';
    const row = body.row || {};
    const mappedRow = body.mappedRow || {};
    const columnMapping = body.columnMapping || {};

    if (!spreadsheetId) {
      return jsonResponse({ ok: false, error: 'spreadsheetId is required' });
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      return jsonResponse({ ok: false, error: `Sheet ${sheetName} not found` });
    }

    ensureHeaders(sheet, columnMapping, mappedRow, row);

    if (Object.keys(mappedRow).length > 0) {
      sheet.appendRow(buildRowFromMappedRow(mappedRow));
      return jsonResponse({ ok: true });
    }

    sheet.appendRow([
      row.uploaded_at || '',
      row.invoice_date || '',
      row.supplier || '',
      row.item || '',
      row.quantity || '',
      row.unit || '',
      row.unit_price || '',
      row.total_price || '',
      row.currency || '',
      row.invoice_number || '',
      row.source || '',
    ]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function ensureHeaders(sheet, columnMapping, mappedRow, row) {
  const headers = buildHeaderRow(columnMapping, mappedRow, row);
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const isEmpty = firstRow.every((cell) => cell === '');

  if (isEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function buildHeaderRow(columnMapping, mappedRow, row) {
  const mappingKeys = Object.keys(columnMapping || {});

  if (mappingKeys.length > 0) {
    const maxColumn = Math.max.apply(
      null,
      mappingKeys.map((field) => columnLetterToNumber(columnMapping[field]))
    );
    const headers = new Array(maxColumn).fill('');

    mappingKeys.forEach((field) => {
      const index = columnLetterToNumber(columnMapping[field]) - 1;
      headers[index] = field;
    });

    return headers;
  }

  if (Object.keys(mappedRow || {}).length > 0) {
    const columns = Object.keys(mappedRow);
    const maxColumn = Math.max.apply(null, columns.map(columnLetterToNumber));
    const headers = new Array(maxColumn).fill('');

    columns.forEach((column) => {
      const index = columnLetterToNumber(column) - 1;
      headers[index] = column;
    });

    return headers;
  }

  return Object.keys(row || {});
}

function buildRowFromMappedRow(mappedRow) {
  const columns = Object.keys(mappedRow);
  const maxColumn = Math.max.apply(null, columns.map(columnLetterToNumber));
  const row = new Array(maxColumn).fill('');

  columns.forEach((column) => {
    const index = columnLetterToNumber(column) - 1;
    row[index] = mappedRow[column];
  });

  return row;
}

function columnLetterToNumber(column) {
  const normalized = String(column).trim().toUpperCase();
  let result = 0;

  for (let i = 0; i < normalized.length; i++) {
    result = result * 26 + (normalized.charCodeAt(i) - 64);
  }

  return result;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}
