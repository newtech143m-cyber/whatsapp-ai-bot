# 💬 WhatsApp AI Bot — Online (Render + Supabase)

Bot ku xirma WhatsApp-kaaga (QR scan, sida WhatsApp Web), macaamiisha kula sheekeysta **Google Gemini AI** (bilaash) (Soomaali), macluumaadka ganacsigaaga ka akhriya **Google Sheets**, kuna leh **Admin Dashboard online ah** — 24/7, kombiyuutarkaaga looma baahna.

| Qayb | Meesha ay ku shaqeyso |
|---|---|
| Bot + Dashboard | **Render** (free web service) |
| Login-ka WhatsApp, sheekooyinka, dejinta | **Supabase** project "My own" (tables: `wa_auth`, `wa_chats`, `wa_settings` — horay ayaa loo sameeyay) |
| Aqoonta ganacsiga + log-ga fariimaha | **Google Sheets** (Apps Script) |

## 🚀 Online u dhig (≈10 daqiiqo)

### 1. GitHub
Samee repo cusub (private waa caadi) → `whatsapp-ai-bot` → faylasha oo dhan ku shub (**Add file → Upload files**).
> `node_modules`, `.env` ha shubin.

### 2. Supabase service key
Supabase → project **My own** → **Project Settings → API Keys** → koobiyee **service_role** (ama *secret* key).
> Furahan sir ayuu yahay — kaliya Render ku geli.

### 3. Render
1. https://render.com → GitHub ku gal
2. **New → Blueprint** → dooro repo-ga `whatsapp-ai-bot` (`render.yaml` ayuu akhrinayaa)
3. Geli qiimaha la weydiiyo:
   - `AI_API_KEY` — Gemini key bilaash ah: https://aistudio.google.com/apikey → **Create API key**
   - `ADMIN_PASSWORD` — password adag (dashboard-ku waa online!)
   - `SUPABASE_SERVICE_KEY` — tallaabada 2
   - `SHEET_WEBAPP_URL`, `SHEET_SECRET` — tallaabada 4 (hadda madhan ka dhig, kadib ku dar)
4. **Apply** → sug ilaa "Live" (2-4 daqiiqo)

### 4. QR scan garee
Fur `https://whatsapp-ai-bot-xxxx.onrender.com` → password → tab-ka **Xiriirka** → telefoonka: WhatsApp → **Linked devices → Link a device** → scan. ✅

Login-ku Supabase ayuu ku kaydsan yahay — server-ku haddii uu dib u kaco ama aad update sameyso, **QR mar kale looma baahna**.

### 5. Google Sheet (ikhtiyaari, laakiin la taliyay)
1. Google Sheet cusub → **Extensions → Apps Script** → `Code.gs` ku dheji
2. `SECRET` beddel, `BOT_URL` = URL-ka Render
3. Run → `setup` (3 sheet: Aqoonta, Fariimaha, Macaamiisha)
4. Run → `installKeepAlive` → 5 daqiiqo kasta bot-ka ayuu "toosiyaa" (Render free ma seexan doono)
5. **Deploy → New deployment → Web app** · Execute as: *Me* · Access: *Anyone* → URL-ka `/exec`
6. Render → **Environment** → `SHEET_WEBAPP_URL` iyo `SHEET_SECRET` geli → Save (wuu dib u kacayaa)

## ✨ Waxa uu qabto
- 🤖 Jawaab toos ah oo Soomaali ah, xasuusta sheeko kasta
- 📄 Macluumaadka Sheet-ka **Aqoonta** (5 daqiiqo kasta la cusbooneysiiyo)
- 👤 Markaad telefoonka ama dashboard-ka ka jawaabto → bot-ku 30 daqiiqo wuu aamusaa sheekadaas
- 🙋 Su'aal uusan garanayn → adiga ayuu kuu gudbiyaa (dashboard: "Adiga ku sugaya")
- 🧠 Fariimo isku xiga → hal jawaab · groups/status waa la iska dhaafaa
- 🧪 Habaynta → AI-ga tijaabi adigoon WhatsApp isticmaalin

## 🤖 AI kale ku beddel
Render → Environment → `AI_PROVIDER` beddel:
| AI_PROVIDER | Qiimo | Key |
|---|---|---|
| `gemini` (default) | Bilaash | https://aistudio.google.com/apikey |
| `groq` | Bilaash | https://console.groq.com/keys |
| `openrouter` | Bilaash (models `:free`) | https://openrouter.ai/keys |
| `openai` | Lacag | https://platform.openai.com/api-keys |
| `claude` | Lacag | https://console.anthropic.com |

Model gaar ah: `AI_MODEL` ku dar (tusaale `gemini-2.5-pro`).

## ⚠️ Ogow
- Gemini free tier: xaddid ayuu leeyahay (fariimo dhowr boqol maalintii). Ganacsi weyn → billing ku dar AI Studio. Xogta free tier-ka Google wuu u isticmaali karaa tababar.
- **Render free**: server-ku 15 daqiiqo oo booqasho la'aan ah kadib wuu seexdaa. Bot-ku naftiisa ayuu ping gareeyaa 10 daqiiqo kasta, Google Sheet-ka `installKeepAlive` na waa kayd labaad. Haddii aad rabto xasillooni buuxda → Render **Starter ($7/bil)**.
- Tani waa xiriir aan rasmi ahayn (WhatsApp Web). Ha u isticmaalin spam — WhatsApp lambarka wuu xannibi karaa.
- WhatsApp ka saar bot-ka: dashboard → Xiriirka → **Ka bax**, ama telefoonka → Linked devices.

## 💻 Local tijaabo
```bash
npm install
cp .env.example .env   # buuxi
npm start              # http://localhost:3000
```
