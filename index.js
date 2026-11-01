// =============================================================
//  WhatsApp AI Bot — AI (Gemini/Groq/OpenAI) + Google Sheets + Admin Dashboard
//  Online: Render + Supabase  (eeg README.md)
// =============================================================
import 'dotenv/config';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import * as store from './store.js';
import { MECO_TOOLS, ADMIN_PROMPT, CUSTOMER_PROMPT, SECRETARY_PROMPT, SOMALI_STYLE, runAgent } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// AI provider: zen (OpenCode Zen) | gemini | groq | openrouter | openai | claude
// Dashboard-ka (Habaynta → AI) ayaa laga beddeli karaa; env-ku waa default.
const ENV_PROVIDER = (process.env.AI_PROVIDER || 'zen').toLowerCase();
const PROVIDERS = {
  pollinations: { model: 'gemini,openai,openai-large,mistral', base: 'https://text.pollinations.ai/openai', keyless: true },   // bilaash, key la'aan (GPT)
  zen:        { model: 'deepseek-v4-flash-free,qwen3.6-plus-free,mimo-v2.5-free,big-pickle', base: 'https://opencode.ai/zen/v1' },
  gemini:     { model: 'gemini-2.5-flash' },
  groq:       { model: 'llama-3.3-70b-versatile', base: 'https://api.groq.com/openai/v1' },
  openrouter: { model: 'meta-llama/llama-3.3-70b-instruct:free,nousresearch/hermes-3-llama-3.1-405b:free,openrouter/free,openai/gpt-oss-120b:free', base: 'https://openrouter.ai/api/v1' },
  openai:     { model: 'gpt-4o-mini', base: 'https://api.openai.com/v1' },
  claude:     { model: 'claude-haiku-5-5' },
};
function aiCfg() {
  const st = (typeof db !== 'undefined' && db.settings) || {};
  let provider = String(st.aiProvider || ENV_PROVIDER).toLowerCase();
  if (!PROVIDERS[provider]) provider = 'zen';
  const sameAsEnv = provider === ENV_PROVIDER;
  const key = st.aiKey || (sameAsEnv ? process.env.AI_API_KEY || '' : '');
  const modelStr = st.aiModel || (sameAsEnv && process.env.AI_MODEL) || PROVIDERS[provider].model;
  return { provider, key, base: PROVIDERS[provider].base, models: modelStr.split(',').map((x) => x.trim()).filter(Boolean) };
}
const stripThink = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
// Model-yada isku day mid mid — haddii mid xaddid (429) ama khalad gaaro, kan xiga
// Macaamiisha (jawaab qoraal oo kaliya, tools la'aan): model-yo af-Soomaali ku wanaagsan ayaa marka hore la isku dayaa
const CUSTOMER_MODELS = { openrouter: ['google/gemma-3-27b-it:free', 'meta-llama/llama-3.3-70b-instruct:free'] };
// Gemini (af-Soomaali aad u fiican) — model kasta xaddid bilaash ah oo gooni ah ayuu leeyahay
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
function geminiKey() {
  if (db.settings.geminiKey) return db.settings.geminiKey;
  const k = process.env.GEMINI_API_KEY || '';
  if (k) return k;
  return /^AIza/.test(process.env.AI_API_KEY || '') ? process.env.AI_API_KEY : '';
}
// 🔬 Tijaabada AI-yada bilaashka ah: bot-ku wuu tijaabiyaa (boot + 3 saac kasta), kuwa shaqeeya ayaa la hormariyaa
const DIAG_CANDIDATES = [
  { provider: 'pollinations', key: 'free', base: 'https://text.pollinations.ai/openai', model: 'openai' },   // ✅ sax + af-Soomaali fiican (1 jawaab / 45s)
  { provider: 'openrouter', base: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },              // kayd (tayo hoose)
];
async function runAiDiag() {
  const out = [], orKey = db.settings.aiProvider === 'openrouter' ? db.settings.aiKey : '';
  for (const c0 of DIAG_CANDIDATES) {
    const c = { ...c0, key: c0.provider === 'openrouter' ? orKey : c0.key };
    if (!c.key) continue;
    const t0 = Date.now();
    try {
      const a = await callAI(c, 'Ku jawaab af-Soomaali sax ah, hal jumlo oo kooban.', [{ role: 'user', content: 'Goorma ayuu dhashay Nabi Maxamed (scw), xaggeese?' }]);
      out.push({ p: c.provider, m: c.model, ok: true, ms: Date.now() - t0, a: stripThink(a).slice(0, 160) });
    } catch (e) { out.push({ p: c.provider, m: c.model, ok: false, ms: Date.now() - t0, e: String(e.message).slice(0, 120) }); }
    await new Promise((r) => setTimeout(r, c.provider.startsWith('poll') ? 4000 : 1500));
  }
  db.settings.aiDiag = { at: new Date().toISOString(), results: out }; saveDb();
  console.log('🔬 AI diag:', out.filter((x) => x.ok).map((x) => x.p + '/' + x.m).join(', ') || 'midna ma shaqeyn');
}
setTimeout(() => runAiDiag().catch(() => {}), 25000);

function aiChain(forCustomer) {
  // Haddii maamuluhu doortay (aiPrefer: "provider/model,…") ama tijaabadu jirto → kuwa shaqeeyay oo kaliya, kan ugu dhakhsaha badan marka hore
  const pref = String(db.settings.aiPrefer || '').split(',').map((x) => x.trim()).filter(Boolean);
  const diag = (db.settings.aiDiag?.results || []).filter((x) => x.ok);
  const orKey = db.settings.aiProvider === 'openrouter' ? db.settings.aiKey : '';
  const mk = (p, m) => { const c = DIAG_CANDIDATES.find((x) => x.provider === p && x.model === m); return c ? { ...c, key: p === 'openrouter' ? orKey : c.key } : null; };
  if (pref.length) { const l = pref.map((x) => { const i = x.indexOf('/'); return mk(x.slice(0, i), x.slice(i + 1)); }).filter((c) => c && c.key); if (l.length) return l; }
  const chain = [mk('pollinations', 'openai')];
  const gk0 = geminiKey(); if (gk0) chain.push(...GEMINI_MODELS.map((model) => ({ provider: 'gemini', key: gk0, model })));
  // openrouter/free: tayo hoose (Ingiriis/fikir) → lama isticmaalo; haddii Pollinations mashquul yahay, jawaab kayd ah ayaa la bixinayaa
  if (chain.length) return chain;
  // 1) Pollinations — bilaash, key la'aan (GPT family, af-Soomaali wanaagsan)
  if (db.settings.pollinations !== false) chain.push(...PROVIDERS.pollinations.model.split(',').map((model) => ({ provider: 'pollinations', key: 'free', base: PROVIDERS.pollinations.base, model })));
  const gk = geminiKey();
  if (gk) chain.push(...GEMINI_MODELS.map((model) => ({ provider: 'gemini', key: gk, model })));
  const cfg = aiCfg();
  if (cfg.key && cfg.provider !== 'pollinations' && !(cfg.provider === 'gemini' && cfg.key === gk)) {
    const models = forCustomer && !db.settings.aiModel && CUSTOMER_MODELS[cfg.provider] ? [...CUSTOMER_MODELS[cfg.provider], ...cfg.models] : cfg.models;
    chain.push(...models.map((model) => ({ ...cfg, model })));
  }
  return chain;
}
const cooldown = new Map();   // model → waqtiga la isku dayi karo (429 kadib)
async function tryModels(fn, forCustomer) {
  const chain = aiChain(forCustomer);
  if (!chain.length) throw new Error('AI lama helin — Dashboard → Habaynta → AI');
  let last;
  const ready = chain.filter((c) => (cooldown.get(c.provider + c.model) || 0) < Date.now());
  for (const c of (ready.length ? ready : chain)) {
    try { return stripThink(await fn(c)); }
    catch (e) {
      last = e; console.error(`AI ${c.provider}/${c.model}:`, e.message);
      db.settings.aiErrors = [{ t: new Date().toISOString(), m: c.provider + '/' + c.model, e: String(e.message).slice(0, 140) }, ...(db.settings.aiErrors || [])].slice(0, 15); saveDb();
      if (/402|limit reached/i.test(e.message) && c.provider === 'pollinations') pollNext = Date.now() + 47000;
      else if (/429|quota|rate|exhaust|queue/i.test(e.message)) cooldown.set(c.provider + c.model, Date.now() + 10 * 60 * 1000);
    }
  }
  throw last;
}
const SHEET_URL = (process.env.SHEET_WEBAPP_URL || '').trim();
const SHEET_SECRET = process.env.SHEET_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

if (!process.env.AI_API_KEY) console.warn('⚠️ AI_API_KEY env ma jiro — dashboard-ka (Habaynta → AI) ka geli');
if (ADMIN_PASSWORD.length < 6) {
  console.error('❌ ADMIN_PASSWORD geli (ugu yaraan 6 xaraf) — dashboard-ku waa online, waa in la ilaaliyaa');
  process.exit(1);
}
const logger = pino({ level: 'silent' });

// -------------------------------------------------------------
//  Kaydka xogta (data/db.json)
// -------------------------------------------------------------
const DEFAULT_PROMPT = `Waxaad tahay kaaliye WhatsApp ah oo ku hadla magaca milkiilaha lambarkan.
- Ku jawaab luqadda macmiilku ku qoro (inta badan Soomaali). Noqo mid edeb leh, kooban, oo saaxiibtinimo leh.
- Jawaabaha ha dheeraan — WhatsApp waa sheeko; 1-4 jumlo ayaa ku filan.
- Isticmaal oo kaliya macluumaadka hoos ku qoran. Wax aadan hubin ha sameyn (qiimo, ballan, ama ballanqaad).
- Haddii aadan jawaabta garanayn, ama macmiilku rabo inuu qof la hadlo, ama arrin muhiim ah (lacag, cabasho) tahay,
  ku dar calaamadda [ADMIN] jawaabtaada dhammaadkeeda, oo u sheeg in milkiiluhu dhowaan ku soo jawaabi doono.`;

let db = {
  settings: {
    botEnabled: true,
    systemPrompt: DEFAULT_PROMPT,
    pauseMinutes: 30,      // markaad adigu gacanta ka jawaabto, bot-ku intee buu iska joojiyaa
    batchSeconds: 4,       // sug ilbiriqsiyo si fariimaha isku xiga mar loogu jawaabo
    maxAgeMinutes: 10,     // ha ka jawaabin fariimo ka da' weyn tan
    ignoreNumbers: '',     // lambarro bot-ku iska dhaafo (comma)
    notifyNumbers: '',     // MECO: lambarada lacag-bixinta loogu sheegayo (comma)
    notifySecret: '',      // MECO: sirta /api/notify (si toos ah ayaa loo sameeyaa)
    customerReceipts: false, // MECO: rasiid WhatsApp ah u dir macmiilka
    appAutoReply: true,    // MECO: AI-gu ha ka jawaabo fariimaha app-ka
    secretaryFor: 'Duale', secretaryFor2: 'Abdinur',
    useAI: false,          // false = maskaxda af-Soomaaliga ee MECO (key la'aan); true = AI dibadeed (Gemini/OpenRouter)
    mecoUrl: 'https://script.google.com/macros/s/AKfycbzOAYE9TIE8-xCGYLQEkiJljVAz-pHl5rIaNaB66fEO_lobtmf9R5N-5Ju7axc0H9A_/exec',
  },
  chats: {},
};
// Xogta waxa laga soo rarayaa Supabase; isbeddellada waxa la kaydiyaa 2 ilbiriqsi kasta
const savedSettings = await store.loadSettings();
db.settings = { ...db.settings, ...(savedSettings || {}) };
db.chats = await store.loadChats();
if (!db.settings.notifySecret) {
  db.settings.notifySecret = crypto.randomBytes(12).toString('hex');
  await store.saveSettings(db.settings);
}
console.log(`🗄️  Supabase: ${Object.keys(db.chats).length} sheeko ayaa la soo raray`);


const dirtyChats = new Set();
let settingsDirty = false;
function saveDb(jid) {
  if (jid) dirtyChats.add(jid);
  else settingsDirty = true;
}
let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    if (settingsDirty) { settingsDirty = false; await store.saveSettings(db.settings); }
    if (dirtyChats.size) {
      const jids = [...dirtyChats]; dirtyChats.clear();
      const list = jids.map((j) => db.chats[j]).filter(Boolean);
      try { await store.saveChats(list); } catch (e) { jids.forEach((j) => dirtyChats.add(j)); throw e; }
    }
  } catch (e) { console.error('Supabase save error:', e.message); }
  finally { flushing = false; }
}
setInterval(flush, 2000);
db.settings.running = { commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7), startedAt: new Date().toISOString() };
saveDb();

const chatKey = (sid, jid) => (!sid || sid === 'main' ? jid : sid + '|' + jid);
function getChat(jid, name, phone, sid = 'main') {
  const key = chatKey(sid, jid);
  if (!db.chats[key]) {
    db.chats[key] = { key, sid, jid, name: name || '', phone: phone || '', messages: [], pausedUntil: 0,
      manualPause: false, needsHuman: false, unread: 0, lastTs: Date.now() };
  }
  const c = db.chats[key];
  if (!c.key) c.key = key;
  if (name && !c.name) c.name = name;
  if (phone && !c.phone) c.phone = phone;
  return c;
}
function addMessage(chat, role, text) {
  chat.messages.push({ role, text, ts: Date.now() });
  if (chat.messages.length > 300) chat.messages = chat.messages.slice(-300);
  chat.lastTs = Date.now();
  saveDb(chat.key || chat.jid);
}
function isPaused(chat) {
  return chat.manualPause || chat.pausedUntil > Date.now();
}

// -------------------------------------------------------------
//  Google Sheets (Apps Script Web App)
// -------------------------------------------------------------
let knowledge = { text: '', updated: null, error: null };

async function loadKnowledge() {
  if (!SHEET_URL) return;
  try {
    const r = await fetch(`${SHEET_URL}?action=knowledge&secret=${encodeURIComponent(SHEET_SECRET)}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Sheet error');
    knowledge = { text: j.text || '', updated: new Date().toISOString(), error: null, rows: j.count };
    console.log(`📄 Aqoonta Sheet-ka la soo raray (${j.count} saf)`);
  } catch (e) {
    knowledge.error = e.message;
    console.error('Sheet knowledge error:', e.message);
  }
}

function logToSheet(payload) {
  if (!SHEET_URL) return;
  fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ secret: SHEET_SECRET, action: 'log', ...payload }),
  }).catch((e) => console.error('Sheet log error:', e.message));
}

// -------------------------------------------------------------
//  AI (Gemini / Groq / OpenRouter / OpenAI / Claude)
// -------------------------------------------------------------
function buildHistory(chat) {
  const out = [];
  for (const m of chat.messages.slice(-30)) {
    if (!m.text) continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n' + m.text;
    else out.push({ role, content: m.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// Macmiilka WhatsApp-ka → xogtiisa MECO (lambarka telefoonka), 5 daqiiqo cache
const ctxCache = new Map();
async function mecoContext(phone) {
  if (!phone || !db.settings.mecoUrl) return null;
  const c = ctxCache.get(phone);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.ctx;
  const r = await mecoCall('customer_context', { phone });
  const ctx = r && r.found ? r.context : null;
  ctxCache.set(phone, { at: Date.now(), ctx });
  return ctx;
}

async function askAI(chat) {
  const messages = buildHistory(chat);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  const now = new Date().toLocaleString('en-GB', { timeZone: process.env.TZ_NAME || 'Africa/Addis_Ababa' });
  const ctx = await mecoContext(chat.phone).catch(() => null);
  const system = [
    db.settings.systemPrompt,
    SOMALI_STYLE,
    ctx ? `\n${CUSTOMER_PROMPT}\nMacmiilkan waa macmiil MECO ah. ACCOUNT (xogtiisa dhabta ah — ku jawaab si sax ah):\n${JSON.stringify(ctx, null, 1).slice(0, 6000)}` : '',
    `\nWaqtiga hadda: ${now}`,
    chat.name ? `Magaca macmiilka (WhatsApp): ${chat.name}` : '',
    knowledge.text ? `\n=== MACLUUMAADKA GANACSIGA (Google Sheet) ===\n${knowledge.text}` : '',
  ].filter(Boolean).join('\n');

  return tryModels((cfg) => callAI(cfg, system, messages), true);
}

async function postJSON(url, headers, body) {
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 45000);
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// Pollinations: hal jawaab 45-kii ilbiriqsi (IP kasta) → waqti ayaa loo qabsanayaa; haddii sugitaanku > 55s, kan xiga (kayd)
let pollNext = 0;
async function pollSlot() {
  const now = Date.now(), start = Math.max(now, pollNext);
  if (start - now > 55000) throw new Error('pollinations: mashquul (xaddid 45s)');
  pollNext = start + 47000;
  if (start > now) await new Promise((r) => setTimeout(r, start - now));
}
async function callAI({ provider, model: AI_MODEL, key: AI_KEY, base }, system, messages) {
  if (provider === 'pollinations') await pollSlot();
  if (provider === 'pollget') {   // Pollinations qaabka GET (key la'aan)
    const convo = messages.slice(-8).map((m) => (m.role === 'user' ? 'Qofka: ' : 'Adiga: ') + m.content).join('\n');
    const url = `https://text.pollinations.ai/${encodeURIComponent(convo + '\nAdiga:')}?model=${encodeURIComponent(AI_MODEL)}&system=${encodeURIComponent(system.slice(0, 3500))}&private=true`;
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      const t = (await r.text()).trim();
      if (!r.ok) throw new Error(`${r.status}: ${t.slice(0, 160)}`);
      if (!t || /^\s*[{<]/.test(t)) throw new Error('jawaab khaldan: ' + t.slice(0, 120));
      return t;
    } finally { clearTimeout(tm); }
  }
  if (provider === 'gemini') {
    const j = await postJSON(
      `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`,
      { 'x-goog-api-key': AI_KEY },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 800, temperature: 0.6 },
      });
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) throw new Error('Gemini jawaab ma soo celin (' + (j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || '?') + ')');
    return text;
  }
  if (provider === 'claude') {
    const j = await postJSON('https://api.anthropic.com/v1/messages',
      { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
      { model: AI_MODEL, max_tokens: 600, system, messages });
    return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }
  // OpenAI-compatible: zen, groq, openrouter, openai
  const j = await postJSON(`${base}/chat/completions`,
    { Authorization: `Bearer ${AI_KEY}`, 'HTTP-Referer': 'https://meco-power-supply.vercel.app', 'X-Title': 'MECO WhatsApp Bot' },
    { model: AI_MODEL, max_tokens: 600, temperature: 0.6, messages: [{ role: 'system', content: system }, ...messages] });
  const text = stripThink(j.choices?.[0]?.message?.content || '');
  if (!text) throw new Error('jawaab madhan');
  return text;
}

// -------------------------------------------------------------
//  WhatsApp (Baileys)
// -------------------------------------------------------------
// Laba WhatsApp hal server: main = WhatsApp-kaaga (1), s2 = WhatsApp 2 (rasiidyada + ogeysiisyada + macaamiisha)
const SES = {
  main: { id: 'main', label: 'WhatsApp 1', sock: null, wa: { connected: false, qr: null, me: null, lastError: null } },
  s2:   { id: 's2', label: 'WhatsApp 2', sock: null, wa: { connected: false, qr: null, me: null, lastError: null } },
};
let sock = null;                 // main (compat)
const wa = SES.main.wa;          // main (compat)
const ses = (sid) => SES[sid] || SES.main;
const outSid = () => (SES.s2.wa.connected ? 's2' : 'main');   // rasiidyada/ogeysiisyada: WhatsApp 2 haddii uu xiran yahay
const sesNumbers = () => Object.values(SES).flatMap((x) => [x.sock?.user?.id, x.sock?.user?.lid]).filter(Boolean).map((j) => String(j).split('@')[0].split(':')[0]);
const ourIds = new Set();          // fariimaha aan annagu dirnay (si looga sooco kuwa telefoonka)
const pending = new Map();         // jid -> timer (batching)
const busy = new Set();

const newId = () => '3EB0' + crypto.randomBytes(9).toString('hex').toUpperCase();

async function sendText(jid, text, sid = 'main') {
  const x = ses(sid === 'out' ? outSid() : sid);
  if (!x.sock || !x.wa.connected) throw new Error(x.label + ' ma xirna');
  const id = newId();
  ourIds.add(id);
  setTimeout(() => ourIds.delete(id), 10 * 60 * 1000);
  await x.sock.sendMessage(jid, { text }, { messageId: id });
}
const presence = (chatOrSid, state, jid) => ses(typeof chatOrSid === 'string' ? chatOrSid : chatOrSid?.sid).sock?.sendPresenceUpdate(state, jid).catch(() => {});

function extractText(m) {
  const msg = m.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  const t = inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption
    || inner.videoMessage?.caption || inner.documentMessage?.caption
    || inner.buttonsResponseMessage?.selectedDisplayText || inner.listResponseMessage?.title;
  if (t) return t;
  if (inner.imageMessage) return '[Sawir ayuu soo diray]';
  if (inner.audioMessage) return '[Fariin cod ah ayuu soo diray]';
  if (inner.videoMessage) return '[Muuqaal ayuu soo diray]';
  if (inner.documentMessage) return '[Dukumenti ayuu soo diray]';
  if (inner.stickerMessage) return '[Sticker]';
  if (inner.locationMessage) return '[Goob (location) ayuu soo diray]';
  if (inner.contactMessage) return '[Contact ayuu soo diray]';
  return null; // reactions, protocol messages iwm.
}

const phoneOf = (key) => {
  const pn = [key.remoteJidAlt, key.remoteJid].find((j) => j && j.endsWith('@s.whatsapp.net'));
  return pn ? pn.split('@')[0].split(':')[0] : '';
};
const skipJid = (jid) => !jid || jid.endsWith('@g.us') || jid === 'status@broadcast'
  || jid.endsWith('@broadcast') || jid.endsWith('@newsletter');

function scheduleReply(jid) {
  clearTimeout(pending.get(jid));
  pending.set(jid, setTimeout(() => { pending.delete(jid); replyTo(jid); },
    Math.max(1, db.settings.batchSeconds) * 1000));
}

// AI-gu haddii uu fashilmo: macmiilka u sheeg in fariinta la helay, adigana WhatsApp kuugu sheeg sababta
let lastAiAlert = 0;
async function aiFailed(chat, jid, e) {
  db.settings.lastAiError = `${new Date().toISOString()} · ${e.message}`.slice(0, 400); saveDb();
  try {
    if (!chat.fallbackAt || Date.now() - chat.fallbackAt > 30 * 60 * 1000) {
      const t = 'Waad salaaman tahay! Fariintaada waa la helay ✅. Dhowaan ayaa laguu soo jawaabi doonaa.';
      await sendText(chat.jid, t, chat.sid); addMessage(chat, 'assistant', t); chat.fallbackAt = Date.now(); saveDb(chat.key || chat.jid);
    }
    if (Date.now() - lastAiAlert > 10 * 60 * 1000) {
      lastAiAlert = Date.now();
      await toSelf(chat.sid, `⚠️ *AI-gu kama jawaabin* ${chat.name || chat.phone || ''}\nSabab: ${e.message}${/data policy|No endpoints/i.test(e.message) ? '\n\n👉 OpenRouter: fur openrouter.ai/settings/privacy oo shid "free model publication / training".' : /429|rate|limit|quota/i.test(e.message) ? '\n\n👉 Xaddidkii bilaashka ayaa dhammaaday — sug ama credit ku shub.' : /401|auth|key/i.test(e.message) ? '\n\n👉 API key-ga hubi (dashboard → Habaynta → AI).' : ''}`);
    }
  } catch { /* ignore */ }
}

async function replyTo(key) {
  const chat = db.chats[key];
  if (!chat || !db.settings.botEnabled || isPaused(chat)) return;
  if (busy.has(key)) return scheduleReply(key);
  busy.add(key);
  const jid = chat.jid || key;
  try {
    presence(chat, 'composing', jid);
    let answer = await customerEngine(chat, key);
    if (!answer) return;
    // bot-ka waxa la joojiyay inta AI-gu ka fikirayay?
    if (!db.settings.botEnabled || isPaused(chat)) return;
    let escalate = false;
    if (answer.includes('[ADMIN]')) {
      escalate = true;
      answer = answer.replace(/\[ADMIN\]/g, '').trim();
    }
    if (answer) {
      await sendText(jid, answer, chat.sid);
      addMessage(chat, 'assistant', answer);
      logToSheet({ phone: chat.phone, name: chat.name, direction: 'BOT', text: answer });
    }
    if (escalate) {
      chat.needsHuman = true;
      chat.manualPause = true;
      saveDb(key);
      console.log(`🙋 ${chat.name || chat.phone} wuxuu u baahan yahay adiga (bot-ka waa la hakiyay)`);
    }
  } catch (e) {
    console.error('Reply error:', e.message);
    aiFailed(chat, jid, e);
  } finally {
    busy.delete(key);
    presence(chat, 'paused', jid);
  }
}

async function handleMessage(m, type, sid = 'main') {
  const jid = m.key.remoteJid;
  if (skipJid(jid)) return;
  if (ourIds.has(m.key.id)) return;              // fariin bot-ku diray (WhatsApp 1 ama 2)
  const text = extractText(m);
  if (!text) return;
  const phone = phoneOf(m.key);

  // MECO AI agent: "Message yourself", lambarada maamulaha, ama labada WhatsApp ee bot-ka midba midka kale
  if (isAdminMsg(m, phone, sid)) {
    if (type !== 'notify') return;
    return handleAdmin(jid, text, m, sid);
  }
  // fariin aad adigu (telefoonka) u dirtay WhatsApp-ka kale ee bot-ka → iska dhaaf
  if (m.key.fromMe && (sesNumbers().includes(userPart(jid)) || (phone && sesNumbers().includes(phone)))) return;
  const tsMs = Number(m.messageTimestamp || 0) * 1000 || Date.now();

  if (m.key.fromMe) {
    if (ourIds.has(m.key.id)) return;           // bot-ka ama dashboard-ka ayaa diray
    if (type !== 'notify') return;
    const chat = getChat(jid, '', phone, sid);
    // Amar: "AI u jawaab" / "bot u jawaab" → bot-ku ha sii wado sheekada (aamus la'aan)
    if (/\b(ai|bot|botka|bot-ka)\b/i.test(text) && /jawaab|qabo|caawi|la hadal|la sheekee|sii wad/i.test(text)) {
      chat.pausedUntil = 0; chat.manualPause = false; chat.needsHuman = false; chat.aiChat = true; chat.secGreetAt = chat.secGreetAt || Date.now(); saveDb(chat.key);
      if (chat.messages.length && chat.messages[chat.messages.length - 1].role === 'user') scheduleReply(chat.key);
      return;
    }
    // Adiga ayaa telefoonka ka jawaabay → bot-ku ha iska aamuso muddo
    addMessage(chat, 'owner', text);
    chat.pausedUntil = Date.now() + db.settings.pauseMinutes * 60 * 1000;
    chat.needsHuman = false;
    saveDb(chat.key);
    logToSheet({ phone: chat.phone, name: chat.name, direction: 'ADIGA', text });
    return;
  }

  if (type !== 'notify') return;
  const chat = getChat(jid, m.pushName, phone, sid);
  if (m.pushName) chat.name = m.pushName;
  addMessage(chat, 'user', text);
  chat.unread = (chat.unread || 0) + 1;
  logToSheet({ phone: chat.phone, name: chat.name, direction: 'MACMIIL', text });

  const ignored = db.settings.ignoreNumbers.split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);
  if (ignored.includes(chat.phone)) return;
  if (Date.now() - tsMs > db.settings.maxAgeMinutes * 60 * 1000) return;
  scheduleReply(chat.key);
}

async function startWhatsApp(sid = 'main') {
  const S = ses(sid), prefix = sid === 'main' ? '' : sid + ':';
  const { state, saveCreds } = await store.useSupabaseAuthState(prefix);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* default */ }
  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  S.sock = sock;
  setMainSock();
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    if (S.sock !== sock) return;                  // socket hore
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      S.wa.qr = await QRCode.toDataURL(qr);
      console.log(`📱 ${S.label}: QR code diyaar`);
    }
    if (connection === 'open') {
      Object.assign(S.wa, { connected: true, qr: null, me: sock.user, lastError: null, pairCode: null });
      setTimeout(flushNotifyQueue, 2000);
      console.log(`✅ ${S.label} waa ku xirmay: ${sock.user?.id}`);
    }
    if (connection === 'close') {
      S.wa.connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      S.wa.lastError = lastDisconnect?.error?.message || String(code);
      if (code === DisconnectReason.loggedOut) {
        console.log(`🚪 ${S.label}: waa laga baxay — QR cusub`);
        S.wa.me = null;
        await store.clearAuth(prefix);
      } else {
        console.log(`🔄 ${S.label}: xiriirka ayaa go'ay, dib ayaa loo xirayaa...`, S.wa.lastError);
      }
      // WhatsApp 2 oo aan weli la xirin: si tartiib ah dib u bilow (QR cusub)
      setTimeout(() => startWhatsApp(sid), sid !== 'main' && !S.wa.me ? 15000 : 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      try { await handleMessage(m, type, sid); } catch (e) { console.error(`Message error (${sid}):`, e.message); }
    }
  });
}
function setMainSock() { sock = SES.main.sock; }

// -------------------------------------------------------------
//  MECO AI agent (maamulaha)
// -------------------------------------------------------------
const userPart = (j) => String(j || '').split('@')[0].split(':')[0];
function isAdminMsg(m, phone, sid = 'main') {
  const x = ses(sid).sock;
  const me = [x?.user?.id, x?.user?.lid].filter(Boolean).map(userPart);
  if (m.key.fromMe) return me.includes(userPart(m.key.remoteJid)) || (m.key.remoteJidAlt && me.includes(userPart(m.key.remoteJidAlt)));
  // maamulaha: lambarada Habaynta + labada lambar ee bot-ka (WhatsApp 1 ↔ 2)
  const admins = [...String(db.settings.notifyNumbers || '').split(',').map(toJid).filter(Boolean).map(userPart), ...sesNumbers()];
  return (!!phone && admins.includes(phone)) || admins.includes(userPart(m.key.remoteJid));
}

async function mecoCall(tool, args) {
  if (!db.settings.mecoUrl) return { error: 'MECO URL lama gelin (Habaynta → MECO)' };
  try {
    const r = await fetch(db.settings.mecoUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ wa: db.settings.notifySecret, tool, args }) });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { return { error: 'MECO jawaab khaldan — Code.gs cusub ma la deploy gareeyay? (' + txt.slice(0, 80) + ')' }; }
    return j.ok ? { now: j.now, ...j.data } : { error: j.error };
  } catch (e) { return { error: 'MECO lama gaari karo: ' + e.message }; }
}

function receiptText(d) {
  const p = d.payment, c = d.customer;
  return [
    '⚡ *MECO POWER SUPPLY*',
    '🧾 *RASIID LACAG-BIXIN*',
    '',
    `Rasiid: *${p.Receipt}*`,
    `Macmiil: ${c.Name}`,
    `Lacag: *${money(p.Amount)}*`,
    `Hab: ${p.Method}`,
    `Taariikh: ${p.Date} ${p.Time || ''}`,
    p.Staff ? `Qaaday: ${p.Staff}` : '',
    `Deynta haray: ${money(c.Due)}`,
    '',
    'Mahadsanid! ✅',
    '_Powering Mustaxiil._',
  ].filter((x) => x !== '').join('\n');
}

async function execTool(name, args) {
  if (name === 'send_receipt') {
    const d = await mecoCall('receipt', args);
    if (d.error || d.ambiguous) return d;
    const jid = toJid(d.customer.Phone);
    if (!jid) return { error: `${d.customer.Name} lambar telefoon kuma diiwaangashana MECO` };
    if (!ses(outSid()).wa.connected) return { error: 'WhatsApp ma xirna' };
    await sendText(jid, receiptText(d), 'out');   // WhatsApp 2 (haddii uu xiran yahay)
    return { sent: true, to: d.customer.Phone, customer: d.customer.Name, receipt: d.payment.Receipt, amount: d.payment.Amount };
  }
  if (name === 'send_pdf') {
    const d = await mecoCall('pdf', { kind: args.kind || 'monthly', from: args.from, to: args.to, filter: args.filter });
    if (d.error) return d;
    if (!d.b64) return { error: 'PDF lama helin' };
    const jid = currentAdminJid || adminJids()[0];
    const id = newId(); ourIds.add(id);
    await ses(currentAdminSid).sock.sendMessage(jid, { document: Buffer.from(d.b64, 'base64'), mimetype: 'application/pdf', fileName: d.name || 'MECO.pdf' }, { messageId: id });
    return { sent: true, file: d.name };
  }
  if (name === 'reply_customer_app') return mecoCall('chat_reply', { ticketNo: args.ticketNo, query: args.query, body: args.message, from: 'admin' });
  if (!MECO_TOOLS.some((t) => t.name === name)) return { error: 'Tool lama yaqaan: ' + name };
  return mecoCall(name, args);
}

// ---- Fariimaha macaamiisha app-ka MECO → WhatsApp-ka maamulaha + AI jawaab → app-ka
// Cidda ogeysiisyada heleysa: lambarada Habaynta; haddii kale WhatsApp 1 (kaaga). Waxaa laga diraa WhatsApp 2 haddii uu xiran yahay (cod/pop-up ayaad helaysaa).
function adminJids() {
  const l = String(db.settings.notifyNumbers || '').split(',').map(toJid).filter(Boolean);
  if (!l.length && SES.main.sock?.user?.id) l.push(userPart(SES.main.sock.user.id) + '@s.whatsapp.net');
  return l;
}
// 🔒 Arrimaha gaarka ah: kaliya milkiilaha lambarkaas ("Message yourself" ee isla WhatsApp-kaas) — cid kale ma arkayso
async function toSelf(sid, text) {
  const x = ses(sid); const me = x.sock?.user?.id;
  if (!me || !x.wa.connected) return;
  try { await sendText(userPart(me) + '@s.whatsapp.net', text, sid); } catch { /* ignore */ }
}
// 📱 Arrimaha MECO oo kaliya (lacag-bixin, xisaab-xir, fariimaha app-ka MECO) → lambarada ogeysiiska MECO
async function toAdmins(text) {
  if (!ses(outSid()).wa.connected) { adminJids().forEach((jid) => notifyQueue.push({ jid, text })); return; }
  for (const jid of adminJids()) { try { await sendText(jid, text, 'out'); } catch (e) { notifyQueue.push({ jid, text }); } }
}
const appFallbackAt = new Map();
async function appFallback(x) {
  if (Date.now() - (appFallbackAt.get(x.ticketId) || 0) < 30 * 60 * 1000) return;
  appFallbackAt.set(x.ticketId, Date.now());
  await mecoCall('chat_reply', { ticketId: x.ticketId, body: 'Fariintaada waa la helay ✅. Maamulaha ayaa dhowaan kuu soo jawaabi doona.', from: 'bot' });
}
async function handleAppMessage(x) {
  const who = `${x.customer || 'Macmiil'}${x.phone ? ' · ' + x.phone : ''}`;
  const tag = '📱 *APP-KA MECO* · ' + (x.kind === 'fault' ? '🛠 CILAD · ' : x.escalate ? '🙋 ' : '');
  await toAdmins(`${tag}*${x.customer || 'Macmiil'}* — app-ka MECO\n📞 ${x.phone || '—'} · ${x.ticketNo}\n\n${x.text}${x.answered ? `\n\n🤖 _Bot-ku wuxuu ugu jawaabay:_\n${x.answered}` : ''}\n\n_↩️ Reply garee fariintan si aad ugu jawaabto app-ka._`);
  if (x.answered) return;                       // MECO ayaa horay uga jawaabay (salaan, deyn, rasiid, cilad…)
  if (db.settings.appAutoReply === false) return appFallback(x);
  // AI jawaab (xogta macmiilkan oo kaliya)
  const hist = [];
  for (const h of (x.history || []).slice(-12)) {
    const role = h.role === 'user' ? 'user' : 'assistant';
    const last = hist[hist.length - 1];
    if (last && last.role === role) last.content += '\n' + h.text; else hist.push({ role, content: String(h.text || '') });
  }
  while (hist.length && hist[0].role !== 'user') hist.shift();
  if (!hist.length || hist[hist.length - 1].role !== 'user') hist.push({ role: 'user', content: x.text });
  const now = new Date().toLocaleString('en-GB', { timeZone: process.env.TZ_NAME || 'Africa/Addis_Ababa', hour12: false });
  const system = CUSTOMER_PROMPT + `\nWaqtiga hadda: ${now}\nMagaca macmiilka: ${x.customer}\nACCOUNT (xogta macmiilkan):\n${JSON.stringify(x.context || {}, null, 1).slice(0, 6000)}`;
  let answer;
  try { answer = await tryModels((cfg) => callAI(cfg, system, hist), true); }
  catch (e) {
    console.error('App AI error:', e.message);
    db.settings.lastAiError = `${new Date().toISOString()} · ${e.message}`.slice(0, 400); saveDb();
    await appFallback(x);
    return toAdmins(`⚠️ AI-gu kama jawaabin ${who} (${x.ticketNo}): ${e.message}\n_Macmiilka waxaa loo sheegay in fariinta la helay. Reply garee fariinta kore si aad adigu ugu jawaabto._`);
  }
  const escalate = /\[ADMIN\]/i.test(answer);
  answer = answer.replace(/\[ADMIN\]/gi, '').trim();
  if (!answer) return;
  const r = await mecoCall('chat_reply', { ticketId: x.ticketId, body: answer, from: 'bot' });
  await toAdmins(`🤖 *MECO Bot → ${x.customer}* (${x.ticketNo})\n${answer}${r.error ? '\n\n⚠️ App-ka lama gaarsiin: ' + r.error : ''}${escalate ? '\n\n🙋 *Wuxuu u baahan yahay adiga* — Reply garee fariinta macmiilka si aad ugu jawaabto.' : ''}`);
}

let currentAdminJid = null, currentAdminSid = 'main';
// 🧠 Maskaxda af-Soomaaliga ee MECO (key la'aan): maamulaha
async function adminEngine(jid, text, sid = 'main') {
  presence(sid, 'composing', jid);
  try {
    const r = await mecoCall('ask', { role: 'admin', text });
    if (r.error) return sendText(jid, '⚠️ ' + r.error, sid);
    if (r.pdf && r.pdf.b64) {
      const id = newId(); ourIds.add(id);
      await ses(sid).sock.sendMessage(jid, { document: Buffer.from(r.pdf.b64, 'base64'), mimetype: 'application/pdf', fileName: r.pdf.name || 'MECO.pdf' }, { messageId: id });
      return;
    }
    if (r.sendReceipt) {
      const x = r.sendReceipt, to = toJid(x.phone);
      if (!to) return sendText(jid, `⚠️ ${x.name} lambar telefoon kuma diiwaangashana MECO.`, sid);
      await sendText(to, ['⚡ *MECO POWER SUPPLY*', '🧾 *RASIID LACAG-BIXIN*', '', `Rasiid: *${x.receipt}*`, `Macmiil: ${x.name}`, `Lacag: *${money(x.amount)}*`, `Hab: ${x.method}`,
        `Taariikh: ${x.date} ${x.time || ''}`, x.staff ? `Qaaday: ${x.staff}` : '', `Deynta haray: ${money(x.due)}`, '', 'Mahadsanid! ✅', '_Powering Mustaxiil._'].filter((l) => l !== '').join('\n'), 'out');
      return sendText(jid, `✅ Rasiidka ${x.receipt} waxaa loo diray ${x.name} (${x.phone}) — ${ses(outSid()).label}.`, sid);
    }
    if (r.kind === 'unknown') {   // su'aal guud ama mid aan maskaxdu garan → AI (tools MECO + aqoon guud)
      try {
        const ans = await tryModels((cfg) => runAgent({ ...cfg, beforeCall: cfg.provider === 'pollinations' ? pollSlot : undefined, system: ADMIN_PROMPT + `\nWaqtiga hadda: ${nowTxt()} (Africa/Addis_Ababa).`, history: [{ role: 'user', content: text }], tools: MECO_TOOLS, exec: execTool }));
        if (ans) return sendText(jid, '🤖 ' + ans, sid);
      } catch (e) { console.error('Admin AI:', e.message); }
    }
    return sendText(jid, r.text || '…', sid);
  } finally { presence(sid, 'paused', jid); }
}
// 🧠 WhatsApp: caawinaad MECO KALIYA marka fariintu MECO ku saabsan tahay. Qof kasta oo kale (macmiil iyo qof caadi ah):
//    hal mar "Soo dhawoow, waa xoghayaha <magaca>. Maxaan kaa caawiyaa, mise isaga ayaan kuu gudbiyaa?" — kadibna aamus (adiga ayaa laguu gudbiyaa).
const nowTxt = () => new Date().toLocaleString('en-GB', { timeZone: process.env.TZ_NAME || 'Africa/Addis_Ababa', hour12: false });
const MECO_KINDS = ['due', 'credit', 'lastpay', 'history', 'next', 'collect', 'payhow', 'price', 'register', 'contact', 'fault', 'complain'];
function cleanName(n) {
  const w = String(n || '').replace(/[{(\[].*?[})\]]/g, ' ').replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/)[0] || '';
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '';
}
const ownerName = (sid) => (sid === 's2' ? db.settings.secretaryFor2 : db.settings.secretaryFor) || cleanName(ses(sid).sock?.user?.name || ses(sid).sock?.user?.verifiedName) || 'milkiilaha';
async function customerEngine(chat, key) {
  const pend = [];
  for (let i = chat.messages.length - 1; i >= 0 && chat.messages[i].role === 'user'; i--) pend.unshift(chat.messages[i].text);
  const text = pend.join('\n') || (chat.messages[chat.messages.length - 1] || {}).text || '';
  let r = await mecoCall('ask', { role: 'customer', phone: chat.mecoPhone || chat.phone, text });
  if (r.notCustomer) {   // lambarka uu qoraalka ku sheegay ma yahay macmiil MECO?
    const d = text.replace(/\D/g, '');
    if (d.length >= 9) { const r2 = await mecoCall('ask', { role: 'customer', phone: d, text: 'deyntayda' }); if (!r2.notCustomer && !r2.error) { chat.mecoPhone = d; saveDb(key); r = r2; } }
  }
  if (r.error) throw new Error('MECO: ' + r.error);
  const fromMeco = /\bmeco\b|app-?ka|\bapp\b|appka|korontada mustaxiil/i.test(text);
  // 0) "Waxaan ka socdaa app-ka MECO" → qaabka MECO
  if (fromMeco && !MECO_KINDS.includes(r.kind)) {
    chat.mecoMode = true; saveDb(key);
    if (!r.notCustomer) { chat.isCustomer = true; const g = await mecoCall('ask', { role: 'customer', phone: chat.mecoPhone || chat.phone, text: 'asc' }); return (g.text || '').replace(/^Wcs ([^!]*)!/, 'Ku soo dhowow MECO POWER SUPPLY, $1!') || 'Ku soo dhowow MECO POWER SUPPLY! 👋 Sideen kuu caawin karaa?'; }
    return 'Ku soo dhowow MECO POWER SUPPLY! 👋 Fadlan noo soo dir lambarka telefoonka ee ku diiwaangashan MECO, si aan xogtaada (deynta, biilka, lacagihii aad bixisay) kuugu sheegno.';
  }
  // 1) Fariintu MECO ma ku saabsan tahay? → caawinaad MECO (xogta dhabta ah)
  if (MECO_KINDS.includes(r.kind)) {
    if (!r.notCustomer) chat.isCustomer = true;
    if ((r.escalate || r.kind === 'fault') && !chat.test) { chat.needsHuman = true; saveDb(key); }   // 🔒 cid kale looma gudbinayo
    return r.text;
  }
  // Macmiil MECO oo qaabka MECO ku jira → su'aalaha kale AI (xogtiisa)
  if (chat.mecoMode && !r.notCustomer && r.kind !== 'greet') {
    try {
      const sys = CUSTOMER_PROMPT + `\nWaqtiga hadda: ${nowTxt()}\nMagaca macmiilka: ${r.customer || chat.name}\nACCOUNT:\n${JSON.stringify(r.context || {}, null, 1).slice(0, 6000)}\nSu'aalaha guud (diin, taariikh, aqoon) sidoo kale si sax ah uga jawaab.`;
      return (await tryModels((cfg) => callAI(cfg, sys, buildHistory(chat)), true)).replace(/\[ADMIN\]/gi, '').trim();
    } catch (e) { console.error('Customer AI:', e.message); }
  }
  // 2) Wax kale (salaan, sheeko gaar ah, su'aal aan MECO ahayn) → xoghaye
  return secretaryReply(chat, key, text);
}
// Qofku ma rabaa milkiilaha? (gudbi, isaga, "waxaan u baahnaa Duale", "xog ka rabay", haa/ok…)
function wantsOwner(text, owner, sid) {
  const t = ' ' + String(text).toLowerCase() + ' ';
  if (/ila sheekee|ila sheekayso|ila hadal|adiga ila|adigu ii|su'aal|weydii|waydii|\?|\bgoorm|\bmaxa[ay]\b|waa maxay|\bsidee\b|\bxagee\b|\bhalkee\b|\bimisa\b|\byaa\b|\bmaxaa\b|\bmiyaa?\b/i.test(t)) return false;
  const names = [owner, cleanName(ses(sid).sock?.user?.name), 'ducaale', 'duale', 'dualle', 'maamulaha', 'milkiilaha'].filter(Boolean).map((n) => n.toLowerCase());
  if (names.some((n) => t.includes(n))) return true;
  return /gudbi|isaga|asaga|u sheeg|ii sheeg|waan sugayaa|u baahn|ubaahn|rabaa|rabay|la hadlo|la hadli|wac|wici|^\s*(haa|haye|ok|okey|okay|hagaag|waa yahay|waayahay)\s*[.!]*\s*$/i.test(t);
}
async function secretaryReply(chat, key, text) {
  const owner = ownerName(chat.sid), now = Date.now();
  const notify = () => {};   // 🔒 fariimaha gaarka ah cid kale looma gudbiyo — milkiiluhu telefoonkiisa ayuu ku arkaa
  let answer = null;
  if (!chat.secGreetAt || now - chat.secGreetAt > 24 * 3600 * 1000) {          // hal mar 24-kii saac
    answer = `Soo dhawoow! 👋 Waa xoghayaha ${owner}. Maxaan kaa caawiyaa, mise isaga ayaan kuu gudbiyaa?`;
    chat.secGreetAt = now; chat.secForwardedAt = 0;
  } else if (wantsOwner(text, owner, chat.sid)) {
    if (!chat.secForwardedAt) { answer = `Waan u gudbiyay ✅ — ${owner} ayaa dhowaan kuu soo jawaabi doona.`; chat.secForwardedAt = now; chat.secNotifiedAt = 0; }
  } else {
    // "adiga ila sheekayso" ama su'aal guud → AI (aqoon guud, diin, taariikh…) — si sax ah oo kooban
    chat.aiChat = true;
    try {
      const sys = SECRETARY_PROMPT(owner) + `\nWaqtiga hadda: ${nowTxt()}\nMagaca qofka (WhatsApp): ${chat.name || '—'}\nHorey ayaad isu sheegtay (xoghayaha ${owner}) — ha ku celin. Haddii uu kaa codsado inaad la sheekeysato, si diiran u aqbal oo ka jawaab su'aalihiisa.`;
      answer = await tryModels((cfg) => callAI(cfg, sys, buildHistory(chat)), true);
    } catch (e) {
      console.error('Secretary AI:', e.message);
      answer = `Waan ka xumahay, hadda si buuxda uma jawaabi karo 🙏 — ${owner} ayaan u gudbinayaa.`;
    }
  }
  notify();
  saveDb(key);
  return answer;                                                                 // null = aamus (adiga ayaa jawaabaya)
}
const adminHistory = new Map();
function quotedText(m) {
  const msg = m.message || {};
  const ctx = msg.extendedTextMessage?.contextInfo || msg.imageMessage?.contextInfo || msg.conversation?.contextInfo;
  const q = ctx?.quotedMessage;
  return q ? (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || '') : '';
}
async function handleAdmin(jid, text, m, sid = 'main') {
  // Jawaab macmiil app-ka: Reply fariinta (CK-xxxxx) ama "/j CK-00012 qoraal"
  const qt = m ? quotedText(m) : '';
  let ck = (qt.match(/\bCK-\d+/i) || [])[0], body = text;
  const jm = text.match(/^\/j\s+(CK-\d+)\s+([\s\S]+)$/i);
  if (jm) { ck = jm[1]; body = jm[2]; }
  if (ck && !/^\/?(reset|cusub|clear)$/i.test(text.trim())) {
    const r = await mecoCall('chat_reply', { ticketNo: ck.toUpperCase(), body, from: 'admin' });
    return sendText(jid, r.error ? '⚠️ Lama dirin: ' + r.error : `✅ Waa loo diray *${r.customer}* (app-ka · ${r.ticketNo})`, sid);
  }
  currentAdminJid = jid; currentAdminSid = sid;
  return adminEngine(jid, text, sid);
  const h = adminHistory.get(sid + jid) || [];
  if (/^\/?(reset|cusub|clear)$/i.test(text.trim())) { adminHistory.delete(sid + jid); return sendText(jid, '🔄 Sheekada waa la tirtiray.', sid); }
  h.push({ role: 'user', content: text });
  while (h.length > 16) h.shift();
  while (h.length && h[0].role !== 'user') h.shift();
  adminHistory.set(sid + jid, h);
  presence(sid, 'composing', jid);
  try {
    const now = new Date().toLocaleString('en-GB', { timeZone: process.env.TZ_NAME || 'Africa/Addis_Ababa', hour12: false });
    const answer = await tryModels((cfg) => runAgent({ ...cfg, beforeCall: cfg.provider === 'pollinations' ? pollSlot : undefined,
      system: ADMIN_PROMPT + `\nWaqtiga hadda: ${now} (Africa/Addis_Ababa).`, history: h, tools: MECO_TOOLS, exec: execTool }));
    const reply = answer || '…';
    h.push({ role: 'assistant', content: reply });
    await sendText(jid, '🤖 ' + reply, sid);
  } catch (e) {
    console.error('Admin agent error:', e.message);
    h.pop();
    await sendText(jid, '⚠️ AI-ga khalad: ' + e.message, sid).catch(() => {});
  } finally { presence(sid, 'paused', jid); }
}

// -------------------------------------------------------------
//  MECO ogeysiisyada
// -------------------------------------------------------------
const notifyQueue = [];
const toJid = (num) => {
  let d = String(num || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = '251' + d.slice(1);          // 09xxxxxxxx → 2519xxxxxxxx
  else if (d.length === 9 && /^[79]/.test(d)) d = '251' + d; // 9xxxxxxxx
  return d + '@s.whatsapp.net';
};
const money = (v) => Number(v || 0).toLocaleString('en-US') + ' Br';

function buildNotifications(b) {
  const admins = adminJids();
  if (b.to) admins.splice(0, admins.length, ...String(b.to).split(',').map(toJid).filter(Boolean));
  const out = [];
  const when = new Date().toLocaleString('en-GB', { timeZone: process.env.TZ_NAME || 'Africa/Addis_Ababa', hour12: false });
  let text = b.text ? String(b.text) : '';
  if (!text && b.type === 'payment') {
    text = [
      '⚡ *MECO POWER SUPPLY*',
      '💰 *Lacag la qaaday*',
      '',
      `👤 Macmiil: ${b.customer || '-'}${b.phone ? ' (' + b.phone + ')' : ''}`,
      b.customerId ? `🆔 ID: ${b.customerId}` : '',
      `💵 Lacag: *${money(b.amount)}*`,
      `💳 Hab: ${b.method || '-'}`,
      b.receipt ? `🧾 Rasiid: ${b.receipt}` : '',
      b.due !== undefined && b.due !== '' ? `📉 Deynta haray: ${money(b.due)}` : '',
      b.plan ? `📅 Nooca: ${b.plan}` : '',
      b.staff ? `🧑‍💼 Shaqaale: ${b.staff}` : '',
      b.note ? `📝 ${b.note}` : '',
      `🕒 ${when}`,
    ].filter(Boolean).join('\n');
  }
  if (text) admins.forEach((jid) => out.push({ jid, text }));
  if (b.type === 'payment' && db.settings.customerReceipts && b.phone) {
    const jid = toJid(b.phone);
    if (jid) out.push({ jid, text: [
      '⚡ *MECO POWER SUPPLY*',
      `Mahadsanid ${b.customer || ''}! ✅`,
      `Lacagtaada *${money(b.amount)}* (${b.method || ''}) waa la helay.`,
      b.receipt ? `🧾 Rasiid: ${b.receipt}` : '',
      b.due !== undefined && b.due !== '' ? `📉 Deynta haray: ${money(b.due)}` : '',
      `🕒 ${when}`,
      '_Powering Mustaxiil._',
    ].filter(Boolean).join('\n') });
  }
  return out;
}

let notifyBusy = false;
async function flushNotifyQueue() {
  if (notifyBusy || !ses(outSid()).wa.connected) return;
  notifyBusy = true;
  try {
    while (notifyQueue.length && ses(outSid()).wa.connected) {
      const it = notifyQueue[0];
      try { await sendText(it.jid, it.text, 'out'); notifyQueue.shift(); }
      catch (e) { console.error('Notify error:', e.message); it.tries = (it.tries || 0) + 1; if (it.tries >= 3) notifyQueue.shift(); else break; }
      await new Promise((r) => setTimeout(r, 1200)); // ha u dirin si degdeg ah (spam)
    }
  } finally { notifyBusy = false; }
}
setInterval(flushNotifyQueue, 30 * 1000);

// Outbox: fariimaha lagu qoro Supabase (wa_outbox) → WhatsApp (10 ilbiriqsi kasta)
let outboxBusy = false;
setInterval(async () => {
  if (outboxBusy) return; outboxBusy = true;
  try {
    for (const o of await store.outboxPending()) {
      const sid = o.sid === 'out' ? outSid() : (SES[o.sid] ? o.sid : 'main');
      if (!ses(sid).wa.connected) continue;
      try { await sendText(toJid(o.to_phone), o.text, sid); await store.outboxMark(o.id, 'sent'); }
      catch (e) { await store.outboxMark(o.id, 'error', e.message); }
      await new Promise((r) => setTimeout(r, 1200));
    }
  } catch (e) { /* table ma jiro ama khalad */ } finally { outboxBusy = false; }
}, 10 * 1000);

// -------------------------------------------------------------
//  Admin Dashboard (Express)
// -------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', true);
// /health — password la'aan; waxaa isticmaala keep-alive (si Render free uusan u seexan)
app.get('/health', (req, res) => res.json({ ok: true, connected: wa.connected, uptime: Math.round(process.uptime()) }));

// ---- MECO → WhatsApp: ogeysiisyada lacag-bixinta (password la'aan, sir ayaa lagu xaqiijiyaa)
app.post('/api/notify', async (req, res) => {
  const b = req.body || {};
  if (!b.secret || b.secret !== db.settings.notifySecret) return res.status(401).json({ ok: false, error: 'Secret khaldan' });
  const list = (Array.isArray(b.items) ? b.items.slice(0, 100) : [b]).filter(Boolean);
  const appMsgs = list.filter((x) => x.type === 'app_message');
  appMsgs.forEach((x) => handleAppMessage(x).catch((e) => console.error('App message error:', e.message)));
  const items = list.filter((x) => x.type !== 'app_message').flatMap((x) => buildNotifications(x));
  if (!items.length && !appMsgs.length) return res.status(400).json({ ok: false, error: 'Lambar ama fariin lama helin (eeg Habaynta → MECO)' });
  for (const it of items) notifyQueue.push(it);
  if (notifyQueue.length > 500) notifyQueue.splice(0, notifyQueue.length - 500);
  await flushNotifyQueue();
  res.json({ ok: true, queued: notifyQueue.length, connected: ses(outSid()).wa.connected, from: ses(outSid()).label });
});
app.use((req, res, next) => {
  const hdr = req.headers.authorization || '';
  const [, b64] = hdr.split(' ');
  const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
  if (pass === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="WhatsApp Bot Admin"').status(401).send('Password ayaa loo baahan yahay');
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  const chats = Object.values(db.chats);
  res.json({
    connected: wa.connected, qr: wa.qr, me: wa.me, lastError: wa.lastError,
    sessions: Object.values(SES).map((x) => ({ id: x.id, label: x.label, connected: x.wa.connected, qr: x.wa.qr, me: x.wa.me, lastError: x.wa.lastError, pairCode: x.wa.pairCode || null })),
    outFrom: ses(outSid()).label,
    botEnabled: db.settings.botEnabled, lastAiError: db.settings.lastAiError || '', model: '🧠 Maskaxda MECO + ' + (aiChain().slice(0, 1).map((c) => `${c.provider} · ${c.model}`)[0] || 'AI ma jiro'),
    sheet: { configured: !!SHEET_URL, ...knowledge, text: undefined, chars: knowledge.text.length },
    stats: {
      chats: chats.length,
      needsHuman: chats.filter((c) => c.needsHuman).length,
      today: chats.reduce((n, c) => n + c.messages.filter((m) => m.role === 'user'
        && new Date(m.ts).toDateString() === new Date().toDateString()).length, 0),
    },
  });
});

app.get('/api/chats', (req, res) => {
  const list = Object.values(db.chats)
    .sort((a, b) => b.lastTs - a.lastTs)
    .map((c) => ({
      jid: c.key || c.jid, sid: c.sid || 'main', name: c.name, phone: c.phone, unread: c.unread || 0, needsHuman: !!c.needsHuman,
      paused: isPaused(c), manualPause: !!c.manualPause, pausedUntil: c.pausedUntil, lastTs: c.lastTs,
      last: c.messages[c.messages.length - 1] || null,
    }));
  res.json(list);
});

app.get('/api/chats/:jid', (req, res) => {
  const c = db.chats[req.params.jid];
  if (!c) return res.status(404).json({ error: 'Lama helin' });
  c.unread = 0; saveDb(c.jid);
  res.json({ ...c, paused: isPaused(c) });
});

app.post('/api/chats/:jid/send', async (req, res) => {
  const c = db.chats[req.params.jid];
  const text = String(req.body.text || '').trim();
  if (!c || !text) return res.status(400).json({ error: 'Xog khaldan' });
  try {
    await sendText(c.jid, text, c.sid || 'main');
    addMessage(c, 'owner', text);
    c.pausedUntil = Date.now() + db.settings.pauseMinutes * 60 * 1000;
    c.needsHuman = false; saveDb(c.key || c.jid);
    logToSheet({ phone: c.phone, name: c.name, direction: 'ADIGA', text });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/chats/:jid/pause', (req, res) => {
  const c = db.chats[req.params.jid];
  if (!c) return res.status(404).json({ error: 'Lama helin' });
  const paused = !!req.body.paused;
  c.manualPause = paused;
  if (!paused) { c.pausedUntil = 0; c.needsHuman = false; }
  saveDb(c.jid);
  res.json({ ok: true, paused: isPaused(c) });
});

app.delete('/api/chats/:jid', (req, res) => {
  dirtyChats.delete(req.params.jid); delete db.chats[req.params.jid]; store.deleteChat(req.params.jid); res.json({ ok: true });
});

const publicSettings = () => {
  const { aiKey, geminiKey: _gk, ...rest } = db.settings;
  const gk = geminiKey();
  const cfg = aiCfg();
  return { ...rest, aiProvider: cfg.provider, aiModel: db.settings.aiModel || '', aiModelDefault: PROVIDERS[cfg.provider].model,
    aiKeySet: !!cfg.key, aiKeyHint: cfg.key ? '••••' + cfg.key.slice(-4) : '', providers: Object.keys(PROVIDERS),
    geminiSet: !!gk, geminiHint: gk ? '••••' + gk.slice(-4) : '' };
};
app.get('/api/settings', (req, res) => res.json(publicSettings()));
app.post('/api/settings', (req, res) => {
  const s = req.body || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  db.settings = {
    ...db.settings,
    ...(s.botEnabled !== undefined && { botEnabled: !!s.botEnabled }),
    ...(s.systemPrompt !== undefined && { systemPrompt: String(s.systemPrompt) || DEFAULT_PROMPT }),
    ...(s.pauseMinutes !== undefined && { pauseMinutes: num(s.pauseMinutes, 30) }),
    ...(s.batchSeconds !== undefined && { batchSeconds: num(s.batchSeconds, 4) }),
    ...(s.maxAgeMinutes !== undefined && { maxAgeMinutes: num(s.maxAgeMinutes, 10) }),
    ...(s.ignoreNumbers !== undefined && { ignoreNumbers: String(s.ignoreNumbers) }),
    ...(s.notifyNumbers !== undefined && { notifyNumbers: String(s.notifyNumbers) }),
    ...(s.customerReceipts !== undefined && { customerReceipts: !!s.customerReceipts }),
    ...(s.appAutoReply !== undefined && { appAutoReply: !!s.appAutoReply }),
    ...(s.useAI !== undefined && { useAI: !!s.useAI }),
    ...(s.secretaryFor !== undefined && { secretaryFor: String(s.secretaryFor).trim() }),
    ...(s.secretaryFor2 !== undefined && { secretaryFor2: String(s.secretaryFor2).trim() }),
    ...(s.mecoUrl !== undefined && { mecoUrl: String(s.mecoUrl).trim() }),
    ...(s.aiProvider && PROVIDERS[s.aiProvider] && { aiProvider: s.aiProvider }),
    ...(s.aiModel !== undefined && { aiModel: String(s.aiModel).trim() }),
    ...(s.aiKey && !String(s.aiKey).startsWith('••') && { aiKey: String(s.aiKey).trim() }),
    ...(s.geminiKey !== undefined && !String(s.geminiKey).startsWith('••') && { geminiKey: String(s.geminiKey).trim() }),
  };
  saveDb();
  res.json(publicSettings());
});
app.post('/api/settings/reset-prompt', (req, res) => {
  db.settings.systemPrompt = DEFAULT_PROMPT; saveDb(); res.json(publicSettings());
});

app.post('/api/knowledge/refresh', async (req, res) => {
  await loadKnowledge();
  res.json({ ...knowledge, preview: knowledge.text.slice(0, 3000) });
});
app.get('/api/knowledge', (req, res) => res.json({ ...knowledge, preview: knowledge.text.slice(0, 3000) }));

// Tijaabi AI-ga adigoon WhatsApp isticmaalin
app.post('/api/test', async (req, res) => {
  try {
    {
      const fake = { test: true, sid: 'main', name: 'Tijaabo', phone: req.body.phone || '', messages: (req.body.messages || []).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })) };
      return res.json({ answer: await customerEngine(fake, null) });
    }
    const fake = { name: 'Tijaabo', messages: (req.body.messages || []).map((m) => ({ role: m.role, text: m.text })) };
    res.json({ answer: await askAI(fake) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agent/test', async (req, res) => {
  try {
    const h = (req.body.messages || []).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    const answer = await tryModels((cfg) => runAgent({ ...cfg, beforeCall: cfg.provider === 'pollinations' ? pollSlot : undefined,
      system: ADMIN_PROMPT, history: h, tools: MECO_TOOLS.filter((t) => t.name !== 'send_receipt'), exec: execTool }));
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notify/test', async (req, res) => {
  const items = buildNotifications({ type: 'payment', customer: 'Tijaabo', amount: 150, method: 'Telebirr', plan: 'Habeenle', staff: 'Admin' })
    .filter((i) => !i.jid.startsWith('251000'));
  if (!items.length) return res.status(400).json({ error: 'Marka hore geli lambarada ogeysiiska' });
  notifyQueue.push(...items); await flushNotifyQueue();
  res.json({ ok: true, connected: wa.connected });
});

app.post('/api/logout', async (req, res) => {
  try { await ses(req.body?.sid).sock?.logout(); } catch { /* ignore */ }
  res.json({ ok: true });
});
// Pairing code (QR la'aan): WhatsApp → Linked devices → Link with phone number
app.post('/api/pair', async (req, res) => {
  const x = ses(req.body?.sid || 's2');
  const num = String(req.body?.phone || '').replace(/\D/g, '').replace(/^0/, '251');
  if (num.length < 11) return res.status(400).json({ error: 'Lambar sax ah geli (09…)' });
  if (x.wa.connected) return res.status(400).json({ error: x.label + ' horay ayuu u xiran yahay' });
  try { const code = await x.sock.requestPairingCode(num); x.wa.pairCode = code; res.json({ code }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`\n🌐 Dashboard: http://localhost:${PORT}   (password: .env → ADMIN_PASSWORD)`);
});

await loadKnowledge();
setInterval(loadKnowledge, 5 * 60 * 1000);   // 5 daqiiqo kasta Sheet-ka dib u akhri

// Keep-alive: server-ku naftiisa ayuu ping gareeyaa 10 daqiiqo kasta (Render free 15 daqiiqo kadib wuu seexdaa)
if (PUBLIC_URL) {
  setInterval(() => fetch(PUBLIC_URL + '/health').catch(() => {}), 10 * 60 * 1000);
  console.log(`🔁 Keep-alive: ${PUBLIC_URL}/health`);
}
const shutdown = async () => { await flush(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
startWhatsApp('main').catch((e) => console.error('WhatsApp 1 start error:', e));
setTimeout(() => startWhatsApp('s2').catch((e) => console.error('WhatsApp 2 start error:', e)), 4000);
