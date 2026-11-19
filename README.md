# ELAKOO — сайт-каталог видео по греческому (A2 и B1)

Статический сайт на [Astro](https://astro.build). Видео не хранятся на сайте: их список раз в 4 часа подтягивается из 8 плейлистов YouTube в файл `data/catalog.json`, после чего сайт пересобирается.

- **Хостинг:** ваш сервер `185.183.55.151` (Ubuntu/Debian): nginx отдаёт готовые страницы, HTTPS от Let's Encrypt.
- **Публикация:** GitHub Actions (`deploy.yml`) собирает сайт и копирует его на сервер при каждом изменении.
- **Автообновление:** `sync-youtube.yml` каждые 4 часа забирает видео с YouTube и, если что-то изменилось, сразу публикует сайт.
- **Форма:** небольшой Node-сервер `server/contact-server.mjs` на том же сервере отправляет письма через [Resend](https://resend.com).

## Структура

| Путь | Что там |
|---|---|
| `config/elakoo.config.json` | **ID плейлистов, ссылка на канал, ручная разметка форматов.** Единственный файл, который нужно править. |
| `data/catalog.json` | Снимок каталога. Заполняется автоматически, руками не править. |
| `scripts/sync-youtube.mjs` | Синхронизация с YouTube Data API: все страницы плейлистов, определение Video/Short, сохранение последнего удачного каталога. |
| `src/pages/` | Страницы: главная, `/a2/…` и `/b1/…` (8 разделов), `/videos/`, `/about/`, `/contact/`, `/privacy/`. |
| `src/lib/sections.mjs` | Список 8 разделов. |
| `src/styles/global.css` | Стили. Фирменные цвета задаются в начале файла (`:root`). |
| `functions/api/contact.js` | Логика формы обратной связи (проверка, антиспам, отправка через Resend). |
| `server/contact-server.mjs` | Запускает эту логику на сервере (служба `elakoo-contact`). |
| `deploy/` | Настройка сервера: `server-setup.sh`, конфиг nginx, служба systemd. |
| `public/` | Favicon, картинка для соцсетей (`og-image.png`), `robots.txt`. |

## Как сайт решает, что Short, а что Video

1. **Тематические плейлисты (8 штук)** определяют, в каком разделе показать ролик.
2. **Служебный плейлист «ELAKOO – All Shorts»** (рекомендуется): каждый Short кладётся **и** в тематический плейлист, **и** в All Shorts. Ролики из All Shorts считаются Shorts, все остальные — обычными видео.
3. **Ручная разметка** `formatOverrides` в конфиге важнее всего остального: `"VIDEO_ID": "short"` или `"VIDEO_ID": "video"`.
4. Если плейлиста All Shorts нет (`shortsIndexPlaylistId: null`), новый ролик без ручной разметки **не показывается** на сайте, пока его не разметят. Список таких роликов выводится в логе синхронизации (GitHub → Actions → Sync YouTube catalog) и сохраняется в `data/catalog.json` → `needsClassification`.

Ролик, который есть только в All Shorts и нет ни в одном тематическом плейлисте, на сайте не показывается.

## Первый запуск (владелец)

### 1. Заполнить конфиг
В `config/elakoo.config.json` впишите:
- `channelUrl`, например `"https://www.youtube.com/@elakoo_greek"`;
- 8 ID плейлистов в `sectionPlaylists`. ID — это часть ссылки после `list=`, например `PLxxxxxxxx`;
- `shortsIndexPlaylistId` — ID плейлиста All Shorts (или `null`).

Пока ID пустые (`null`), сайт работает и показывает «New videos are coming soon». Кнопки YouTube скрыты, пока не задан `channelUrl`.

### 2. Домен → сервер
В DNS домена (у регистратора или в Cloudflare) создайте две записи:

| Тип | Имя | Значение |
|---|---|---|
| A | `@` (elakoo.com) | `185.183.55.151` |
| A | `www` | `185.183.55.151` |

Если DNS в Cloudflare, поставьте у записей **Proxy status: DNS only** (серое облако), хотя бы на время получения сертификата.

### 3. Настройка сервера (один раз, кнопкой в GitHub)
1. GitHub → репозиторий → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SERVER_HOST` = `185.183.55.151`
   - `SERVER_ROOT_PASSWORD` = пароль root от сервера
2. **Actions → Server setup (one time) → Run workflow.** Скрипт поставит nginx, Node.js, файрвол, службу формы и, если домен уже смотрит на сервер, HTTPS-сертификат.
3. Откройте лог запуска. Между строками `=====` будет ключ (от `-----BEGIN OPENSSH PRIVATE KEY-----` до `-----END…-----` включительно). Скопируйте его в новый секрет **`SERVER_SSH_KEY`**.
4. Удалите лог этого запуска (страница запуска → `…` → Delete workflow run). После этого секрет `SERVER_ROOT_PASSWORD` можно удалить.
5. **Actions → Deploy to server → Run workflow.** Сайт появится на сервере.

Если HTTPS не получился, потому что DNS ещё не обновился, подождите и снова запустите **Server setup**. Повторный запуск безопасен и новый ключ не создаёт.

### 4. Ключ YouTube API
1. Откройте [console.cloud.google.com](https://console.cloud.google.com), создайте проект, затем APIs & Services → Library → **YouTube Data API v3** → Enable.
2. Credentials → Create credentials → API key. В настройках ключа: API restrictions → только YouTube Data API v3.
3. Добавьте GitHub-секрет `YOUTUBE_API_KEY` со значением ключа.

### Форма обратной связи (Resend)
1. Зарегистрируйтесь на resend.com → Domains → добавьте `elakoo.com` и DNS-записи, которые покажет Resend.
2. API Keys → создайте ключ.
3. Добавьте GitHub-секреты: `RESEND_API_KEY`, `CONTACT_TO_EMAIL` (куда приходят письма), `CONTACT_FROM_EMAIL` (например `Elakoo website <no-reply@elakoo.com>`).
4. Запустите **Deploy to server**: ключи запишутся на сервер в `/etc/elakoo/contact.env`.

Пока ключей нет, форма честно отвечает «not available right now», а не делает вид, что письмо отправлено.

### 5. Первая синхронизация
GitHub → Actions → **Sync YouTube catalog** → Run workflow. Через 1–2 минуты в `data/catalog.json` появятся видео, и сайт сам опубликуется на сервере.

## Публикация новых видео (каждый раз)

1. Загрузите видео на YouTube.
2. Добавьте его в нужный тематический плейлист (например, A2 · Speaking Part 1).
3. Если это Short, добавьте его ещё и в **ELAKOO – All Shorts**.
4. Всё. В течение 4 часов видео появится на сайте. Чтобы быстрее — Actions → Sync YouTube catalog → Run workflow.

Удалили ролик из плейлиста — после следующей синхронизации он пропадёт из этого раздела.

## Компиляции (необязательно)
Если длинное видео собрано из Shorts, можно показать под ним «Short clips in this compilation»:
```json
"compilations": { "ID_ДЛИННОГО_ВИДЕО": ["ID_SHORT_1", "ID_SHORT_2"] }
```
Связи задаются только вручную; по названиям сайт ничего не угадывает.

## Надёжность
- Если YouTube API недоступен или вернул ошибку, `data/catalog.json` не меняется, и сайт продолжает показывать последний удачный каталог. Ошибка видна в GitHub → Actions (красный значок; GitHub также присылает письмо).
- Если API вдруг вернул 0 видео, а раньше они были, синхронизация останавливается. Если плейлисты действительно опустели, запустите её вручную с галочкой `force`.
- Ключ API хранится только в GitHub Secrets и в браузер не попадает.
- На сервере GitHub заходит под отдельным пользователем `deploy` по SSH-ключу. Этот пользователь может только класть файлы сайта и перезапускать службу формы.
- nginx ограничивает частоту отправки формы. Дополнительно сервер формы пропускает не больше 5 писем в час с одного IP.

## Локальная разработка
```bash
npm install
npm run dev        # http://localhost:4321
npm test           # тесты логики каталога
npm run build      # сборка в dist/
YOUTUBE_API_KEY=... npm run sync   # синхронизация вручную
```

## Что сделано сознательно просто
- Лишние кнопки не показываются: кнопки YouTube и ссылки на плейлисты скрыты, пока не заданы реальные ID.
- Плеер YouTube (youtube-nocookie.com) загружается только после нажатия Play.
- Метрики не подключены. У ссылок есть атрибуты `data-track` (open-video, open-youtube, choose-section и т. п.), чтобы позже подключить, например, Cloudflare Web Analytics или Plausible без правки разметки.
- Turnstile (капча) в коде формы поддерживается через `TURNSTILE_SECRET_KEY`, но виджет в форму не добавлен. Не задавайте эту переменную, пока не добавлен виджет: без него форма перестанет отправляться.
- Код формы совместим и с Cloudflare Pages Functions, если когда-нибудь решите переехать.

## Что нужно от владельца
- [x] Ссылка на канал: https://www.youtube.com/@elakoogreek
- [ ] 8 ID плейлистов (+ ID All Shorts).
- [ ] Логотип (SVG) и фирменные цвета — сейчас стоят временный текстовый логотип и синий `#1f5fc9`.
- [ ] Текст About (сейчас — нейтральный черновик в `src/pages/about/index.astro` и на главной).
- [ ] Email для писем формы и privacy-контакт (дописать в `src/pages/privacy/index.astro`).
