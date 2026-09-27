/* ============================================================
   PIXEL ORCA — игровые данные и баланс
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------- улучшения ---------- */
  var UPGRADES = [
    { id: 'fin', name: 'Хвостовой плавник', desc: '+1 за клик', icon: 'i_hand', cost: 15, growth: 1.15, kind: 'clickFlat', val: 1 },
    { id: 'voice', name: 'Голос стаи', desc: '+2 за клик', icon: 'i_siren', cost: 120, growth: 1.16, kind: 'clickFlat', val: 2 },
    { id: 'echo', name: 'Эхолокация', desc: '+5 за клик', icon: 'i_crit', cost: 1400, growth: 1.17, kind: 'clickFlat', val: 5 },
    { id: 'power', name: 'Сила стаи', desc: '×1.40 за клик', icon: 'i_magnet', cost: 600, growth: 1.55, kind: 'clickMult', val: 1.4 },
    { id: 'claw', name: 'Когти', desc: '×1.35 за клик', icon: 'i_sword', cost: 6500, growth: 1.6, kind: 'clickMult', val: 1.35 },
    { id: 'crit', name: 'Критический укус', desc: '+2% крит', icon: 'i_crit', cost: 900, growth: 1.2, kind: 'critAdd', val: 2 },
    { id: 'rage', name: 'Ярость', desc: '+25% силы крита', icon: 'i_flame', cost: 4500, growth: 1.22, kind: 'critDmg', val: 0.25 },
    { id: 'combo', name: 'Синхронность', desc: '+1 к множителю комбо', icon: 'i_ladder', cost: 12000, growth: 1.3, kind: 'comboAdd', val: 1 },
    { id: 'luck', name: 'Удачная волна', desc: '+5% к качеству лута', icon: 'i_star', cost: 7000, growth: 1.25, kind: 'luckAdd', val: 0.05 },
    { id: 'mini', name: 'Малыш-автокликер', desc: '+0.5 клика/сек', icon: 'i_bolt', cost: 100, growth: 1.13, kind: 'cpsAdd', val: 0.5 },
    { id: 'hunter', name: 'Охотник-автокликер', desc: '+2 клика/сек', icon: 'i_bolt', cost: 2800, growth: 1.14, kind: 'cpsAdd', val: 2 },
    { id: 'drone', name: 'Дрон-рыболов', desc: '+8 кликов/сек', icon: 'i_bolt', cost: 65000, growth: 1.15, kind: 'cpsAdd', val: 8 },
    { id: 'fleet', name: 'Промышленный флот', desc: '+30 кликов/сек', icon: 'i_bolt', cost: 1600000, growth: 1.16, kind: 'cpsAdd', val: 30 },
    { id: 'tide', name: 'Прилив', desc: '+3% ко всем кликам/сек', icon: 'i_magnet', cost: 95000, growth: 1.18, kind: 'allMult', val: 1.03 },
    { id: 'magnet', name: 'Магнит рыбы', desc: '+40% выручки за рыбу', icon: 'i_fish', cost: 30000, growth: 1.2, kind: 'fishMult', val: 0.4 },
    { id: 'ticket', name: 'Билет удачи', desc: 'Билет ивента за 50 кликов', icon: 'i_book', cost: 500000, growth: 1.4, kind: 'ticketDiv', val: 50 }
  ];

  /* ---------- скины ---------- */
  var SKINS = [
    { id: 'normal', name: 'Обычная', rar: 'common', pal: 'normal', bonus: 0, cost: 0, desc: 'С чего всё начиналось.' },
    { id: 'polar', name: 'Полярная', rar: 'common', pal: 'polar', bonus: 0.03, cost: 50000, desc: 'Ледник где-то в Арктике.' },
    { id: 'kitty', name: 'Котик', rar: 'common', pal: 'kitty', bonus: 0.05, cost: 0, box: 'common', desc: 'Мяу. Да, это косатка-кошка.' },
    { id: 'neon', name: 'Неоновая', rar: 'rare', pal: 'neon', bonus: 0.06, cost: 0, box: 'rare', desc: 'Светится в тёмной воде.' },
    { id: 'ice', name: 'Ледяная', rar: 'rare', pal: 'ice', bonus: 0.07, cost: 0, box: 'rare', desc: 'Холоднее северного течения.' },
    { id: 'cosmo', name: 'Космонавт', rar: 'rare', pal: 'cosmo', bonus: 0.1, cost: 0, box: 'epic', desc: 'Скафандр из подгоревшей звезды.' },
    { id: 'golden', name: 'Золотая', rar: 'epic', pal: 'golden', bonus: 0.1, cost: 500000, desc: 'Дороже всех остальных.' },
    { id: 'pirate', name: 'Пиратская', rar: 'epic', pal: 'pirate', bonus: 0.12, cost: 2000000, desc: 'Йо-хо-хо и кладо из ракушек.' },
    { id: 'galaxy', name: 'Галактика', rar: 'epic', pal: 'galaxy', bonus: 0.14, cost: 0, event: 1, desc: 'Награда за топ ивента.' },
    { id: 'lava', name: 'Лавовая', rar: 'legend', pal: 'lava', bonus: 0.15, cost: 9000000, desc: 'Из вулканического жерла.' },
    { id: 'royal', name: 'Королева', rar: 'legend', pal: 'royal', bonus: 0.18, cost: 0, raid: 5, desc: '5 побед в рейдах.' },
    { id: 'rainbow', name: 'Радужная', rar: 'legend', pal: 'rainbow', bonus: 0.2, cost: 25000000, desc: 'Переливается всеми цветами.' },
    { id: 'ancient', name: 'Древняя', rar: 'legend', pal: 'ancient', bonus: 0.25, cost: 0, prestige: 1, desc: 'Открывается первым сбросом.' }
  ];

  var RAR_COLORS = {
    common: '#7fa8d8', rare: '#4ae0e0', epic: '#c05ae0', legend: '#ffd447'
  };
  var RAR_NAMES = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legend: 'Легендарный' };

  /* ---------- боксы ---------- */
  var BOXES = [
    {
      id: 'squid', name: 'Ящик кальмара', rar: 'common', sprite: 'boxCommon',
      cost: 4000, desc: 'Дешёвый ящик с мелкой добычей.',
      loot: [
        { w: 55, t: 'coins', min: 0.4, max: 1.2 },
        { w: 30, t: 'fish', min: 1, max: 4 },
        { w: 8, t: 'xp', min: 200, max: 900 },
        { w: 5, t: 'shells', min: 1, max: 1 },
        { w: 2, t: 'skin', pool: ['kitty'] }
      ]
    },
    {
      id: 'crystal', name: 'Кристальный бокс', rar: 'rare', sprite: 'boxRare',
      cost: 60000, desc: 'Редкая добыча и шанс на эффект.',
      loot: [
        { w: 45, t: 'coins', min: 1.0, max: 2.4 },
        { w: 25, t: 'fish', min: 4, max: 12 },
        { w: 12, t: 'shells', min: 1, max: 2 },
        { w: 8, t: 'effect' },
        { w: 6, t: 'skin', pool: ['neon', 'ice'] },
        { w: 4, t: 'ticket', min: 1, max: 3 }
      ]
    },
    {
      id: 'chest', name: 'Золотой сундук', rar: 'legend', sprite: 'boxLegend',
      cost: 900000, desc: 'Ракушки, легендарные скины, эффекты.',
      loot: [
        { w: 38, t: 'coins', min: 2.5, max: 6 },
        { w: 18, t: 'fish', min: 10, max: 30 },
        { w: 20, t: 'shells', min: 2, max: 5 },
        { w: 14, t: 'effect' },
        { w: 7, t: 'skin', pool: ['cosmo', 'pirate', 'galaxy'] },
        { w: 3, t: 'ticket', min: 3, max: 8 }
      ]
    },
    {
      id: 'epicBox', name: 'Фиолетовый саркофаг', rar: 'epic', sprite: 'boxEpic',
      cost: 250000, desc: 'Редкие скины и много ракушек.',
      loot: [
        { w: 42, t: 'coins', min: 1.6, max: 4 },
        { w: 20, t: 'fish', min: 6, max: 20 },
        { w: 24, t: 'shells', min: 1, max: 4 },
        { w: 8, t: 'effect' },
        { w: 6, t: 'skin', pool: ['cosmo', 'pirate', 'galaxy'] }
      ]
    }
  ];

  /* ---------- визуальные эффекты ---------- */
  var EFFECTS = [
    { id: 'e1', name: 'Золотой клик', icon: 'i_coin', desc: 'Криты летят золотыми искрами.', rar: 'common' },
    { id: 'e2', name: 'Неоновый свет', icon: 'i_bolt', desc: 'Свечение вокруг косатки.', rar: 'common' },
    { id: 'e3', name: 'Радужный след', icon: 'i_star', desc: 'Радужный шлейф за кликами.', rar: 'rare' },
    { id: 'e4', name: 'Частицы звёзд', icon: 'i_star', desc: 'Звёзды в воде вокруг вас.', rar: 'rare' },
    { id: 'e5', name: 'Волновой эффект', icon: 'i_fish', desc: 'Кольца волн по клику.', rar: 'common' },
    { id: 'e6', name: 'Огненное сияние', icon: 'i_flame', desc: 'Искры пламени поднимаются вверх.', rar: 'epic' },
    { id: 'e7', name: 'Ледяной мороз', icon: 'i_star', desc: 'Снежинки и иней на воде.', rar: 'rare' },
    { id: 'e8', name: 'Тёмная материя', icon: 'i_crit', desc: 'Тёмные пиксельные вихри.', rar: 'epic' },
    { id: 'e9', name: 'Электрический шторм', icon: 'i_bolt', desc: 'Разряды между облаками.', rar: 'epic' },
    { id: 'e10', name: 'Призрачное сияние', icon: 'i_siren', desc: 'Полупрозрачные силуэты косаток.', rar: 'legend' }
  ];

  /* ---------- квесты (основные, последовательные) ---------- */
  var QUESTS = [
    { id: 'q1', name: 'Первые волны', desc: 'Сделай 100 кликов', goal: 100, stat: 'clicks', reward: 500, xp: 60 },
    { id: 'q2', name: 'Обучение стаи', desc: 'Купи 5 улучшений', goal: 5, stat: 'upgradesBought', reward: 1500, xp: 120 },
    { id: 'q3', name: 'Эхо океана', desc: 'Сделай 500 кликов', goal: 500, stat: 'clicks', reward: 5000, xp: 300 },
    { id: 'q4', name: 'Сундуки из глубины', desc: 'Открой 1 бокс', goal: 1, stat: 'boxesOpened', reward: 3, fish: 3, xp: 200 },
    { id: 'q5', name: 'Рыбак', desc: 'Поймай 15 рыб', goal: 15, stat: 'fishCaught', reward: 8000, xp: 400 },
    { id: 'q6', name: 'Дельфин-уровень', desc: 'Сделай 5000 кликов', goal: 5000, stat: 'clicks', reward: 25000, xp: 900 },
    { id: 'q7', name: 'Свой облик', desc: 'Купи любой скин', goal: 1, stat: 'skinsBought', reward: 10000, xp: 600 },
    { id: 'q8', name: 'Победа в бою', desc: 'Выиграй 1 PvP-баттл', goal: 1, stat: 'pvpWins', reward: 30000, xp: 800 },
    { id: 'q9', name: 'Глубина', desc: 'Сделай 50 000 кликов', goal: 50000, stat: 'clicks', reward: 120000, xp: 2000 },
    { id: 'q10', name: 'Новый круг', desc: 'Сделай первый сброс в океан', goal: 1, stat: 'prestiges', reward: 10000, shells: 1, xp: 1500 },
    { id: 'q11', name: 'Рейд', desc: 'Сыграй 1 рейд', goal: 1, stat: 'raidPlayed', reward: 60000, xp: 1200 },
    { id: 'q12', name: 'Легенда океана', desc: 'Сделай 500 000 кликов', goal: 500000, stat: 'clicks', reward: 1000000, shells: 2, xp: 5000 }
  ];

  /* ---------- ежедневные квесты ---------- */
  var DAILY = [
    { id: 'd_click', name: 'Много кликов', desc: 'Сделай 200 кликов', goal: 200, stat: 'clicksDaily', reward: 1500, xp: 150 },
    { id: 'd_fish', name: 'Улов дня', desc: 'Поймай 5 рыб', goal: 5, stat: 'fishCaughtDaily', reward: 2000, fish: 2, xp: 150 },
    { id: 'd_buy', name: 'Инвестор', desc: 'Купи 3 улучшения', goal: 3, stat: 'upgradesBoughtDaily', reward: 1200, xp: 120 },
    { id: 'd_box', name: 'Сокровище', desc: 'Открой 1 бокс', goal: 1, stat: 'boxesOpenedDaily', reward: 1800, xp: 130 },
    { id: 'd_pvp', name: 'Дуэлянт', desc: 'Выиграй 1 PvP-баттл', goal: 1, stat: 'pvpWinsDaily', reward: 3000, xp: 200 },
    { id: 'd_exchange', name: 'Барыга', desc: 'Обменяй рыбу на косаток', goal: 1, stat: 'exchangesDaily', reward: 2500, xp: 160 },
    { id: 'd_raid', name: 'Командный бой', desc: 'Сыграй в рейде', goal: 1, stat: 'raidPlayedDaily', reward: 4000, xp: 250 }
  ];

  /* ---------- достижения ---------- */
  var ACHIEVEMENTS = [
    { id: 'a_click100', name: 'Первая кровь', desc: '100 кликов', goal: 100, stat: 'clicks', reward: 200, xp: 50 },
    { id: 'a_click1k', name: 'Тысячник', desc: '1 000 кликов', goal: 1000, stat: 'clicks', reward: 3000, xp: 200 },
    { id: 'a_click10k', name: 'Десятитысячник', desc: '10 000 кликов', goal: 10000, stat: 'clicks', reward: 40000, xp: 800 },
    { id: 'a_click100k', name: 'Кликер-машина', desc: '100 000 кликов', goal: 100000, stat: 'clicks', reward: 600000, xp: 3000 },
    { id: 'a_click1m', name: 'Миллион кликов', desc: '1 000 000 кликов', goal: 1000000, stat: 'clicks', reward: 8000000, shells: 2, xp: 9000 },
    { id: 'a_lvl10', name: 'Новичок стаи', desc: 'Достичь 10 уровня', goal: 10, stat: 'level', reward: 5000, xp: 300 },
    { id: 'a_lvl25', name: 'Опытный кит', desc: 'Достичь 25 уровня', goal: 25, stat: 'level', reward: 50000, xp: 1200 },
    { id: 'a_lvl50', name: 'Легенда океана', desc: 'Достичь 50 уровня', goal: 50, stat: 'level', reward: 500000, xp: 4000 },
    { id: 'a_lvl100', name: 'Император глубин', desc: 'Достичь 100 уровня', goal: 100, stat: 'level', reward: 10000000, shells: 5, xp: 15000 },
    { id: 'a_coin10k', name: 'Первые 10k', desc: 'Накопить 10 000 косаток всего', goal: 10000, stat: 'totalCoins', reward: 1000, xp: 80 },
    { id: 'a_coin1m', name: 'Миллион косаток', desc: 'Накопить 1 000 000 всего', goal: 1000000, stat: 'totalCoins', reward: 20000, xp: 400 },
    { id: 'a_coin1b', name: 'Миллиард косаток', desc: 'Накопить 1 000 000 000 всего', goal: 1e9, stat: 'totalCoins', reward: 1000000, shells: 3, xp: 6000 },
    { id: 'a_cps10', name: 'Автоматизация', desc: 'Выйти на 10 кликов/сек', goal: 10, stat: 'bestCps', reward: 8000, xp: 300 },
    { id: 'a_cps100', name: 'Стая автоматов', desc: 'Выйти на 100 кликов/сек', goal: 100, stat: 'bestCps', reward: 200000, xp: 2000 },
    { id: 'a_cps1000', name: 'Морская электростанция', desc: 'Выйти на 1000 кликов/сек', goal: 1000, stat: 'bestCps', reward: 3000000, xp: 8000 },
    { id: 'a_click10', name: 'Клик за 10', desc: 'Клик даёт 10 косаток', goal: 10, stat: 'bestPerClick', reward: 5000, xp: 200 },
    { id: 'a_click1k', name: 'Клик за 1000', desc: 'Клик даёт 1000 косаток', goal: 1000, stat: 'bestPerClick', reward: 300000, xp: 2500 },
    { id: 'a_crit100', name: 'Снайпер', desc: '50 критических кликов', goal: 50, stat: 'crits', reward: 6000, xp: 250 },
    { id: 'a_crit1000', name: 'Мастер крита', desc: '1000 критических кликов', goal: 1000, stat: 'crits', reward: 200000, xp: 2000 },
    { id: 'a_crit10k', name: 'Критический ураган', desc: '10 000 критических кликов', goal: 10000, stat: 'crits', reward: 3000000, xp: 9000 },
    { id: 'a_fish10', name: 'Новичок рыбак', desc: 'Поймать 10 рыб', goal: 10, stat: 'fishCaught', reward: 1500, xp: 100 },
    { id: 'a_fish100', name: 'Рыбак', desc: 'Поймать 100 рыб', goal: 100, stat: 'fishCaught', reward: 30000, xp: 500 },
    { id: 'a_fish500', name: 'Магнат рыбы', desc: 'Поймать 500 рыб', goal: 500, stat: 'fishCaught', reward: 400000, shells: 1, xp: 2500 },
    { id: 'a_fish1000', name: 'Хозяин океана', desc: 'Поймать 1000 рыб', goal: 1000, stat: 'fishCaught', reward: 4000000, shells: 3, xp: 8000 },
    { id: 'a_boxes5', name: 'Коллекционер', desc: 'Открыть 5 боксов', goal: 5, stat: 'boxesOpened', reward: 8000, xp: 200 },
    { id: 'a_boxes50', name: 'Скупой рыцарь', desc: 'Открыть 50 боксов', goal: 50, stat: 'boxesOpened', reward: 200000, xp: 1500 },
    { id: 'a_boxes200', name: 'Сундучный магнат', desc: 'Открыть 200 боксов', goal: 200, stat: 'boxesOpened', reward: 3000000, shells: 2, xp: 8000 },
    { id: 'a_skins3', name: 'Коллекция обликов', desc: 'Купить 3 скина', goal: 3, stat: 'skinsBought', reward: 25000, xp: 500 },
    { id: 'a_skins8', name: 'Гардероб', desc: 'Купить 8 скинов', goal: 8, stat: 'skinsBought', reward: 2000000, xp: 4000 },
    { id: 'a_allSkins', name: 'Все формы', desc: 'Открыть все 13 скинов', goal: 13, stat: 'skinsUnlocked', reward: 5000000, shells: 4, xp: 10000 },
    { id: 'a_allFx', name: 'Полный набор', desc: 'Открыть все 10 эффектов', goal: 10, stat: 'effectsUnlocked', reward: 5000000, shells: 4, xp: 10000 },
    { id: 'a_pvp1', name: 'Дебютант', desc: 'Выиграть 1 PvP', goal: 1, stat: 'pvpWins', reward: 15000, xp: 300 },
    { id: 'a_pvp10', name: 'Дуэлянт', desc: 'Выиграть 10 PvP', goal: 10, stat: 'pvpWins', reward: 200000, xp: 1500 },
    { id: 'a_pvp50', name: 'Чемпион арены', desc: 'Выиграть 50 PvP', goal: 50, stat: 'pvpWins', reward: 3000000, shells: 3, xp: 9000 },
    { id: 'a_raid5', name: 'Капитан команды', desc: 'Выиграть 5 рейдов', goal: 5, stat: 'raidWins', reward: 300000, xp: 2000 },
    { id: 'a_prestige1', name: 'Отпусти рыбу', desc: 'Сделать 1 сброс в океан', goal: 1, stat: 'prestiges', reward: 20000, xp: 800 },
    { id: 'a_prestige5', name: 'Круговорот', desc: 'Сделать 5 сбросов', goal: 5, stat: 'prestiges', reward: 1000000, shells: 3, xp: 6000 },
    { id: 'a_prestige20', name: 'Вечная волна', desc: 'Сделать 20 сбросов', goal: 20, stat: 'prestiges', reward: 20000000, shells: 10, xp: 30000 },
    { id: 'a_clan', name: 'Не один в океане', desc: 'Вступить в клан', goal: 1, stat: 'clanJoined', reward: 10000, xp: 200 },
    { id: 'a_shells10', name: 'Собиратель ракушек', desc: 'Скопить 10 ракушек', goal: 10, stat: 'shellsTotal', reward: 100000, xp: 1000 },
    { id: 'a_event1', name: 'Участник ивента', desc: 'Заработать 50 билетов ивента', goal: 50, stat: 'ticketsTotal', reward: 100000, xp: 800 },
    { id: 'a_combo30', name: 'Синхронность', desc: 'Комбо x30', goal: 30, stat: 'bestCombo', reward: 60000, xp: 1000 }
  ];

  /* ---------- ежедневная награда (7 дней) ---------- */
  var DAILY_REWARD = [
    { coins: 500, label: '500 косаток' },
    { coins: 1200, label: '1 200 косаток' },
    { fish: 5, label: '5 рыб' },
    { coins: 4000, label: '4 000 косаток' },
    { shells: 1, label: '1 ракушка' },
    { boost: 1, label: 'Удвоение на 1 час' },
    { coins: 50000, label: '50 000 косаток' }
  ];

  /* ---------- рыбалка ---------- */
  var FISH_TYPES = [
    { id: 'fish', name: 'Рыбка', sprite: 'fish', w: 62, val: 1, speed: 1 },
    { id: 'goldfish', name: 'Золотая рыбка', sprite: 'goldfish', w: 24, val: 6, speed: 1.25 },
    { id: 'spacefish', name: 'Космо-рыба', sprite: 'spacefish', w: 10, val: 22, speed: 1.5 },
    { id: 'crab', name: 'Краб', sprite: 'crab', w: 4, val: 40, speed: 0.5 }
  ];

  /* ---------- бонусы на поле ---------- */
  var FIELD_BONUSES = [
    { id: 'x2', name: 'x2 на 30 сек', sprite: 'starX2', color: '#ffd447', dur: 30000 },
    { id: 'rain', name: 'Дождь косаток x3 (15 сек)', sprite: 'coin', color: '#4ad07a', dur: 15000 },
    { id: 'storm', name: 'Шторм критов (15 сек)', sprite: 'critSkull', color: '#e04a5a', dur: 15000 },
    { id: 'school', name: 'Стая рыб (+5)', sprite: 'fish', color: '#4ae0e0', instant: true },
    { id: 'shell', name: 'Ракушка в океане', sprite: 'shell', color: '#f0d0a0', instant: true }
  ];

  /* ---------- ранг по уровню ---------- */
  var RANKS = [
    { lvl: 1, name: 'Малыш-дельфин' },
    { lvl: 5, name: 'Юный косатка' },
    { lvl: 10, name: 'Косатка-охотник' },
    { lvl: 20, name: 'Матёрый кит' },
    { lvl: 35, name: 'Капитан стаи' },
    { lvl: 50, name: 'Легенда океана' },
    { lvl: 75, name: 'Покровитель глубин' },
    { lvl: 100, name: 'Император пиксельных волн' }
  ];

  /* ---------- ивент ---------- */
  var EVENT = {
    days: 7,
    clickDiv: 100,      /* 1 билет за 100 кликов */
    pvpClickDiv: 10,   /* 1 билет за 10 кликов в баттле */
    playerRewards: [50000, 25000, 10000],
    clanRewards: [50000, 25000, 10000]
  };

  /* ---------- кланы ---------- */
  var CLAN = {
    minLevel: 5,
    donateStep: 1000000,
    bonusPerStep: 0.01,
    maxBonus: 0.25
  };

  /* ---------- реклама ---------- */
  var AD = { coinsPerLevel: 1000, cooldownMs: 30 * 60 * 1000, viewMs: 5000 };

  /* ---------- престиж ---------- */
  var PRESTIGE = { base: 18, exp: 0.55, perShell: 0.03 };

  /* ---------- сброс прогресса ---------- */
  function freshState() {
    return {
      version: 3,
      created: Date.now(),
      lastSave: Date.now(),
      playTime: 0,
      coins: 0,
      totalCoins: 0,
      fish: 0,
      shells: 0,
      xp: 0,
      level: 1,
      skin: 'normal',
      upgrades: {},
      skinsOwned: ['normal'],
      effectsOwned: [],
      effectsOn: { e1: 1, e2: 1, e3: 1, e4: 1, e5: 1, e6: 1, e7: 1, e8: 1, e9: 1, e10: 1 },
      boxesOpened: 0,
      prestiges: 0,
      questIndex: 0,
      questsClaimed: {},
      dailyDate: '',
      dailyQuests: [],
      dailyProgress: {},
      dailyClaimed: {},
      dailyStreak: 0,
      lastDaily: 0,
      achievementsClaimed: {},
      boostUntil: 0,
      rainUntil: 0,
      eventTickets: 0,
      eventCoins: 0,
      eventSeasonScore: 0,
      adReady: 0,
      stats: {
        clicks: 0, crits: 0, fishCaught: 0, boxesOpened: 0,
        upgradesBought: 0, skinsBought: 0, pvpWins: 0, pvpPlayed: 0,
        raidWins: 0, raidPlayed: 0, bestCombo: 0, bestCps: 0,
        bestPerClick: 0, exchanges: 0, shellsTotal: 0, ticketsTotal: 0,
        bestPerSec: 0, clickSeconds: 0, offlineEarned: 0
      },
      settings: {
        music: false, sfx: true, volume: 0.5,
        theme: 'sunset', effectsAll: true, pixelScale: 3, shake: true,
        showDamage: true
      },
      account: { name: null, token: null, id: null },
      clan: { id: null, name: null, role: null, joined: 0 }
    };
  }

  root.DATA = {
    UPGRADES: UPGRADES, SKINS: SKINS, BOXES: BOXES, EFFECTS: EFFECTS,
    QUESTS: QUESTS, DAILY: DAILY, ACHIEVEMENTS: ACHIEVEMENTS,
    DAILY_REWARD: DAILY_REWARD, FISH_TYPES: FISH_TYPES,
    FIELD_BONUSES: FIELD_BONUSES, RANKS: RANKS, EVENT: EVENT, CLAN: CLAN,
    AD: AD, PRESTIGE: PRESTIGE, RAR_COLORS: RAR_COLORS, RAR_NAMES: RAR_NAMES,
    freshState: freshState
  };
})(typeof window !== 'undefined' ? window : globalThis);
