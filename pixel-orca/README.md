# 🐋 Косатка Клик (PIXEL ORCA)

Пиксель-арт кликер с живым мультиплеером: PvP-дуэли и рейды 3×3 между настоящими игроками,
кланы, сезонный ивент и полностью рабочий офлайн-режим.

Клиент — статические файлы без сборки и без зависимостей. Сервер — один файл на Node.js
(стандартные модули, WebSocket написан вручную по RFC 6455), внешних npm-пакетов нет.

---

## Быстрый старт

```bash
# 1. Только игра (работает офлайн, PvP — с ботом)
python3 -m http.server 8080
# открыть http://localhost:8080

# 2. Игра + живой мультиплеер
node server/server.js
# клиент: http://localhost:8080   сервер: http://localhost:8081
```

Клиент сам подключается к `/ws` того же хоста. Чтобы указать другой сервер, задайте
глобальную переменную **до** подключения клиента:

```html
<script>window.PO_SERVER = 'wss://orca.example.com/ws';</script>
```

Если `PO_SERVER` не задан или сервер недоступен, игра честно переходит в офлайн:
накопленный доход считается по времени отсутствия, а в PvP появляется кнопка
«БОЙ С БОТОМ». Симулировать соперников в сетевом режиме нельзя — только живые игроки.

---

## Что внутри

| Возможность | Детали |
|---|---|
| Кликер | криты, множители, апгрейды кликов/монет/дохода, пассивный доход |
| Прогресс | достижения, квесты (daily), боксы, рыбалка, магазин скинов |
| Престиж | сброс слоя с бонусами и «очками силы» |
| Аккаунты | регистрация/вход по паролю, PBKDF2 + соль, токены устройств |
| Облако | сейв на сервере, восстановление по токену, диалог «локально или облако» |
| Кланы | создание, код приглашения, роли, казна и бонус к доходу |
| PvP | лобби (открытые/закрытые/по коду), дуэли на время, награды и билеты |
| Рейды | команды 3×3, поиск соперника, общий счёт команды, награды |
| Сезон | общий ивент, очки за клики в PvP, таблица лидеров |

Всё состояние лежит в одном объекте `ST.state` и сохраняется в `localStorage`
(ключ `pixel-orca-save-v3`).

---

## Сервер

```bash
node server/server.js
```

Переменные окружения:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `8081` | порт HTTP + WebSocket |
| `HOST` | `0.0.0.0` | адрес прослушивания |
| `DATA_FILE` | `server/data/db.json` | файл базы |
| `PVP_MS` | `30000` | длительность дуэли |
| `RAID_MS` | `60000` | длительность рейда |
| `TICK` | `250` | период рассылки тиков боя |
| `SEASON_MS` | `30 дней` | длина сезона |

HTTP-эндпоинты: `GET /` (статика, если положить клиент рядом), `GET /api/health`
(состояние: игроки, аккаунты, кланы, лобби, команды, остаток сезона).

### Протокол

Клиент шлёт JSON-сообщения `{ t, rid, ... }`, сервер отвечает `{ t, rid, ... }`.
`rid` — идентификатор запроса (данные не должны его затирать), ответы на запросы
повторяют `rid`, события приходят без него.

Основные типы сообщений:

```
auth:register  auth:login  auth:logout  resume
save  load
lb  clans  clan:create  clan:join  clan:leave  clan:delete  clan:donate
pvp:lobbies  pvp:create  pvp:join  pvp:joinCode  pvp:ready  pvp:leave  pvp:clicks
raid:teams  raid:create  raid:join  raid:leave  raid:search  raid:clicks
event:info
```

Ошибка приходит как `{ t: '<тип>:err', rid, msg }` и превращается в `Error` с этим
текстом. Сервер ограничивает поток (40 сообщений/сек, 200 для кликов боя) и отвечает
ошибкой, а не молча роняет запрос.

---

## Тесты

```bash
node tools/checkclient.mjs     # статическая целостность клиента
node tools/checksprites.mjs    # спрайты и палитра
node tools/smoke-client.mjs    # клиент в мини-DOM: клики, магазин, квесты, сейв, офлайн
node tools/smoke-server.mjs    # сервер напрямую: 3 клиента, PvP, рейд, кланы
node tools/smoke-online.mjs    # сквозной: настоящие js/*.js против живого сервера
```

`smoke-online.mjs` поднимает временный сервер на случайном порту, подключает несколько
настоящих клиентов через native WebSocket и проверяет весь путь: регистрация, облачный
сейв, авто-вход по токену, кланы, живой PvP с кликами, рейд 3×3 с общим счётом,
сезонный ивент и поведение клиента при падении сервера. Тест самодостаточен:
подбирает свободный порт, чистит за собой сервер и временную базу.

Диагностика: `PO_SRVLOG=1 node tools/smoke-online.mjs` — печатает лог сервера;
`PO_QUEST=2 node tools/smoke-client.mjs` — меняет объём прогонов офлайн-теста.

---

## Деплой

Схема: **фронтенд — статика на GitHub Pages**, **бэкенд — процесс на PaaS с WebSocket**.
Всё нужное для этого лежит в корне репозитория: `Dockerfile`, `render.yaml`, `fly.toml`,
`Procfile`, `.env.example` и воркфлоу `.github/workflows/pages.yml`.

```
GitHub Pages  ──── https://catmaikl777.github.io/SHOOOTERR/
   (index.html, css, js, img, sw.js)          статика, ~250 КБ
        │  wss://
        ▼
PaaS (Render / Fly / Railway)  ──── WebSocket /ws + /api/health
   (server/server.js, база на постоянном диске)
```

Один адрес настраивается в одном месте — `pixel-orca/js/config.js`, поле `server`.
Его меняет сборочный скрипт, руками править не нужно.

### Шаг 1. Бэкенд на PaaS

**Render (самый простой путь).** New → Blueprint → укажи репозиторий. Всё уже описано
в `render.yaml`: план, регион, health-check и **диск на 1 ГБ**. Free-план брать нельзя:
через 15 минут простоя сервис засыпает и обрывает живые бои.

**Fly.io.**
```bash
fly volumes create kosatka_data --size 1
fly deploy
fly secrets set PUBLIC_URL=https://kosatka.fly.dev
fly scale count 1        # больше одной машины нельзя: лобби живут в памяти процесса
```

**Railway.** New Project → Deploy from repo (Dockerfile подхватится сам) → добавь
Volume на `/data`. Start command не нужен, но можно задать `node pixel-orca/server/server.js`.

**Что обязательно настроить:**

| Переменная | Значение | Зачем |
|---|---|---|
| `DATA_FILE` | `/data/db.json` | путь на **постоянном** диске |
| диск/volume | `/data` | без него аккаунты и кланы пропадают после каждого деплоя |
| `PORT` | платформа подставит сама | не переопределяй |
| `HOST` | `0.0.0.0` | слушать все интерфейсы |
| `PUBLIC_URL` | `https://<app>.onrender.com` | только для лога при старте |

Проверка, что бэкенд жив:
```bash
curl https://<app>.onrender.com/api/health
# {"ok":true,"uptime":42,"players":0,"accounts":3,...}
```

### Шаг 2. Фронтенд на GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** → добавить `PO_SERVER_URL`
   со значением `wss://<app>.onrender.com/ws` (именно Variables, не Secret).
3. Ветка `main` уже настроена: пуш в неё собирает и публикует сайт.

Что происходит при пуше: `prepare-pages.mjs` копирует в `dist/` только браузерные файлы,
подставляет `PO_SERVER_URL` в `js/config.js`, пересобирает список precache в `sw.js` и
проверяет, что в сборке нет битых ссылок и абсолютных путей; воркфлоу публикует `dist/`.

Если задеплоить вручную (без Actions):
```bash
cd pixel-orca
node tools/prepare-pages.mjs wss://<app>.onrender.com/ws
node tools/serve-pages.mjs       # локально посмотреть ровно то, что уедет на Pages
```

### Шаг 3. Проверка перед боем

```bash
cd pixel-orca
npm test                          # клиент + сервер + живой сквозной прогон
npm run test:dist                 # те же живые тесты, но на собранном dist/
```

В браузере на странице GitHub Pages должно быть: в HUD — «онлайн» вместо «офлайн»,
в консоли `new WebSocket('wss://…/ws')` со статусом 101, а вкладка Network — один
долгий WebSocket-запрос к бэкенду.

### Частые грабли

- **Сайт открылся, но «офлайн».** Не задана `PO_SERVER_URL` либо в ней `http://`
  вместо `wss://`. Проверь `pixel-orca/dist/js/config.js` — там должен быть адрес.
- **Страница перестала грузиться после деплоя.** Залипший service worker: обновить
  с очисткой (в DevTools → Application → Unregister) или подождать смены версии кэша.
- **Обрывы боёв на Render free.** Нужен платный план, иначе сервис спит.
- **Всё пропало после рестарта.** Не смонтирован диск под `DATA_FILE`.
- **404 на `/ws`.** Прокси не пробрасывает `Upgrade` — на Render/Fly/Railway это
  работает из коробки, за nginx нужен `proxy_set_header Upgrade $http_upgrade;`.
- **Две реплики бэкенда.** Лобби, рейды и аккаунты живут в памяти процесса,
  вторая машина = второй параллельный мир. Масштабировать только вертикально.

---

## Структура

```
pixel-orca/
  index.html            разметка, HUD, окна
  sw.js                 service worker: офлайн-кэш оболочки
  manifest.webmanifest  PWA-манифест (установка на телефон)
  .nojekyll             чтобы Jekyll на Pages не выкинул файлы
  css/pixel.css         пиксельный UI
  js/config.js          адрес WebSocket-сервера — единственное место для деплоя
  js/state.js           состояние, формулы, сейв, престиж
  js/main.js            boot, игровой цикл, HUD, настройки, регистрация SW
  js/api.js             WebSocket-клиент, аккаунты, облачный сейв
  js/social.js          кланы, лидерборд, сезонный ивент
  js/battle.js          PvP и рейды
  js/shop.js  quests.js  rewards.js  fishing.js  fx.js  ui.js  audio.js
  js/sprites.js         все спрайты — ASCII-сетки, рендерятся в canvas
  js/clicker.js  js/data.js
  img/                  иконки PWA (генерируются tools/make-icons.mjs)
  server/server.js      WebSocket-сервер и вся игровая логика онлайна
  server/data/          база (в репозиторий не попадает)
  tools/                тесты и сборка
корень репозитория/
  Dockerfile  render.yaml  fly.toml  Procfile  .env.example
  .github/workflows/pages.yml   автодеплой статики на GitHub Pages
  .github/workflows/ci.yml      тесты на каждый пуш
```
