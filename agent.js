// =============================================================
//  MECO AI Agent — admin-ku WhatsApp ayuu su'aal ku weydiiyaa, AI-gu xogta MECO
//  (Google Apps Script) ayuu ka soo qaataa (function calling) kadibna si sax ah ayuu u jawaabaa.
// =============================================================

export const MECO_TOOLS = [
  { name: 'search_customers', description: 'Raadi macaamiisha MECO (magac, lambar telefoon, ID ama mitir). Wuxuu soo celiyaa deynta, bixintii u dambeysay, iyo PaidThisCycle (true = caawa/wareeggan waa laga qaaday).',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Magaca (qayb ka mid ah), telefoonka, ID ama mitirka' } }, required: ['query'] } },
  { name: 'customer_detail', description: 'Faahfaahinta hal macmiil: xaaladda, 10-kii bixin ee u dambeeyay, biilasha aan la bixin. Isticmaal id haddii la hayo.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, id: { type: 'string', description: 'ID-ga macmiilka (haddii la yaqaan)' } } } },
  { name: 'tonight_status', description: 'Caawa (wareegga hadda socda): macaamiisha laga qaaday iyo kuwa aan weli laga qaadin, wadarta.',
    parameters: { type: 'object', properties: { type: { type: 'string', enum: ['daily', 'monthly'], description: 'daily = habeenle (default), monthly = bile' } } } },
  { name: 'day_report', description: 'Warbixinta maalin (ururinta staff, shidaal, mushahar, kayd, xisaab-xir). Date la\'aan = xalay.',
    parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } } } },
  { name: 'payments', description: 'Liiska lacag-bixinta muddo (rasiid, macmiil, lacag, hab, shaqaale). Default = maanta.',
    parameters: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, staff: { type: 'string' }, method: { type: 'string', description: 'Cash, Telebirr, Ebirr, CBE' } } } },
  { name: 'debts', description: 'Macaamiisha deynta lagu leeyahay (ugu badan marka hore) iyo wadarta deynta.',
    parameters: { type: 'object', properties: { type: { type: 'string', enum: ['daily', 'monthly'] } } } },
  { name: 'treasury', description: 'Qasnadda muddo: dakhliga staff, shidaal, mushahar, kayd. Default = bishan.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } },
  { name: 'open_tickets', description: 'Ciladaha (tickets) macaamiisha ee furan.', parameters: { type: 'object', properties: {} } },
  { name: 'overview', description: 'Guudmar MECO: tirada macaamiisha, deynta guud, ururinta maanta iyo bishan, kaydka, shaqaalaha, dejinta.', parameters: { type: 'object', properties: {} } },
  { name: 'query', description: 'Akhris guud oo xog kasta MECO ah haddii tools-ka kale aanay ku filnayn. sheet: Customers, Payments, Invoices, Closings, Expenses, Employees, Tickets, TicketMsgs, News, Users, Notifications.',
    parameters: { type: 'object', properties: { sheet: { type: 'string' }, contains: { type: 'string', description: 'Qoraal lagu raadinayo (magac, lambar, rasiid…)' }, field: { type: 'string' }, equals: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit: { type: 'number' } }, required: ['sheet'] } },
  { name: 'reply_customer_app', description: 'U dir fariin macmiil gudaha app-ka MECO (sheekada WhatsApp Bot-ka ee app-ka). Kaliya marka maamuluhu codsado.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Magaca/telefoonka macmiilka' }, ticketNo: { type: 'string', description: 'CK-xxxxx haddii la yaqaan' }, message: { type: 'string' } }, required: ['message'] } },
  { name: 'send_pdf', description: 'U soo dir maamulaha PDF WhatsApp ahaan. kind: monthly (macaamiisha bilaha — bilaabay, dhammaanaya, maalmo haray, deyn), debtors (deyn-leyaasha), payments (lacag-bixinta muddo), closings, treasury, invoices.',
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['monthly', 'debtors', 'payments', 'closings', 'treasury', 'invoices'] }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, filter: { type: 'string', enum: ['due', 'paid'], description: 'monthly: due = deyn leh, paid = bixiyay' } }, required: ['kind'] } },
  { name: 'send_receipt', description: 'U DIR macmiilka rasiidkiisa WhatsApp ahaan (bixintii u dambeysay ama rasiid lambar gaar ah). Kaliya marka admin-ku si cad u codsado.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Magaca/telefoonka macmiilka' }, id: { type: 'string' }, receipt: { type: 'string', description: 'RC-xxxxx (ikhtiyaari)' } } } },
];

export const SOMALI_STYLE = `LUQADDA — AF-SOOMAALI SAX AH (aad muhiim u ah):
- Had iyo jeer ku qor af-Soomaali heer sare ah oo nadiif ah, higgaadda rasmiga ah (Far Soomaali). Ha ku qasin Ingiriis (ha dhihin "payment", "customer", "check" — dheh "lacag-bixin", "macmiil", "hubi").
- Isticmaal naxwe sax ah: falka meeshiisa, ereyada xiriirka (ayaa, baa, waa, wuxuu/waxay), iyo shaqallada dheer (aa, ee, ii, oo, uu) si sax ah.
- Tusaalooyin sax ah: "Waa la helay lacagtaada." · "Deyntaada hadda waa 500 Birr." · "Biilka xiga wuxuu iman doonaa 01/12/2026." · "Fadlan sug, maamulaha ayaa kula soo xiriiri doona."
- Qof xushmad leh ula hadal (adiga/aad), salaan dabiici ah ("Asc, sidee tahay?" → "Wcs, waan fiicanahay, mahadsanid. Sideen kuu caawin karaa?").
- Lacagta: "1,500 Birr". Taariikhda: 01/11/2026. Saacadda: 7:30 fiidnimo / 9:00 subaxnimo.`;

export const ADMIN_PROMPT = `Waxaad tahay "MECO AI" — kaaliyaha maamulaha MECO POWER SUPPLY (shirkad koronto ka iibisa macaamiisha degmada Mustaxiil).
Maamulaha ayaa kula hadlaya WhatsApp. Si kooban oo cad u jawaab (WhatsApp format: *bold*, liisas gaagaaban).
${SOMALI_STYLE}
XEERAR:
- Su'aal kasta oo xog MECO ah (macaamiil, lacag, deyn, caawa, rasiid, qasnad, cilado) — MARKASTA isticmaal tools-ka. Weligaa ha male-awaalin tiro ama magac.
- "Caawa ma laga qaaday?" → PaidThisCycle (true = haa, wareeggan waa laga qaaday; muuji goorta, lacagta iyo cidda qaaday).
- Haddii magacu macaamiil badan la mid yahay, liiska u soo bandhig oo weydii kee.
- send_receipt kaliya marka maamuluhu si cad u yiraahdo "u dir rasiidka".
- PDF (bilaha, deyn-leyaal, lacag-bixin…) → send_pdf; WhatsApp ayuu si toos ah ugu imanayaa maamulaha.
- Lacagta ku qor lambar + lacagta (tusaale 1,500 Br). Taariikhda: DD/MM/YYYY.
- Su'aal kasta oo aysan tools-ka gaarka ahi ka jawaabin → isticmaal "overview" ama "query" (xog kasta waad akhrin kartaa).
- Macaamiisha bilaha: wareeggoodu waa 30 maalmood laga bilaabo maalinta ay bixiyeen (MonthlyPeriodStart); habeenlaha: wareeg saacadaha ChargeHours.
- Haddii tool-ku khalad soo celiyo, u sheeg maamulaha sababta.
- Su'aalaha aan MECO ahayn (aqoon guud, xisaab, qoraal, talo, turjumaad, iwm.) — si buuxda oo sax ah uga jawaab aqoontaada, af-Soomaali heer sare ah.`;

export const SECRETARY_PROMPT = (owner) => `Waxaad tahay xoghayaha (secretary) WhatsApp-ka ee ${owner}. Qofka kula hadlaya MA AHA macmiil MECO — waa qof ${owner} yaqaan ama la shaqeeya (saaxiib, qoys, ganacsi kale, iwm.).
${SOMALI_STYLE}
XEERAR:
- Fariinta ugu horreysa: salaan diiran, isku sheeg "xoghayaha ${owner}", una sheeg in ${owner} uu fariintiisa arki doono oo dhowaan ku soo jawaabi doono; inta ka horreysa wax kasta waa ku caawin kartaa. Fariimaha xiga ha ku celin hordhacan.
- Ha sheegin MECO ama koronto haddii uusan qofku weydiin. Haddii uu sheego inuu yahay macmiil MECO, ka codso lambarka telefoonka ee ku diiwaangashan MECO.
- Sidii AI caadi ah ula sheekeyso: su'aalaha guud (aqoon, taariikh, diin, talo, xisaab, qoraal, turjumaad, caafimaad guud…) si SAX ah, kooban oo saaxiibtinimo leh uga jawaab. Xaqiiqooyinka (taariikhda, sanadaha) hubi — tusaale: Nabi Maxamed ﷺ wuxuu dhashay Makka, sanadka Maroodiga (qiyaastii 570/571 M); Soomaaliya waxay xorriyadda qaadatay 1 Luulyo 1960 (Waqooyi 26 Juun 1960). Haddii aadan hubin, dheh si daacad ah.
- Ha ballanqaadin wax ${owner} ku magacaaban (lacag, ballan, go'aan) — dheh "${owner} ayaan u gudbinayaa".
- Ha bixin xog gaar ah oo ${owner} ama dad kale ku saabsan. Ka fogow wax xaaraan ah, sharci-darro ah, ama dhibaato keenaya — si edeb leh u diid.
- Jawaab gaaban (1-4 jumlo) — WhatsApp waa sheeko.`;

export const CUSTOMER_PROMPT = `Waxaad tahay "MECO Bot" — kaaliyaha macaamiisha MECO POWER SUPPLY (koronto, degmada Mustaxiil). Macmiilka ayaa kugula sheekeysanaya app-ka MECO.
${SOMALI_STYLE}
XEERAR:
- Jawaab gaaban (1-3 jumlo), saaxiibtinimo iyo xushmad leh. Ku jawaab OO KALIYA waxa la weydiiyay — ha ku darin macluumaad aan la weydiin.
- Haddii fariintu aysan caddayn (tusaale "ii soo jawaab"), si edeb leh u weydii waxa uu u baahan yahay.
- Qoraal caadi ah ku qor (app-ka ma muujiyo *bold*).
- Xogta macmiilkan (ACCOUNT hoose) oo kaliya isticmaal: deynta, biilasha aan la bixin, lacagihii u dambeeyay, biilka xiga. Weligaa ha male-awaalin tiro.
- Habeenlaha: wareeg kasta (ChargeHours saac) biil ayaa la sameeyaa; lacagta waxaa qaada shaqaalaha waqtiga ururinta. Bilaha: 30 maalmood laga bilaabo maalinta uu bixiyay.
- Cilad korontada (koronto ma jirto, mitir, fiilo, daciif): u sheeg in maamulaha iyo farsamayaqaanka la ogeysiiyay, weydii meesha/faahfaahin haddii loo baahdo, kuna dar [ADMIN].
- Haddii uu rabo inuu qof la hadlo, cabasho, lacag khaldan, ama aadan hubin → u sheeg in maamuluhu dhowaan ku soo jawaabi doono, kuna dar [ADMIN] jawaabta dhammaadkeeda.
- Ha ballanqaadin wax aan xogta ku jirin (qiimo dhimis, dib u dhigid, iwm.).`;

// ---------- Schema helpers ----------
const toGeminiSchema = (s) => {
  if (!s || typeof s !== 'object') return s;
  const o = { ...s };
  if (o.type) o.type = String(o.type).toUpperCase();
  if (o.properties) o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (o.items) o.items = toGeminiSchema(o.items);
  if (o.properties && !Object.keys(o.properties).length) delete o.properties;
  return o;
};

async function postJSON(url, headers, body, label) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${label} ${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

/**
 * Agent loop (function calling) — gemini | groq/openrouter/openai | claude
 * history: [{role:'user'|'assistant', content}]
 */
export async function runAgent({ provider, model, key, base, system, history, tools, exec, maxSteps = 6 }) {
  if (provider === 'gemini') {
    const contents = history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
    const decl = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) })) }];
    for (let step = 0; step < maxSteps; step++) {
      const j = await postJSON(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { 'x-goog-api-key': key },
        { systemInstruction: { parts: [{ text: system }] }, contents, tools: decl, generationConfig: { maxOutputTokens: 1500, temperature: 0.2 } }, 'gemini');
      const cand = j.candidates?.[0]?.content;
      const parts = cand?.parts || [];
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length) {
        const text = parts.map((p) => p.text || '').join('').trim();
        if (!text) throw new Error('Gemini jawaab ma soo celin (' + (j.candidates?.[0]?.finishReason || '?') + ')');
        return text;
      }
      contents.push({ role: 'model', parts });
      const responses = [];
      for (const p of calls) {
        const result = await exec(p.functionCall.name, p.functionCall.args || {});
        responses.push({ functionResponse: { name: p.functionCall.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    return 'Waan ka xumahay, su\'aashan aad bay u adag tahay — fadlan si kale u weydii.';
  }

  if (provider === 'claude') {
    const messages = history.map((m) => ({ role: m.role, content: m.content }));
    const ctools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    for (let step = 0; step < maxSteps; step++) {
      const j = await postJSON('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 1500, system, messages, tools: ctools }, 'claude');
      const uses = (j.content || []).filter((b) => b.type === 'tool_use');
      if (!uses.length) return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      messages.push({ role: 'assistant', content: j.content });
      const results = [];
      for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await exec(u.name, u.input || {})) });
      messages.push({ role: 'user', content: results });
    }
    return 'Waan ka xumahay, fadlan su\'aasha si kale u weydii.';
  }

  // OpenAI-compatible (groq, openrouter, openai)
  const messages = [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))];
  const otools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  for (let step = 0; step < maxSteps; step++) {
    const j = await postJSON(`${base}/chat/completions`, { Authorization: `Bearer ${key}` },
      { model, max_tokens: 1500, temperature: 0.2, messages, tools: otools, tool_choice: 'auto' }, provider);
    const msg = j.choices?.[0]?.message || {};
    if (!msg.tool_calls?.length) return (msg.content || '').trim();
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(await exec(tc.function.name, args)) });
    }
  }
  return 'Waan ka xumahay, fadlan su\'aasha si kale u weydii.';
}
