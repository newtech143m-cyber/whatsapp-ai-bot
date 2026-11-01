/**
 * WhatsApp AI Bot — Google Sheets backend (Apps Script)
 *
 * 1. Samee Google Sheet cusub → Extensions → Apps Script → koodkan ku dheji
 * 2. SECRET hoose beddel (isla qiimaha .env → SHEET_SECRET)
 * 3. Run → setup()  (hal mar, ogolaansho sii)
 * 4. Deploy → New deployment → Web app
 *      Execute as: Me   |   Who has access: Anyone
 * 5. URL-ka /exec ku dhammaada ku qor .env → SHEET_WEBAPP_URL
 */
const SECRET = 'beddel-sirtan-123';

const SH_KNOW = 'Aqoonta';      // macluumaadka bot-ku ka jawaabo
const SH_LOG = 'Fariimaha';     // dhammaan fariimaha
const SH_CUST = 'Macaamiisha';  // liiska macaamiisha

function setup() {
  const ss = SpreadsheetApp.getActive();
  const make = (name, headers, rows) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#075E54').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      if (rows) rows.forEach(r => sh.appendRow(r));
    }
    return sh;
  };
  make(SH_KNOW, ['Mawduuc', 'Macluumaad', 'Firfircoon (Haa/Maya)'], [
    ['Magaca ganacsiga', 'Ku qor magaca ganacsigaaga halkan', 'Haa'],
    ['Saacadaha shaqada', 'Sabti – Khamiis, 8:00 subaxnimo – 8:00 fiidnimo', 'Haa'],
    ['Goobta', 'Ku qor cinwaanka / magaalada', 'Haa'],
    ['Adeegyada & qiimaha', 'Tusaale: Adeeg A – 500 ETB, Adeeg B – 1,200 ETB', 'Haa'],
    ['Lacag-bixinta', 'Tusaale: Telebirr / CBE / lacag caddaan', 'Haa'],
    ['Su\'aal: Ma jiraa delivery?', 'Haa, magaalada gudaheeda 100 ETB', 'Haa'],
  ]);
  make(SH_LOG, ['Taariikh', 'Lambar', 'Magac', 'Kee diray', 'Fariin']);
  make(SH_CUST, ['Lambar', 'Magac', 'Markii ugu horreysay', 'Markii ugu dambeysay', 'Tirada fariimaha', 'Fariintii ugu dambeysay']);
  const s1 = ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
}

// ---------------- Keep-alive (Render free) ----------------
// BOT_URL ku qor URL-ka Render-ka, kadib Run → installKeepAlive (hal mar)
const BOT_URL = 'https://whatsapp-ai-bot-xxxx.onrender.com';

function keepAlive() {
  try { UrlFetchApp.fetch(BOT_URL + '/health', { muteHttpExceptions: true }); } catch (e) {}
}
function installKeepAlive() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'keepAlive').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('keepAlive').timeBased().everyMinutes(5).create();
  keepAlive();
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = e.parameter || {};
  if (p.secret !== SECRET) return json_({ ok: false, error: 'Secret khaldan' });
  if (p.action === 'knowledge') return json_(getKnowledge_());
  return json_({ ok: true, msg: 'WhatsApp bot Sheet API waa shaqeynayaa' });
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'JSON khaldan' }); }
  if (b.secret !== SECRET) return json_({ ok: false, error: 'Secret khaldan' });
  if (b.action === 'log') {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { logMessage_(b); } finally { lock.releaseLock(); }
    return json_({ ok: true });
  }
  return json_({ ok: false, error: 'Action lama yaqaan' });
}

function getKnowledge_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH_KNOW);
  if (!sh || sh.getLastRow() < 2) return { ok: true, text: '', count: 0 };
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues();
  const active = rows.filter(r => (r[0] || r[1]) && String(r[2]).trim().toLowerCase() !== 'maya');
  const text = active.map(r => `• ${r[0]}: ${r[1]}`).join('\n');
  return { ok: true, text: text, count: active.length };
}

function logMessage_(b) {
  const ss = SpreadsheetApp.getActive();
  const now = new Date();
  const phone = String(b.phone || '');
  const text = String(b.text || '').slice(0, 5000);
  ss.getSheetByName(SH_LOG).appendRow([now, phone ? "'" + phone : '', b.name || '', b.direction || '', text]);

  if (b.direction !== 'MACMIIL' || !phone) return;
  const sh = ss.getSheetByName(SH_CUST);
  const last = sh.getLastRow();
  const phones = last > 1 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues().map(r => r[0].replace(/\D/g, '')) : [];
  const idx = phones.indexOf(phone);
  if (idx === -1) {
    sh.appendRow(["'" + phone, b.name || '', now, now, 1, text]);
  } else {
    const row = idx + 2;
    const count = Number(sh.getRange(row, 5).getValue()) || 0;
    if (b.name) sh.getRange(row, 2).setValue(b.name);
    sh.getRange(row, 4, 1, 3).setValues([[now, count + 1, text]]);
  }
}
