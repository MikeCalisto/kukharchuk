# kukharchuk.vercel.app

Лендинг міні-курсу **«СПАЛАХ з НУЛЯ»** від Івана Кухарчука.

## Маршрути

- `https://kukharchuk.vercel.app/` — головна
- `https://kukharchuk.vercel.app/spalah` — той самий контент (rewrite на `index.html`)
- `https://kukharchuk.vercel.app/spalah-ubt` — копія для UBT-кампанії з окремим Zenedu-чекаут-лінком
- `https://kukharchuk.vercel.app/politika` — політика конфіденційності
- `https://kukharchuk.vercel.app/oferta` — публічна оферта

`/` і `/spalah` мають єдине джерело — `index.html`.
`/spalah-ubt` — окрема копія в `spalah-ubt/index.html`. Контент завжди дзеркалить `index.html`, відрізняється тільки лінк на оплату.

## Синхронізація `/spalah-ubt`

`spalah-ubt/index.html` — **згенерований артефакт**. Не редагувати вручну.

Скрипт-синхронізатор: [`scripts/sync-ubt.sh`](scripts/sync-ubt.sh) — копіює `index.html` → `spalah-ubt/index.html` і замінює Zenedu-лінк:

| Сторінка | Zenedu link |
|---|---|
| `/` і `/spalah` | `https://app.zenedu.io/l/gMhJvJMAb7hGo36d` |
| `/spalah-ubt` | `https://app.zenedu.io/l/WV2OTvfOmfEjL7xs` |

Запуск вручну:
```bash
bash scripts/sync-ubt.sh
```

**Pre-commit hook** (`.git/hooks/pre-commit`) запускає синхронізатор перед кожним `git commit` і додає результат до коміту → файли не можуть розсинхронізуватись. Хук локальний (не пушиться); на новому клоні треба перевстановити:
```bash
chmod +x scripts/sync-ubt.sh
cp -p .git/hooks/pre-commit.sample .git/hooks/pre-commit  # або написати знову
```

## Локальний перегляд

Це статичний HTML без збірки. Достатньо відкрити `index.html` у браузері, або підняти локальний сервер:

```bash
python3 -m http.server 8000
# далі http://localhost:8000/
```

Для перевірки rewrite саме `/spalah` потрібен Vercel CLI:

```bash
npx vercel dev
```

## Деплой

1. Створити репозиторій на GitHub (наприклад, `kukharchuk`) і залити вміст цієї папки.
2. На [vercel.com](https://vercel.com) імпортувати репозиторій.
3. Framework Preset: **Other** (статичний сайт, build-команди не потрібні).
4. Після першого деплою: Project Settings → Domains — переконатися, що назва проєкту `kukharchuk` (тоді автоматично виходить `kukharchuk.vercel.app`). Якщо ні — перейменувати проєкт.
5. Готово: `kukharchuk.vercel.app` і `kukharchuk.vercel.app/spalah` віддають однаковий контент.
