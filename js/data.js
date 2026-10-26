// Игровые данные: покрытия, велосипеды, колёса, улучшения, трассы.
// Все характеристики велосипедов — по шкале 0..100.
(function () {
  'use strict';

  const STAT_KEYS = ['speed', 'accel', 'handling', 'brakes', 'climb', 'offroad'];
  const STAT_NAMES = {
    speed: 'Скорость',
    accel: 'Разгон',
    handling: 'Управляемость',
    brakes: 'Торможение',
    climb: 'Подъёмы',
    offroad: 'Бездорожье',
  };

  // rough — тряска (гасится подвеской/параметром «Бездорожье»), grip — базовое сцепление.
  const SURFACES = {
    asphalt: { name: 'Асфальт', color: '#4b4f56', rough: 0.0, grip: 1.0, dust: null },
    cobble: { name: 'Брусчатка', color: '#77695c', rough: 0.28, grip: 0.86, dust: null },
    gravel: { name: 'Гравий', color: '#b49d78', rough: 0.3, grip: 0.72, dust: '#cdb994' },
    dirt: { name: 'Грунт', color: '#7b5a3c', rough: 0.42, grip: 0.78, dust: '#8f6b48' },
    sand: { name: 'Песок', color: '#e3cf95', rough: 0.35, grip: 0.58, dust: '#efdcab' },
    snow: { name: 'Снег и лёд', color: '#e9f1f8', rough: 0.25, grip: 0.42, dust: '#ffffff' },
    grass: { name: 'Обочина', color: '#5c8f3c', rough: 0.6, grip: 0.62, dust: null },
  };

  // Колёса/покрышки. roll — накат (влияет на максимальную скорость) по покрытиям,
  // grip — сцепление по покрытиям, mods — бонусы к характеристикам.
  const WHEELS = {
    // ── Шоссейные 700c ─────────────────────────────────────────────
    gp5000: {
      name: 'Continental Grand Prix 5000 25 мм', size: 'road', price: 250,
      desc: 'Эталонная шоссейная покрышка: быстрая на асфальте, беспомощна в грязи.',
      roll: { asphalt: 1.0, cobble: 0.8, gravel: 0.62, dirt: 0.5, sand: 0.3, snow: 0.35, grass: 0.45 },
      grip: { asphalt: 1.0, cobble: 0.85, gravel: 0.55, dirt: 0.5, sand: 0.35, snow: 0.25, grass: 0.5 },
      mods: {},
    },
    corsa: {
      name: 'Vittoria Corsa Pro 28 мм', size: 'road', price: 450,
      desc: 'Хлопковый корд и широкий профиль — больше сцепления в поворотах.',
      roll: { asphalt: 1.0, cobble: 0.86, gravel: 0.66, dirt: 0.54, sand: 0.32, snow: 0.36, grass: 0.48 },
      grip: { asphalt: 1.06, cobble: 0.9, gravel: 0.6, dirt: 0.54, sand: 0.36, snow: 0.27, grass: 0.52 },
      mods: { speed: 2, handling: 3 },
    },
    gatorskin: {
      name: 'Continental Gatorskin 28 мм', size: 'road', price: 300,
      desc: 'Неубиваемая тренировочная покрышка. Медленнее, но уверенно держит брусчатку.',
      roll: { asphalt: 0.97, cobble: 0.9, gravel: 0.7, dirt: 0.58, sand: 0.34, snow: 0.38, grass: 0.5 },
      grip: { asphalt: 0.96, cobble: 0.94, gravel: 0.64, dirt: 0.56, sand: 0.38, snow: 0.3, grass: 0.55 },
      mods: { speed: -1 },
    },
    zipp404: {
      name: 'Zipp 404 Firecrest + GP5000', size: 'road', price: 1800,
      desc: 'Аэродинамические карбоновые обода 58 мм. Плюс к скорости, но боковой ветер мешает рулить.',
      roll: { asphalt: 1.0, cobble: 0.8, gravel: 0.62, dirt: 0.5, sand: 0.3, snow: 0.35, grass: 0.45 },
      grip: { asphalt: 1.0, cobble: 0.85, gravel: 0.55, dirt: 0.5, sand: 0.35, snow: 0.25, grass: 0.5 },
      mods: { speed: 7, accel: -2, handling: -4 },
    },
    // ── Гравийные 700c ─────────────────────────────────────────────
    gone: {
      name: 'Schwalbe G-One Allround 40 мм', size: 'gravel', price: 350,
      desc: 'Универсал: мелкий протектор катит по асфальту и держит гравий.',
      roll: { asphalt: 0.93, cobble: 0.9, gravel: 0.92, dirt: 0.8, sand: 0.5, snow: 0.5, grass: 0.66 },
      grip: { asphalt: 0.92, cobble: 0.9, gravel: 0.9, dirt: 0.8, sand: 0.55, snow: 0.45, grass: 0.7 },
      mods: {},
    },
    gravelking: {
      name: 'Panaracer GravelKing SS 35 мм', size: 'gravel', price: 380,
      desc: 'Полуслик: почти шоссейный накат на асфальте, приемлемо на укатанном гравии.',
      roll: { asphalt: 0.96, cobble: 0.9, gravel: 0.88, dirt: 0.72, sand: 0.44, snow: 0.45, grass: 0.6 },
      grip: { asphalt: 0.96, cobble: 0.9, gravel: 0.84, dirt: 0.72, sand: 0.48, snow: 0.4, grass: 0.64 },
      mods: { speed: 1 },
    },
    riddler: {
      name: 'WTB Riddler 45 мм', size: 'gravel', price: 520,
      desc: 'Агрессивные боковые шипы для рыхлого грунта и крутых поворотов.',
      roll: { asphalt: 0.9, cobble: 0.9, gravel: 0.95, dirt: 0.88, sand: 0.58, snow: 0.55, grass: 0.72 },
      grip: { asphalt: 0.9, cobble: 0.92, gravel: 0.96, dirt: 0.9, sand: 0.62, snow: 0.5, grass: 0.78 },
      mods: { handling: 2 },
    },
    // ── МТБ 26/27.5/29 ─────────────────────────────────────────────
    krad: {
      name: 'Kenda K-Rad 26×2.1"', size: 'mtb', price: 150,
      desc: 'Бюджетная покрышка «на всё». Ничем не блещет, но и не подводит.',
      roll: { asphalt: 0.82, cobble: 0.84, gravel: 0.84, dirt: 0.86, sand: 0.58, snow: 0.52, grass: 0.72 },
      grip: { asphalt: 0.85, cobble: 0.85, gravel: 0.84, dirt: 0.86, sand: 0.6, snow: 0.48, grass: 0.75 },
      mods: {},
    },
    ikon: {
      name: 'Maxxis Ikon 29×2.2"', size: 'mtb', price: 400,
      desc: 'Быстрая кросс-кантрийная резина с низким сопротивлением качению.',
      roll: { asphalt: 0.88, cobble: 0.87, gravel: 0.91, dirt: 0.92, sand: 0.62, snow: 0.55, grass: 0.76 },
      grip: { asphalt: 0.88, cobble: 0.88, gravel: 0.9, dirt: 0.92, sand: 0.64, snow: 0.5, grass: 0.8 },
      mods: { speed: 1 },
    },
    minion: {
      name: 'Maxxis Minion DHF 29×2.5"', size: 'mtb', price: 600,
      desc: 'Легенда эндуро: максимальное сцепление в грязи и на корнях.',
      roll: { asphalt: 0.78, cobble: 0.84, gravel: 0.88, dirt: 0.98, sand: 0.68, snow: 0.6, grass: 0.82 },
      grip: { asphalt: 0.86, cobble: 0.92, gravel: 0.95, dirt: 1.02, sand: 0.7, snow: 0.6, grass: 0.9 },
      mods: { handling: 4 },
    },
    icespiker: {
      name: 'Schwalbe Ice Spiker Pro 29×2.25" (шипы)', size: 'mtb', price: 750,
      desc: '402 твердосплавных шипа. Для льда и снега — лучшее, что есть.',
      roll: { asphalt: 0.74, cobble: 0.78, gravel: 0.84, dirt: 0.86, sand: 0.6, snow: 0.86, grass: 0.74 },
      grip: { asphalt: 0.8, cobble: 0.84, gravel: 0.88, dirt: 0.88, sand: 0.62, snow: 0.98, grass: 0.78 },
      mods: {},
    },
    // ── Фэтбайк 26×4" ─────────────────────────────────────────────
    nate: {
      name: 'Surly Nate 26×3.8"', size: 'fat', price: 500,
      desc: 'Широченный протектор плывёт по песку и снегу, но вязнет на асфальте.',
      roll: { asphalt: 0.7, cobble: 0.78, gravel: 0.82, dirt: 0.9, sand: 0.95, snow: 0.9, grass: 0.86 },
      grip: { asphalt: 0.82, cobble: 0.86, gravel: 0.9, dirt: 0.95, sand: 0.96, snow: 0.82, grass: 0.9 },
      mods: {},
    },
    dillinger: {
      name: '45NRTH Dillinger 5 26×4.6" (шипы)', size: 'fat', price: 950,
      desc: 'Шипованный фэт: ледяная трасса превращается в асфальт.',
      roll: { asphalt: 0.68, cobble: 0.76, gravel: 0.82, dirt: 0.88, sand: 0.9, snow: 0.98, grass: 0.84 },
      grip: { asphalt: 0.8, cobble: 0.86, gravel: 0.9, dirt: 0.92, sand: 0.92, snow: 1.02, grass: 0.88 },
      mods: {},
    },
    // ── BMX 20" ───────────────────────────────────────────────────
    grifter: {
      name: 'Maxxis Grifter 20×2.3"', size: 'bmx', price: 120,
      desc: 'Классика стрит-BMX: цепкая и прочная.',
      roll: { asphalt: 0.92, cobble: 0.85, gravel: 0.78, dirt: 0.82, sand: 0.5, snow: 0.45, grass: 0.66 },
      grip: { asphalt: 0.98, cobble: 0.9, gravel: 0.8, dirt: 0.84, sand: 0.55, snow: 0.42, grass: 0.7 },
      mods: {},
    },
    pathpro: {
      name: 'Odyssey Path Pro 20×2.4"', size: 'bmx', price: 260,
      desc: 'Гладкий профиль для парка — ещё резвее со старта.',
      roll: { asphalt: 0.96, cobble: 0.86, gravel: 0.76, dirt: 0.78, sand: 0.46, snow: 0.42, grass: 0.62 },
      grip: { asphalt: 1.0, cobble: 0.9, gravel: 0.76, dirt: 0.78, sand: 0.5, snow: 0.38, grass: 0.66 },
      mods: { accel: 3 },
    },
    // ── Складной 16" ──────────────────────────────────────────────
    marathon16: {
      name: 'Schwalbe Marathon Racer 16×1.35"', size: 'folding', price: 140,
      desc: 'Штатная покрышка Brompton: защита от проколов и неплохой накат.',
      roll: { asphalt: 0.94, cobble: 0.86, gravel: 0.7, dirt: 0.6, sand: 0.36, snow: 0.38, grass: 0.52 },
      grip: { asphalt: 0.96, cobble: 0.88, gravel: 0.66, dirt: 0.6, sand: 0.4, snow: 0.32, grass: 0.56 },
      mods: {},
    },
    kojak16: {
      name: 'Schwalbe Kojak 16×1.35" (слик)', size: 'folding', price: 300,
      desc: 'Абсолютно гладкий слик — быстрее только на трамвае.',
      roll: { asphalt: 0.99, cobble: 0.84, gravel: 0.64, dirt: 0.54, sand: 0.32, snow: 0.32, grass: 0.48 },
      grip: { asphalt: 1.0, cobble: 0.84, gravel: 0.58, dirt: 0.52, sand: 0.34, snow: 0.26, grass: 0.5 },
      mods: { speed: 2 },
    },
  };

  const WHEEL_SIZE_NAMES = {
    road: 'Шоссе 700c', gravel: 'Гревел 700c', mtb: 'МТБ 26–29"', fat: 'Фэт 26×4"', bmx: 'BMX 20"', folding: 'Складной 16"',
  };

  const BIKE_TYPES = {
    road: 'Шоссейный', aero: 'Аэро-шоссейный', tt: 'Разделочный (TT)', gravel: 'Гревел', hybrid: 'Фитнес/гибрид',
    mtb: 'Горный хардтейл', enduro: 'Двухподвес', fat: 'Фэтбайк', bmx: 'BMX', folding: 'Складной',
  };

  // photoQueries — поисковые запросы для Wikimedia Commons (от точного к общему).
  const BIKES = [
    {
      id: 'stels', name: 'Stels Navigator 600 MD', type: 'mtb', tier: 1, price: 0, color: '#2f7de1',
      stats: { speed: 38, accel: 42, handling: 45, brakes: 45, climb: 35, offroad: 50 },
      sizes: ['mtb'], stockWheel: 'krad',
      desc: 'Стартовый народный хардтейл на 26" колёсах. Тяжеловат, зато едет везде понемногу.',
      photoQueries: ['Stels Navigator bicycle', 'Stels bicycle', 'hardtail mountain bike 26'],
    },
    {
      id: 'mongoose', name: 'Mongoose Legion L100', type: 'bmx', tier: 1, price: 700, color: '#e23b3b',
      stats: { speed: 30, accel: 80, handling: 86, brakes: 58, climb: 42, offroad: 42 },
      sizes: ['bmx'], stockWheel: 'grifter',
      desc: 'Хромолевый BMX: взрывной старт и мгновенная реакция на руль. Но потолок скорости низкий.',
      photoQueries: ['Mongoose BMX bicycle', 'Mongoose Legion', 'BMX bicycle'],
    },
    {
      id: 'brompton', name: 'Brompton C Line Explore', type: 'folding', tier: 1, price: 1100, color: '#f2a516',
      stats: { speed: 40, accel: 66, handling: 82, brakes: 55, climb: 45, offroad: 18 },
      sizes: ['folding'], stockWheel: 'marathon16',
      desc: 'Британская складушка на 16" колёсах. Узкие улицы и шпильки критериума — её стихия.',
      photoQueries: ['Brompton bicycle', 'Brompton folding bike', 'folding bicycle 16 inch'],
    },
    {
      id: 'trekfx', name: 'Trek FX 3 Disc', type: 'hybrid', tier: 2, price: 1500, color: '#7a8a99',
      stats: { speed: 55, accel: 56, handling: 60, brakes: 70, climb: 55, offroad: 34 },
      sizes: ['road', 'gravel'], stockWheel: 'gravelking',
      desc: 'Фитнес-гибрид с карбоновой вилкой и дисковыми тормозами. Сбалансирован во всём.',
      photoQueries: ['Trek FX bicycle', 'Trek FX 3', 'hybrid bicycle'],
    },
    {
      id: 'marlin', name: 'Trek Marlin 7', type: 'mtb', tier: 2, price: 1800, color: '#1aa37a',
      stats: { speed: 46, accel: 56, handling: 63, brakes: 72, climb: 52, offroad: 72 },
      sizes: ['mtb'], stockWheel: 'ikon',
      desc: 'Хардтейл для кросс-кантри: вилка RockShox, гидравлика, уверенность на грунте.',
      photoQueries: ['Trek Marlin', 'Trek mountain bike', 'hardtail mountain bike'],
    },
    {
      id: 'pugsley', name: 'Surly Pugsley', type: 'fat', tier: 2, price: 2400, color: '#5b3fa8',
      stats: { speed: 32, accel: 40, handling: 50, brakes: 66, climb: 36, offroad: 88 },
      sizes: ['fat'], stockWheel: 'nate',
      desc: 'Прародитель фэтбайков. Четырёхдюймовые покрышки не тонут ни в песке, ни в снегу.',
      photoQueries: ['Surly Pugsley', 'Surly fat bike', 'fatbike'],
    },
    {
      id: 'topstone', name: 'Cannondale Topstone Carbon', type: 'gravel', tier: 3, price: 3200, color: '#3ba55c',
      stats: { speed: 64, accel: 61, handling: 65, brakes: 76, climb: 65, offroad: 62 },
      sizes: ['gravel', 'road'], stockWheel: 'gone',
      desc: 'Гревел с «кингпин»-подвеской заднего треугольника. Король смешанных трасс.',
      photoQueries: ['Cannondale Topstone', 'Cannondale gravel bike', 'gravel bike'],
    },
    {
      id: 'tcr', name: 'Giant TCR Advanced Pro', type: 'road', tier: 3, price: 4200, color: '#1d3f8f',
      stats: { speed: 74, accel: 73, handling: 71, brakes: 70, climb: 84, offroad: 14 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Лёгкая карбоновая рама с компактной геометрией. Горы — его конёк.',
      photoQueries: ['Giant TCR Advanced', 'Giant TCR', 'Giant road bicycle'],
    },
    {
      id: 'stumpjumper', name: 'Specialized Stumpjumper EVO', type: 'enduro', tier: 4, price: 5200, color: '#c0392b',
      stats: { speed: 50, accel: 58, handling: 78, brakes: 90, climb: 56, offroad: 97 },
      sizes: ['mtb'], stockWheel: 'minion',
      desc: 'Двухподвес с ходом 150 мм. Корни и камни для него как асфальт, но на шоссе — тягач.',
      photoQueries: ['Specialized Stumpjumper', 'Specialized mountain bike', 'full suspension mountain bike'],
    },
    {
      id: 'diverge', name: 'Specialized Diverge STR', type: 'gravel', tier: 4, price: 6000, color: '#b8862b',
      stats: { speed: 69, accel: 65, handling: 71, brakes: 80, climb: 67, offroad: 74 },
      sizes: ['gravel', 'road'], stockWheel: 'gone',
      desc: 'Гревел с подвеской Future Shock и подвесным подседельным узлом. Комфорт на любой «гребёнке».',
      photoQueries: ['Specialized Diverge', 'Specialized gravel bike', 'gravel bicycle'],
    },
    {
      id: 'aeroad', name: 'Canyon Aeroad CFR', type: 'aero', tier: 4, price: 7500, color: '#20232a',
      stats: { speed: 89, accel: 75, handling: 63, brakes: 72, climb: 70, offroad: 10 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Аэродинамика из аэротрубы: на прямых недосягаем, в поворотах требует аккуратности.',
      photoQueries: ['Canyon Aeroad', 'Canyon road bike', 'aero road bicycle'],
    },
    {
      id: 'p5', name: 'Cervélo P5', type: 'tt', tier: 5, price: 9000, color: '#e8e8e8',
      stats: { speed: 98, accel: 66, handling: 38, brakes: 62, climb: 60, offroad: 5 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Разделочник для триатлона. Максимальная скорость в игре, но поворачивает как баржа.',
      photoQueries: ['Cervelo P5', 'Cervélo P5', 'time trial bicycle'],
    },
    {
      id: 'tarmac', name: 'Specialized S-Works Tarmac SL8', type: 'road', tier: 5, price: 11000, color: '#9b1c2c',
      stats: { speed: 87, accel: 87, handling: 80, brakes: 80, climb: 91, offroad: 14 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Гоночный болид пелотона: лёгкий, жёсткий и быстрый. Победитель Гранд-туров.',
      photoQueries: ['Specialized Tarmac SL8', 'Specialized Tarmac', 'S-Works Tarmac'],
    },
    {
      id: 'dogma', name: 'Pinarello Dogma F', type: 'road', tier: 5, price: 14000, color: '#0b7fa8',
      stats: { speed: 91, accel: 85, handling: 87, brakes: 82, climb: 88, offroad: 14 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Итальянская легенда с асимметричной рамой. Лучший баланс скорости и управляемости.',
      photoQueries: ['Pinarello Dogma F', 'Pinarello Dogma', 'Pinarello bicycle'],
    },
  ];

  const UPGRADES = [
    { id: 'frame', name: 'Облегчение: карбоновые компоненты', icon: '🪶', mods: { climb: 4, accel: 2 }, base: 150 },
    { id: 'drivetrain', name: 'Трансмиссия Shimano / SRAM', icon: '⚙️', mods: { speed: 3, accel: 3 }, base: 180 },
    { id: 'aero', name: 'Аэродинамика: шлем, костюм, посадка', icon: '💨', mods: { speed: 4 }, base: 200 },
    { id: 'brakes', name: 'Гидравлические тормоза и роторы', icon: '🛑', mods: { brakes: 6 }, base: 100 },
    { id: 'cockpit', name: 'Руль, вынос и геометрия', icon: '🎯', mods: { handling: 5 }, base: 140 },
    { id: 'suspension', name: 'Подвеска и подседельный штырь', icon: '🪝', mods: { offroad: 6 }, base: 160 },
  ];
  const MAX_UPGRADE = 5;

  // Трассы. points: [x, y, z]; surfaces: [доля круга от, до, покрытие].
  const TRACKS = [
    {
      id: 'highway', name: 'Загородное шоссе', env: 'meadow', tier: 1, laps: 2, width: 16, offSurface: 'grass',
      prize: 450, focus: 'Скорость',
      desc: 'Широкий асфальт и плавные дуги. Решает максимальная скорость.',
      points: [[0, 0, 0], [150, -20, 3], [300, 0, 6], [410, 80, 7], [390, 210, 4], [260, 270, 1], [150, 230, 0],
        [60, 290, -1], [-70, 270, 0], [-140, 160, 3], [-110, 60, 2]],
      surfaces: [[0, 1, 'asphalt']],
    },
    {
      id: 'crit', name: 'Городской критериум', env: 'city', tier: 1, laps: 3, width: 11, offSurface: 'cobble',
      prize: 500, focus: 'Управляемость и разгон',
      desc: 'Прямоугольные кварталы, брусчатка и резкие повороты на 90°. Важно тормозить и быстро разгоняться.',
      points: [[0, 0, 0], [110, 0, 0], [135, 12, 0], [140, 40, 0], [140, 95, 0], [128, 118, 0], [100, 122, 0],
        [70, 122, 0], [50, 135, 0], [45, 160, 0], [45, 215, 0], [32, 236, 0], [5, 240, 0], [-70, 240, 0],
        [-92, 228, 0], [-98, 200, 0], [-98, 30, 0], [-88, 8, 0], [-60, 0, 0]],
      surfaces: [[0, 0.22, 'asphalt'], [0.22, 0.48, 'cobble'], [0.48, 0.78, 'asphalt'], [0.78, 0.9, 'cobble'], [0.9, 1, 'asphalt']],
    },
    {
      id: 'gravel', name: 'Гравийная петля', env: 'countryside', tier: 2, laps: 2, width: 12, offSurface: 'grass',
      prize: 750, focus: 'Гревел, универсальность',
      desc: 'Короткий асфальт, затем длинная гравийка через поля и грунтовый участок вдоль реки.',
      points: [[0, 0, 0], [110, -40, 2], [230, -30, 5], [310, 40, 8], [290, 150, 6], [200, 180, 3], [160, 260, 5],
        [40, 290, 2], [-60, 230, -1], [-40, 140, 0], [-120, 70, 2], [-70, 10, 1]],
      surfaces: [[0, 0.18, 'asphalt'], [0.18, 0.72, 'gravel'], [0.72, 0.88, 'dirt'], [0.88, 1, 'gravel']],
    },
    {
      id: 'mountain', name: 'Горный серпантин', env: 'mountain', tier: 3, laps: 2, width: 11, offSurface: 'grass',
      prize: 1100, focus: 'Подъёмы и торможение',
      desc: 'Набор 36 метров по шпилькам и затяжной спуск. Лёгкая рама и сильные тормоза — ключ к победе.',
      points: [[0, 0, 0], [120, 0, 4], [205, 40, 9], [150, 95, 14], [45, 105, 19], [5, 155, 24], [65, 205, 28],
        [185, 215, 32], [265, 175, 35], [335, 225, 36], [305, 325, 33], [185, 345, 27], [65, 315, 20],
        [-55, 325, 13], [-150, 255, 7], [-145, 125, 3], [-95, 40, 1]],
      surfaces: [[0, 1, 'asphalt']],
    },
    {
      id: 'forest', name: 'Лесной кросс-кантри', env: 'forest', tier: 3, laps: 2, width: 9, offSurface: 'dirt',
      prize: 1200, focus: 'Бездорожье и управляемость',
      desc: 'Узкая грунтовая тропа между соснами, корни и гравийная просека. Без подвески будет больно.',
      points: [[0, 0, 0], [80, -30, 3], [160, 0, 6], [205, 70, 2], [150, 120, -2], [205, 185, 3], [160, 255, 7],
        [70, 240, 4], [20, 190, 0], [-50, 235, -3], [-130, 190, 1], [-110, 110, 5], [-160, 50, 3], [-80, 15, 1]],
      surfaces: [[0, 0.4, 'dirt'], [0.4, 0.56, 'gravel'], [0.56, 1, 'dirt']],
    },
    {
      id: 'desert', name: 'Пустынные дюны', env: 'desert', tier: 4, laps: 2, width: 13, offSurface: 'sand',
      prize: 1500, focus: 'Широкие колёса',
      desc: 'Рыхлый песок между барханами и пара участков твёрдого такыра. Узкие покрышки вязнут.',
      points: [[0, 0, 0], [140, -60, 4], [280, -30, 8], [345, 80, 3], [260, 170, -2], [305, 260, 4], [185, 325, 8],
        [60, 260, 2], [-40, 305, -2], [-145, 220, 3], [-100, 100, 6]],
      surfaces: [[0, 0.15, 'dirt'], [0.15, 0.55, 'sand'], [0.55, 0.65, 'dirt'], [0.65, 1, 'sand']],
    },
    {
      id: 'tundra', name: 'Ледяная тундра', env: 'snow', tier: 4, laps: 2, width: 12, offSurface: 'snow',
      prize: 1600, focus: 'Сцепление: шипы и фэт',
      desc: 'Укатанный снег и зеркальный лёд. Без шипованной резины повороты превращаются в лотерею.',
      points: [[0, 0, 0], [130, 10, 2], [220, -40, 5], [320, 20, 7], [300, 130, 4], [200, 150, 1], [220, 250, 3],
        [100, 300, 6], [-20, 250, 3], [-30, 150, 0], [-120, 120, -2], [-100, 30, 0]],
      surfaces: [[0, 0.3, 'snow'], [0.3, 0.42, 'dirt'], [0.42, 1, 'snow']],
    },
    {
      id: 'coast', name: 'Приморский Гран-при', env: 'coast', tier: 5, laps: 2, width: 13, offSurface: 'sand',
      prize: 2600, focus: 'Финал: всё сразу',
      desc: 'Набережная, старый город с брусчаткой, пляж и гравийный мыс. Финальная гонка сезона.',
      points: [[0, 0, 0], [160, -20, 2], [260, 40, 5], [240, 140, 8], [320, 220, 6], [260, 320, 2], [120, 300, 0],
        [40, 220, 3], [-60, 300, 1], [-160, 240, -1], [-140, 120, 2], [-60, 60, 1]],
      surfaces: [[0, 0.25, 'asphalt'], [0.25, 0.42, 'cobble'], [0.42, 0.56, 'sand'], [0.56, 0.78, 'gravel'], [0.78, 1, 'asphalt']],
    },
  ];

  const ENVIRONMENTS = {
    meadow: { ground: '#5f9a40', decal: ['#6fae4a', '#527f35', '#e6d15a'], scenery: ['tree', 'tree', 'bush', 'bush', 'rock', 'house'], density: 0.9 },
    city: { ground: '#6f6a64', decal: ['#625d58', '#7d7770'], scenery: ['building', 'building', 'building', 'lamp', 'tree'], density: 1.3 },
    countryside: { ground: '#9db04d', decal: ['#c9b95a', '#88a043', '#b7c766'], scenery: ['tree', 'haybale', 'bush', 'house', 'tree'], density: 0.8 },
    mountain: { ground: '#6d8a4f', decal: ['#7a7d78', '#5b7642', '#8a9a72'], scenery: ['pine', 'pine', 'rock', 'rock', 'pine'], density: 1.1 },
    forest: { ground: '#3f6b33', decal: ['#2f5527', '#4e7d3c', '#6b5236'], scenery: ['pine', 'tree', 'pine', 'tree', 'bush', 'pine'], density: 1.8 },
    desert: { ground: '#dcc287', decal: ['#cfb173', '#e8d39c', '#b99a5f'], scenery: ['cactus', 'rock', 'cactus', 'dune'], density: 0.6 },
    snow: { ground: '#e3edf5', decal: ['#cddbe7', '#f7fbff', '#b9c9d8'], scenery: ['snowpine', 'snowpine', 'rock', 'snowpine'], density: 1.0 },
    coast: { ground: '#d8c896', decal: ['#c6b27d', '#7fb0c9', '#e7dcb4'], scenery: ['palm', 'palm', 'building', 'rock', 'umbrella'], density: 0.9 },
  };

  const BOT_NAMES = ['Погачар', 'Вингегор', 'Ван Арт', 'Эвенепул', 'Роглич', 'Ван дер Пул', 'Педерсен', 'Пиднок',
    'Власов', 'Сивцов', 'Захаров', 'Чернецкий', 'Алафилипп', 'Гирмай', 'Бернал'];
  const BOT_COLORS = ['#ffd400', '#00b3ff', '#ff4fa3', '#41e37a', '#ff8a00', '#b46cff', '#ff3b3b', '#ffffff'];

  const START_MONEY = 500;
  const PRIZE_SHARE = [1, 0.65, 0.45, 0.32, 0.24, 0.18];

  window.GameData = {
    STAT_KEYS, STAT_NAMES, SURFACES, WHEELS, WHEEL_SIZE_NAMES, BIKE_TYPES, BIKES, UPGRADES, MAX_UPGRADE,
    TRACKS, ENVIRONMENTS, BOT_NAMES, BOT_COLORS, START_MONEY, PRIZE_SHARE,
    bikeById: (id) => BIKES.find((b) => b.id === id),
    trackById: (id) => TRACKS.find((t) => t.id === id),
  };
})();
