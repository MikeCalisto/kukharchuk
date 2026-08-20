# Сайт Іван Кухарчук — інструкція для Claude Code

> **Ця інструкція автоматично читається Claude Code на старті будь-якої сесії в цьому проєкті. Дотримуйся її жорстко.**

## Що тут лежить

Це багатосторінковий статичний сайт-портал для Івана Кухарчука. Деплоїться на Vercel з GitHub-репо `MikeCalisto/kukharchuk` → продовий домен **https://kukharchuk.vercel.app**.

```
.
├── index.html              # головна (також віддається як /spalah)
├── spalah-ubt/index.html   # ⚠ згенерований артефакт — НЕ редагувати вручну (sync з index.html)
├── vsl/index.html          # video sales letter
├── politika/index.html     # політика конфіденційності
├── oferta/index.html       # публічна оферта
├── images/                 # всі картинки сайту (AVIF + JPG через <picture>)
│   └── _orig/              # бекапи оригіналів (gitignored)
├── shared/                 # файли, які копіюються в кожну сторінку як-є
│   ├── meta-pixel.html       (Pixel ID: 575472658733301)
│   ├── footer.html           (legal footer — ФОП, дисклеймер, лінки)
│   └── footer.css            (стилі футера)
├── templates/
│   └── page-template.html  # стартовий скелет для нової сторінки
├── scripts/
│   └── sync-ubt.sh         # auto-sync index.html → spalah-ubt/index.html
├── .git/hooks/pre-commit   # запускає sync-ubt.sh перед кожним комітом
├── vercel.json             # rewrites для clean URLs
└── README.md
```

## Робочий процес: «один чат — одна сторінка»

Користувач запускатиме окремі чати в Claude Code для кожної нової сторінки. **Кожен чат має суворо дотримуватись принципу мінімального втручання.**

### Створення нової сторінки

Коли користувач просить «створити сторінку про X» / «зробити лендинг для Y»:

1. **Спитай у користувача обов'язкові параметри** (якщо не вказано в першому повідомленні):
   - **slug** для URL (напр. `studio-light`, `flash-pro`, `intensive`)
   - **тема/позиціонування** сторінки
   - **куди веде CTA** (URL оплати або форма)
   - чи потрібне відео (YouTube ID)
   - чи є фото для додавання
   - чи має бути окремий дизайн (інші кольори/шрифти) або в стилі основного бренду

2. **Скопіюй `templates/page-template.html` у `<slug>/index.html`**:
   ```bash
   mkdir -p <slug>
   cp templates/page-template.html <slug>/index.html
   ```

3. **Додай rewrite у `vercel.json`** (єдиний файл поза папкою `<slug>/`, який ти редагуєш):
   ```json
   { "source": "/<slug>", "destination": "/<slug>/index.html" },
   { "source": "/<slug>/", "destination": "/<slug>/index.html" }
   ```

4. **Працюй ВИКЛЮЧНО в `<slug>/`**:
   - HTML → `<slug>/index.html`
   - картинки → `<slug>/images/` (або в загальний `/images/<slug>/`)
   - підпапки/scripts всередині `<slug>/`

5. **Закомітай і запуш:**
   ```bash
   git add <slug>/ vercel.json
   git commit -m "Add /<slug> — <one-line description>"
   git push origin main
   ```
   Pre-commit hook сам пересинхронізує `spalah-ubt/index.html` — не торкайся його.

### Що ЗАБОРОНЕНО в новому чаті (без явної команди користувача)

- **Редагувати** `index.html` в корені (це головна + /spalah, sync-target для UBT)
- **Редагувати** `spalah-ubt/index.html` (генерований артефакт)
- **Редагувати** `vsl/`, `politika/`, `oferta/` (існуючі сторінки)
- **Видаляти** будь-що з `images/` (можна тільки додавати)
- **Міняти** `scripts/sync-ubt.sh`, pre-commit hook, `templates/`, `shared/`
- **Перейменовувати** папки чи файли поза своєю `<slug>/`
- **Чистити** vercel.json — лише додавати свій rewrite

Якщо для нового завдання таки треба зачепити щось зі списку — **спочатку спитай у користувача дозволу**.

### Що дозволено

- Створювати **нову** папку `<slug>/` з усім всередині
- Додавати свої картинки в `images/<slug>/` або поряд із своєю сторінкою
- Додати **рівно один** rewrite у `vercel.json` для своєї сторінки
- Робити коміти, що зачіпають **тільки** ваше + `vercel.json`

## Обов'язкове на кожній сторінці

1. **Meta Pixel** (ID `575472658733301`) — вже включений у `templates/page-template.html`. Якщо створюєш сторінку без шаблона — обов'язково склади з `shared/meta-pixel.html`.

2. **Legal footer** (ФОП, дисклеймер, посилання на /politika і /oferta) — вже у шаблоні. На рекламних landing-pages обов'язково: вимога Meta Ads / Google Ads.

3. **Google Fonts preconnect** — вже в шаблоні. Не видаляй — економить ~200ms на першому завантаженні шрифтів.

4. **Performance:** для будь-якого фото на сторінці — `<picture>` з AVIF + JPG fallback. Див. секцію «Зображення» нижче.

## Дизайн: можеш робити свій або брати дефолт

Користувач сам визначає, чи має нова сторінка слідувати «бренду Кухарчука» (помаранчевий + Jost) чи бути в окремій стилістиці. Дефолт у `page-template.html` — помаранчево-кремовий бренд, але він легко перевизначається через CSS-змінні `--accent`, `--dark`, `--font-display`.

Якщо користувач не сказав інакше — застосовуй User-level скіл `landing-design` (`~/.claude/skills/landing-design/SKILL.md`). Там зібрана house-style: типографіка, компоненти, performance-патерни.

## Зображення (КРИТИЧНО)

Кожне фото на сторінці ОБОВ'ЯЗКОВО:

1. **Resize до ~900px по найбільшій стороні** (або 1400px для скрін-шотів з текстом):
   ```bash
   sips --resampleHeightWidthMax 900 -s format jpeg -s formatOptions 78 source.jpg --out images/<slug>/photo.jpg
   ```

2. **Згенерувати AVIF з JPG** (не з PNG! sips ламає альфа-канал на macOS):
   ```bash
   sips -s format avif -s formatOptions 55 images/<slug>/photo.jpg --out images/<slug>/photo.avif
   ```
   ⚠ **ЯКЩО ОРИГІНАЛ — PNG**: спочатку конвертуй PNG→JPG, потім JPG→AVIF. Прямий PNG→AVIF у sips дає прозорі файли (відомий баг).

   ⚠ **sips МОВЧКИ ВІДДАЄ ПРОЗОРИЙ AVIF на частині картинок.** Файл валідний, `sips -g hasAlpha` каже `no`, Preview і `sips -s format png` показують зображення нормально — і тільки браузер малює порожнечу замість фото.
   Баг детермінований (той самий вхід завжди дає той самий результат), але від чого залежить — незрозуміло: не від парності сторін і не від розміру монотонно. Заміряно на одному й тому ж джерелі: `1400x787` — прозорий, `1320x742` — нормальний, `1280x719` — прозорий, `600x800` — нормальний.
   **Лікується зміною розміру:** якщо перевірка (п. 6) показала прозорий AVIF — перегенеруй з іншим `--resampleHeightWidthMax` (крок 40-80px) і перевір знову.

3. **Embed у HTML через `<picture>`**:
   ```html
   <picture>
     <source srcset="images/<slug>/photo.avif" type="image/avif">
     <img src="images/<slug>/photo.jpg" alt="..." loading="lazy" decoding="async">
   </picture>
   ```

4. **Hero-зображення** (LCP) — preload у `<head>`:
   ```html
   <link rel="preload" as="image" href="images/<slug>/hero.avif" type="image/avif" fetchpriority="high">
   <link rel="preload" as="image" href="images/<slug>/hero.jpg" fetchpriority="high">
   ```
   І додай `fetchpriority="high"` на сам `<img>`.

5. **Бекап оригіналів** у `images/_orig/` (gitignored) — на випадок повторної компресії іншими параметрами.

6. **ОБОВ'ЯЗКОВО перевір AVIF у браузері, а не очима.** Прозорий AVIF виглядає як порожня картка й легко проїжджає в прод. У консолі сторінки:
   ```js
   (()=>{const t=u=>new Promise(r=>{const i=new Image();
     i.onload=()=>{const c=document.createElement('canvas');c.width=8;c.height=8;
       const x=c.getContext('2d');x.drawImage(i,0,0,8,8);
       const d=x.getImageData(0,0,8,8).data;let a=0;for(let k=3;k<d.length;k+=4)a+=d[k];
       r({u:u.split('/').pop(),dim:i.naturalWidth+'x'+i.naturalHeight,ok:a/64>250})};
     i.onerror=()=>r({u,ok:false});i.src=u+'?'+Date.now()});
   const urls=[...new Set([...document.querySelectorAll('source[type="image/avif"]')].map(s=>s.srcset))];
   return Promise.all(urls.map(t)).then(a=>JSON.stringify({total:a.length,broken:a.filter(x=>!x.ok)}))})()
   ```
   Має повернути `broken: []`.

## YouTube-відео (якщо є на сторінці)

НЕ embed-ь raw `<iframe>`. Завжди використовуй lite-facade:
- Постер з `https://i.ytimg.com/vi/<VIDEO_ID>/maxresdefault.jpg`
- Червона play-кнопка зверху
- Реальний iframe вантажиться **лише після кліку** через YouTube IFrame API
- Host: `https://www.youtube-nocookie.com`
- Форс якості: `setPlaybackQuality('hd1080')` на `onReady` + повтор на `onPlaybackQualityChange`

Робочий приклад є у `vsl/index.html` — копіюй `<script>` блок звідти.

## Деплой і Vercel

- **Зміни в main → автоматичний деплой Vercel** через ~30-40 секунд
- Перевіряй після push: `curl -sI https://kukharchuk.vercel.app/<slug>`
- GitHub-токен для пушу зберігається в .jsonl-логах попередніх сесій (Claude Code індексує). Якщо `git push` падає з 403/auth — пошукай у `~/.claude/projects/*/*.jsonl` за `ghp_`.

## Sync /spalah-ubt з / (не торкатися)

`spalah-ubt/index.html` — копія `index.html` з підміненим Zenedu-лінком на оплату. Підтримується автоматично:

- `scripts/sync-ubt.sh` — копіює + робить заміну `gMhJvJMAb7hGo36d` → `WV2OTvfOmfEjL7xs`
- `.git/hooks/pre-commit` — викликає `sync-ubt.sh` перед кожним комітом і додає результат до коміту
- При нових чатах **нічого не треба робити** — sync відбувається сам

## Чек-ліст перед `git push`

- [ ] Жоден файл поза `<slug>/` і `vercel.json` не змінено?
- [ ] Картинки → AVIF + JPG (НЕ PNG → AVIF напряму)?
- [ ] Meta Pixel у `<head>`?
- [ ] Legal footer наприкінці `<body>`?
- [ ] Google Fonts preconnect?
- [ ] Pre-commit hook відстріляв (видно у виводі `git commit`)?
- [ ] Після push: `curl /<slug>` повертає 200?

## Контактна інформація проєкту

- **Pixel ID:** `575472658733301`
- **Підтримка (Telegram):** `https://t.me/kukharchuk1`
- **GitHub:** `MikeCalisto/kukharchuk`
- **Production:** `https://kukharchuk.vercel.app`
- **Vercel framework:** Other (статичний HTML, без build-step)
