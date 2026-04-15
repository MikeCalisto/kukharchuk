# kukharchuk.vercel.app

Лендинг міні-курсу **«СПАЛАХ з НУЛЯ»** від Івана Кухарчука.

## Маршрути

- `https://kukharchuk.vercel.app/` — головна (зараз ідентична `/spalah`)
- `https://kukharchuk.vercel.app/spalah` — той самий сайт (підсторінка курсу)

Реалізовано через rewrite у `vercel.json` — єдине джерело контенту `index.html`. Коли головна має стати окремою сторінкою (портфоліо тощо), видаляємо rewrite і створюємо окремий файл для `/spalah/index.html`.

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
