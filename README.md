# So‘z o‘yini

- 2–5 guruh, 50 o‘yinchi, bitta xona kodi.
- Har boshliq **o‘z 10 so‘zini yashirin** tanlaydi; boshqa guruhlarning so‘zlari ko‘rinmaydi.
- Boshliqlar navbat bilan ishora yozadi, guruh 3 urinishda topadi; har guruhga **3 ishora** beriladi.
- 3-ishora tugagach o‘yin darhol tugaydi: o‘z boshlig‘i tanlagan so‘zlardan **eng ko‘p topgan guruh yutadi**; tenglik bo‘lsa **durang**.
- So‘z bazasi: **10 500** ta ot — avval kundalik va ijtimoiy tarmoqlarda yurgan tanish so‘zlar (mayoq, shisha, qum, suv, aroq, olma, bino, tosh, mushuk, layk, mem…), adabiy/kam uchraydiganlari oxirida. Har 30 so‘zlik taxtaga atigi 1–2 tasi qo‘shiladi. Fe’l, sifat va yordamchi so‘zlar yo‘q. O‘yinlar orasida so‘zlar takror tushmaydi (baza tugaguncha).
- Kunduzgi/kechki rejim, PWA.

## Ishga tushirish

```bash
npm install
npm start
```

`http://localhost:3000` · sinov: `npm test`

## Doimiy havola

`Dockerfile`, `render.yaml`, `railway.json`, `Procfile` tayyor. GitHub’ga yuklab, Render yoki Railway’ga ulang; `/health` tekshiruvi bor.

## Fayllar

- `server.js` — xona, yashirin tanlash, navbat, g‘olib.
- `words.js` — 10 500 ta ot; birinchi 562 tasi kundalik, keyingi 1400 tasi tanish (`DAILY_COUNT`, `FAMILIAR_COUNT`), qolgani kam uchraydigan.
- `tools/build-words.js` — bazani imlo.uz lug‘atidagi `Ot` so‘zlaridan qayta yaratadi; UzbekTagger `word.xml` (Apache-2.0) va chastota ro‘yxati bilan filtrlanadi, kundalik hamda trend so‘zlar qo‘shiladi.
- `public/` — kirish, lobby, tanlash va o‘yin ekranlari.
- `test/smoke.js` — to‘liq o‘yin sinovi.
