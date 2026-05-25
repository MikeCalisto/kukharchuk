# ZenEdu UTM-tracking + Google Sheets — setup

Двочастинна аналітика для лендингу `/presets`:
- **Часть А (Stage 0 ✅ — задеплоєно):** UTM з URL запам'ятовуються в `localStorage` і автоматично доклеюються до Zenedu-посилання при натисканні «Оплатити».
- **Часть Б — Stage 0 ✅ (тільки прийом + лог), Stage 1 ⏳ (запис у Sheets):** API-ендпоінт `/api/zenedu-webhook` приймає вебхук від ZenEdu після оплати.

Після того як ZenEdu починає слати реальні payload, Stage 1 додає маппінг полів і запис рядка в Google Sheets.

---

## КРОК 1. Створити Google-таблицю

1. Зайти на [sheets.google.com](https://sheets.google.com), створити нову таблицю
2. Перейменувати перший лист на **`Sales`**
3. У першому рядку вставити заголовки (одним рядком через `Tab`):

```
Дата оплати	UUID замовлення	Telegram	Імʼя	Тариф	Сума	Валюта	Платіжна система	utm_source	utm_medium	utm_campaign	utm_term	utm_content	Джерело
```

4. З URL таблиці скопіювати ID — це частина між `/d/` і `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/[ОЦЕ ID]/edit
   ```

## КРОК 2. Створити Service Account у Google Cloud

1. [console.cloud.google.com](https://console.cloud.google.com) → створити новий проект (або обрати існуючий)
2. «APIs & Services» → **Library** → знайти **Google Sheets API** → натиснути **Enable**
3. «IAM & Admin» → **Service Accounts** → **Create Service Account**
4. Назва: `zenedu-webhook` (або інша) → Create → Done
5. Відкрити створений аккаунт → вкладка **Keys** → **Add Key** → **Create new key** → формат **JSON** → завантажиться файл-ключ
6. Відкрити JSON, скопіювати email з поля `"client_email"` (вигляду `zenedu-webhook@xxx.iam.gserviceaccount.com`)

## КРОК 3. Поділитись таблицею з Service Account

1. Відкрити Google-таблицю → кнопка **Share** у правому верхньому куті
2. Вставити email сервіс-аккаунта
3. Дати права **Editor**
4. Зняти галку **Notify people** (на цей email нікому писати не треба)
5. Send

## КРОК 4. Додати ENV у Vercel

Vercel project → **Settings** → **Environment Variables** (додавати для всіх трьох середовищ: Production, Preview, Development):

| Назва | Значення | Як отримати |
|---|---|---|
| `ZENEDU_WEBHOOK_SECRET` | довгий випадковий рядок | `openssl rand -hex 32` у терміналі |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | весь вміст JSON-ключа однією base64-стрічкою | `base64 -i key.json \| pbcopy` (macOS) |
| `GOOGLE_SHEETS_ID` | ID з URL таблиці (з Кроку 1.4) | — |
| `GOOGLE_SHEETS_TAB_NAME` | `Sales` | (default — можна не задавати) |

Після додавання ENV: **Deployments** → останній deploy → **⋯** → **Redeploy** (щоб ENV підхопились).

## КРОК 5. Додати webhook у ZenEdu

1. Зайти в ZenEdu → **Workspace Settings** → **API & Webhooks**
2. **Create new webhook**:
   - **URL:** `https://kukharchuk.vercel.app/api/zenedu-webhook?token=<ZENEDU_WEBHOOK_SECRET>`
   - **Event:** `order.status.changed`
3. Save

> Альтернативно, якщо ZenEdu вміє слати custom header — можна налаштувати `X-Webhook-Token` замість token у query string. Endpoint розуміє обидва варіанти (а також `Authorization: Bearer ...`).

## КРОК 6. Тест Stage 0 (UTM + лог webhook)

### 6.1 Перевірка UTM-проброса (Часть А)

1. Відкрити в **інкогніто**: `https://kukharchuk.vercel.app/presets?utm_source=test&utm_medium=test&utm_campaign=manual_check`
2. В DevTools (`F12`) → **Application** → **Local Storage** → `kukharchuk.vercel.app` — побачити запис `zenedu_utm` з JSON `{ utm: {...}, expires: ... }`
3. На цій же сторінці натиснути «**Обрати пресети**» → обрати будь-який пак → «**Оплатити N грн →**»
4. У новій вкладці відкриється ZenEdu — у URL повинні бути `utm_source=test&utm_medium=test&utm_campaign=manual_check`

### 6.2 Перевірка webhook (Часть Б Stage 0)

1. На сторінці ZenEdu з Кроку 6.1 — пройти реальну оплату (можна тимчасово створити тариф за $1 або використати найдешевший)
2. Відкрити Vercel → **Functions** → знайти `/api/zenedu-webhook` → переглянути **Logs**
3. Має прилетіти `POST` з повним body — скинути скрін цього log'а, я фіналізую маппінг для Stage 1

## КРОК 7. Посилання для трафіку

- **Блог Івана Кухарчука (UBT):**
  `https://kukharchuk.vercel.app/presets?utm_source=harchuk&utm_medium=blog`
- **Таргет (Facebook/Instagram/etc):** мітки розставляє таргетолог самостійно. Головне — `utm_source` НЕ дорівнює `harchuk`. Уточнити, що саме він пише в `utm_source` (типово `facebook`, `instagram`, `meta`, `tiktok`).

## КРОК 8. Аналітика у Google Sheets

Після Stage 1 (коли почнуть записуватись рядки), створи в таблиці окремий лист `Аналітика` і вставь формулу:

```excel
=QUERY(Sales!A:N; "SELECT N, COUNT(B), SUM(F) GROUP BY N LABEL N 'Джерело', COUNT(B) 'Кількість', SUM(F) 'Виручка'"; 1)
```

Це дасть таблицю: Джерело / Кількість оплат / Сумарна виручка.

---

## Поточний статус

| Етап | Статус | Що зробив |
|---|---|---|
| **А.** UTM capture + propagation | ✅ задеплоєно | `presets/utm.js` модуль, підключений у `<head>`, обгортка `appendUTMToUrl()` у cart-логіці |
| **Б0.** Webhook receiver (log-only) | ✅ задеплоєно | `/api/zenedu-webhook` — Node serverless function, валідація секрету, повний лог body+headers |
| **Б1.** Sheets write | ⏳ після першого реального payload | Додасться маппінг 14 колонок, `googleapis` npm + Service Account auth |

## Файли, які я створив/змінив

- 🆕 `presets/utm.js` — UTM модуль (capture + appendToUrl)
- 🆕 `api/zenedu-webhook.js` — Node serverless function
- 🆕 `ZENEDU_TRACKING_SETUP.md` — цей файл
- ✏️ `presets/index.html` — підключив utm.js у `<head>`, обгорнув pay-URL у `appendUTMToUrl()`
- ✏️ `vercel.json` — додав `functions` config (maxDuration:30 для webhook)

## ENV, які треба додати у Vercel перед Stage 6

| Назва | Required при Stage 0 | Required при Stage 1 |
|---|---|---|
| `ZENEDU_WEBHOOK_SECRET` | ✅ | ✅ |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | — | ✅ |
| `GOOGLE_SHEETS_ID` | — | ✅ |
| `GOOGLE_SHEETS_TAB_NAME` | — | optional (default `Sales`) |
