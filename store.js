// =============================================================
//  Supabase store — login-ka WhatsApp, sheekooyinka iyo dejinta
//  (si server-ku dib u kici karo isagoon QR mar kale u baahan)
// =============================================================
import { createClient } from '@supabase/supabase-js';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('❌ SUPABASE_URL iyo SUPABASE_SERVICE_KEY waa in la geliyaa (Environment variables)');
  process.exit(1);
}
export const supabase = createClient(url, key, { auth: { persistSession: false } });

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------------- WhatsApp auth state ----------------
export async function useSupabaseAuthState(prefix = '') {
  const read = async (keys) => {
    const out = {};
    for (const part of chunk(keys, 200)) {
      const { data, error } = await supabase.from('wa_auth').select('key,value').in('key', part);
      if (error) throw new Error('wa_auth read: ' + error.message);
      for (const r of data) out[r.key] = JSON.parse(r.value, BufferJSON.reviver);
    }
    return out;
  };
  const write = async (rows) => {
    for (const part of chunk(rows, 200)) {
      const { error } = await supabase.from('wa_auth').upsert(part, { onConflict: 'key' });
      if (error) throw new Error('wa_auth write: ' + error.message);
    }
  };
  const remove = async (keys) => {
    for (const part of chunk(keys, 200)) {
      const { error } = await supabase.from('wa_auth').delete().in('key', part);
      if (error) throw new Error('wa_auth delete: ' + error.message);
    }
  };

  const creds = (await read([prefix + 'creds']))[prefix + 'creds'] || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const found = await read(ids.map((id) => `${prefix}${type}-${id}`));
          const data = {};
          for (const id of ids) {
            let v = found[`${prefix}${type}-${id}`] ?? null;
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            data[id] = v;
          }
          return data;
        },
        set: async (data) => {
          const up = [];
          const del = [];
          const now = new Date().toISOString();
          for (const cat in data) {
            for (const id in data[cat]) {
              const v = data[cat][id];
              const k = `${prefix}${cat}-${id}`;
              if (v) up.push({ key: k, value: JSON.stringify(v, BufferJSON.replacer), updated_at: now });
              else del.push(k);
            }
          }
          if (up.length) await write(up);
          if (del.length) await remove(del);
        },
      },
    },
    saveCreds: () => write([{ key: prefix + 'creds', value: JSON.stringify(creds, BufferJSON.replacer), updated_at: new Date().toISOString() }]),
  };
}

export async function clearAuth(prefix = '') {
  // main (prefix '') = furayaasha aan horgale lahayn; s2 = 's2:%'
  const q = supabase.from('wa_auth').delete();
  const { error } = prefix ? await q.like('key', prefix + '%') : await q.not('key', 'like', 's2:%');
  if (error) console.error('clearAuth:', error.message);
}

// ---------------- Settings & chats ----------------
export async function loadSettings() {
  const { data, error } = await supabase.from('wa_settings').select('data').eq('id', 1).maybeSingle();
  if (error) throw new Error('wa_settings: ' + error.message);
  return data?.data || null;
}
export async function saveSettings(settings) {
  const { error } = await supabase.from('wa_settings')
    .upsert({ id: 1, data: settings, updated_at: new Date().toISOString() });
  if (error) console.error('saveSettings:', error.message);
}

export async function loadChats() {
  const chats = {};
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from('wa_chats').select('jid,data')
      .order('last_ts', { ascending: false }).range(from, from + 999);
    if (error) throw new Error('wa_chats: ' + error.message);
    for (const r of data) chats[r.jid] = r.data;
    if (data.length < 1000) break;
    from += 1000;
  }
  return chats;
}
export async function saveChats(list) {
  if (!list.length) return;
  const rows = list.map((c) => ({ jid: c.key || c.jid, data: c, last_ts: c.lastTs || 0, updated_at: new Date().toISOString() }));
  for (const part of chunk(rows, 100)) {
    const { error } = await supabase.from('wa_chats').upsert(part, { onConflict: 'jid' });
    if (error) throw new Error('saveChats: ' + error.message);
  }
}
export async function deleteChat(jid) {
  const { error } = await supabase.from('wa_chats').delete().eq('jid', jid);
  if (error) console.error('deleteChat:', error.message);
}
