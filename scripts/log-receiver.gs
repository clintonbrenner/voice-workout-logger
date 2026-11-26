/**
 * Lift Log – Log Receiver (Google Apps Script)
 *
 * Paste this into the "Lift Log – Debug Log" Google Sheet:
 *   Extensions → Apps Script → replace everything with this → Save,
 *   then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * The Lift Log app sends its Diagnostics log lines here and they're added as rows,
 * so Claude can read them without copy/paste. Only debug lines are sent
 * (timings, errors, what was heard) — not your workout history.
 */
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var now = new Date();
  var rows = (data.lines || []).slice(0, 300).map(function (l) {
    return [now, String(l.t || ''), String(data.version || ''), String(data.mode || ''), String(l.msg || '').slice(0, 2000)];
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('Lift Log log receiver is running.');
}
