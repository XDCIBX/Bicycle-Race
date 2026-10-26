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
    water: { name: 'Открытая вода', color: '#2f7fb8', rough: 0, grip: 1, dust: null },
    path: { name: 'Беговая дорожка', color: '#b07a5a', rough: 0.05, grip: 0.95, dust: null },
    // Покрытия даунхилл-трасс.
    rock: { name: 'Камни и корни', color: '#8a8378', rough: 0.62, grip: 0.8, dust: '#a8a094' },
    stairs: { name: 'Лестница', color: '#9b9488', rough: 0.55, grip: 0.82, dust: null },
    wood: { name: 'Деревянный настил', color: '#a5794a', rough: 0.12, grip: 0.9, dust: null },
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
      name: 'Kenda K-Rad 27.5×2.1"', size: 'mtb', price: 150,
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
    mtb: 'Горный хардтейл', enduro: 'Эндуро-двухподвес', xc: 'XC-двухподвес', fat: 'Фэтбайк', bmx: 'BMX', folding: 'Складной',
    dh: 'Даунхилл',
  };

  // Только реальные бренды и модели. brand/model — для подписи и декалей на раме,
  // look — внешний вид для реалистичной отрисовки (цвета, обода, борт покрышки).
  const BIKES = [
    {
      id: 'rockrider', brand: 'Rockrider', model: 'ST 100', maker: 'Decathlon', type: 'mtb', tier: 1, price: 0,
      color: '#3b4a5a', accent: '#f39200', decal: '#ffffff', look: { rims: 'alu' },
      stats: { speed: 38, accel: 42, handling: 45, brakes: 45, climb: 35, offroad: 50 },
      sizes: ['mtb'], stockWheel: 'krad',
      desc: 'Самый продаваемый хардтейл Европы от Decathlon. Тяжеловат, зато едет везде понемногу.',
    },
    {
      id: 'mongoose', brand: 'Mongoose', model: 'Legion L100', type: 'bmx', tier: 1, price: 700,
      color: '#d62828', accent: '#111111', decal: '#ffffff', look: { rims: 'alu' },
      stats: { speed: 30, accel: 80, handling: 86, brakes: 58, climb: 42, offroad: 42 },
      sizes: ['bmx'], stockWheel: 'grifter',
      desc: 'Хромолевый BMX: взрывной старт и мгновенная реакция на руль. Но потолок скорости низкий.',
    },
    {
      id: 'brompton', brand: 'Brompton', model: 'C Line Explore', type: 'folding', tier: 1, price: 1100,
      color: '#f2a516', accent: '#1d1d1d', decal: '#1d1d1d', look: { rims: 'alu' },
      stats: { speed: 40, accel: 66, handling: 82, brakes: 55, climb: 45, offroad: 18 },
      sizes: ['folding'], stockWheel: 'marathon16',
      desc: 'Британская складушка на 16" колёсах. Узкие улицы и шпильки критериума — её стихия.',
    },
    {
      id: 'trekfx', brand: 'Trek', model: 'FX 3 Disc', type: 'hybrid', tier: 2, price: 1500,
      color: '#5d6873', accent: '#c7d0d8', decal: '#ffffff', look: { rims: 'alu', gumwall: false },
      stats: { speed: 55, accel: 56, handling: 60, brakes: 70, climb: 55, offroad: 34 },
      sizes: ['road', 'gravel'], stockWheel: 'gravelking',
      desc: 'Фитнес-гибрид с карбоновой вилкой и дисковыми тормозами. Сбалансирован во всём.',
    },
    {
      id: 'marlin', brand: 'Trek', model: 'Marlin 7', type: 'mtb', tier: 2, price: 1800,
      color: '#0f7a5c', accent: '#d9e021', decal: '#ffffff', look: { rims: 'alu' },
      stats: { speed: 46, accel: 56, handling: 63, brakes: 72, climb: 52, offroad: 72 },
      sizes: ['mtb'], stockWheel: 'ikon',
      desc: 'Хардтейл для кросс-кантри: вилка RockShox, гидравлика, уверенность на грунте.',
    },
    {
      id: 'pugsley', brand: 'Surly', model: 'Pugsley', type: 'fat', tier: 2, price: 2400,
      color: '#5b3fa8', accent: '#e0e0e0', decal: '#ffffff', look: { rims: 'alu' },
      stats: { speed: 32, accel: 40, handling: 50, brakes: 66, climb: 36, offroad: 88 },
      sizes: ['fat'], stockWheel: 'nate',
      desc: 'Прародитель фэтбайков. Четырёхдюймовые покрышки не тонут ни в песке, ни в снегу.',
    },
    {
      id: 'topstone', brand: 'Cannondale', model: 'Topstone Carbon', type: 'gravel', tier: 3, price: 3200,
      color: '#4d7c3a', accent: '#e8e2c8', decal: '#ffffff', look: { rims: 'carbon30', gumwall: true },
      stats: { speed: 64, accel: 61, handling: 65, brakes: 76, climb: 65, offroad: 62 },
      sizes: ['gravel', 'road'], stockWheel: 'gone',
      desc: 'Гревел с «кингпин»-подвеской заднего треугольника. Король смешанных трасс.',
    },
    {
      id: 'terra', brand: 'Orbea', model: 'Terra M20', type: 'gravel', tier: 3, price: 3600,
      color: '#b5532d', accent: '#2a2a2a', decal: '#f3efe6', look: { rims: 'carbon30', gumwall: true },
      stats: { speed: 63, accel: 65, handling: 70, brakes: 74, climb: 68, offroad: 65 },
      sizes: ['gravel', 'road'], stockWheel: 'riddler',
      desc: 'Баскский карбоновый гревел: лёгкий, юркий, с агрессивной резиной из коробки.',
    },
    {
      id: 'tcr', brand: 'Giant', model: 'TCR Advanced Pro', type: 'road', tier: 3, price: 4200,
      color: '#1d3f8f', accent: '#7fd3ff', decal: '#ffffff', look: { rims: 'carbon30' },
      stats: { speed: 74, accel: 73, handling: 71, brakes: 70, climb: 84, offroad: 14 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Лёгкая карбоновая рама с компактной геометрией. Горы — его конёк.',
    },
    {
      id: 'stumpjumper', brand: 'Specialized', model: 'Stumpjumper EVO', type: 'enduro', tier: 4, price: 5200,
      color: '#8e1b1b', accent: '#f2c230', decal: '#ffffff', look: { rims: 'alu' },
      stats: { speed: 50, accel: 58, handling: 78, brakes: 90, climb: 56, offroad: 97 },
      sizes: ['mtb'], stockWheel: 'minion',
      desc: 'Двухподвес с ходом 150 мм. Корни и камни для него как асфальт, но на шоссе — тягач.',
    },
    {
      id: 'spark', brand: 'Scott', model: 'Spark RC World Cup', type: 'xc', tier: 4, price: 5900,
      color: '#e6e6e6', accent: '#d7192c', decal: '#111111', look: { rims: 'carbon30' },
      stats: { speed: 60, accel: 72, handling: 80, brakes: 84, climb: 76, offroad: 90 },
      sizes: ['mtb'], stockWheel: 'ikon',
      desc: 'Кросс-кантрийный двухподвес чемпионов мира: амортизатор спрятан в раме, вес под 10 кг.',
    },
    {
      id: 'diverge', brand: 'Specialized', model: 'Diverge STR', type: 'gravel', tier: 4, price: 6000,
      color: '#9a7b3a', accent: '#1e1e1e', decal: '#ffffff', look: { rims: 'carbon30', gumwall: true },
      stats: { speed: 69, accel: 65, handling: 71, brakes: 80, climb: 67, offroad: 74 },
      sizes: ['gravel', 'road'], stockWheel: 'gone',
      desc: 'Гревел с подвеской Future Shock и подвесным подседельным узлом. Комфорт на любой «гребёнке».',
    },
    {
      id: 'aeroad', brand: 'Canyon', model: 'Aeroad CFR', type: 'aero', tier: 4, price: 7500,
      color: '#1f2226', accent: '#e5e5e5', decal: '#e5e5e5', look: { rims: 'carbon50' },
      stats: { speed: 89, accel: 75, handling: 63, brakes: 72, climb: 70, offroad: 10 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Аэродинамика из аэротрубы: на прямых недосягаем, в поворотах требует аккуратности.',
    },
    {
      id: 'p5', brand: 'Cervélo', model: 'P5', type: 'tt', tier: 5, price: 9000,
      color: '#f1f1f1', accent: '#c8102e', decal: '#111111', look: { rims: 'disc' },
      stats: { speed: 98, accel: 66, handling: 38, brakes: 62, climb: 60, offroad: 5 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Разделочник для триатлона. Максимальная скорость в игре, но поворачивает как баржа.',
    },
    {
      id: 'oltre', brand: 'Bianchi', model: 'Oltre RC', type: 'aero', tier: 5, price: 10000,
      color: '#58c4b5', accent: '#111111', decal: '#111111', look: { rims: 'carbon50' },
      stats: { speed: 93, accel: 79, handling: 69, brakes: 76, climb: 74, offroad: 10 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Старейший велобренд мира в фирменном цвете «челесте». Аэро-болид с «крыльями» на руле.',
    },
    {
      id: 'tarmac', brand: 'Specialized', model: 'S-Works Tarmac SL8', type: 'road', tier: 5, price: 11000,
      color: '#7c1424', accent: '#f0f0f0', decal: '#f0f0f0', look: { rims: 'carbon50' },
      stats: { speed: 87, accel: 87, handling: 80, brakes: 80, climb: 91, offroad: 14 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Гоночный болид пелотона: лёгкий, жёсткий и быстрый. Победитель Гранд-туров.',
    },
    {
      id: 'colnago', brand: 'Colnago', model: 'V4Rs', type: 'road', tier: 5, price: 12500,
      color: '#16181d', accent: '#e4002b', decal: '#ffffff', look: { rims: 'carbon50' },
      stats: { speed: 89, accel: 88, handling: 84, brakes: 82, climb: 90, offroad: 14 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Велосипед Тадея Погачара: победы в Туре де Франс и чемпионате мира.',
    },
    {
      id: 'dogma', brand: 'Pinarello', model: 'Dogma F', type: 'road', tier: 5, price: 14000,
      color: '#0d2c54', accent: '#3fa9f5', decal: '#ffffff', look: { rims: 'carbon50' },
      stats: { speed: 91, accel: 85, handling: 87, brakes: 82, climb: 88, offroad: 14 },
      sizes: ['road'], stockWheel: 'gp5000',
      desc: 'Итальянская легенда с асимметричной рамой. Лучший баланс скорости и управляемости.',
    },
  ];
  BIKES.forEach((b) => { b.name = `${b.brand} ${b.model}`; });

  // Тренировки гонщика: каждая ветка — до 10 уровней.
  const RIDER_SKILLS = [
    { id: 'power', name: 'Мощность', icon: '💪', training: 'Интервалы на велостанке', mods: { speed: 2, accel: 2 }, base: 120,
      effect: 'Скорость +2, разгон +2 за уровень' },
    { id: 'endurance', name: 'Выносливость', icon: '❤️', training: 'Длинная базовая поездка, 4 часа', mods: {}, base: 100,
      effect: 'Запас энергии +12, восстановление быстрее' },
    { id: 'climbing', name: 'Горы', icon: '⛰️', training: 'Повторы в подъём 8%', mods: { climb: 3 }, base: 110,
      effect: 'Подъёмы +3 за уровень' },
    { id: 'technique', name: 'Техника', icon: '🎯', training: 'Скиллс-парк и спуски', mods: { handling: 3, offroad: 2, brakes: 1 }, base: 110,
      effect: 'Управляемость +3, бездорожье +2, тормоза +1; смелее в поворотах' },
    { id: 'sprint', name: 'Спринт', icon: '⚡', training: 'Спринты с хода за мотоциклом', mods: {}, base: 100,
      effect: 'Рывок мощнее: +0.8% к скорости спурта за уровень' },
    { id: 'tactics', name: 'Тактика', icon: '🧠', training: 'Разбор гонок с тренером', mods: {}, base: 90,
      effect: 'Больше пользы от «сидения на колесе», точнее выбор момента атаки' },
  ];
  const RIDER_MAX = 10;

  // Тактика на гонку (велосипед едет сам, игрок выбирает план и может нажать «Спурт»).
  const TACTICS = [
    { id: 'steady', name: 'Ровный темп', icon: '⚖️', desc: 'Спурты только на длинных прямых, энергия расходуется равномерно.' },
    { id: 'attack', name: 'Атака со старта', icon: '🔥', desc: 'Сразу уходит вперёд, тратит энергию на первом круге, потом держит отрыв.' },
    { id: 'final', name: 'Финишный рывок', icon: '🏁', desc: 'Экономит силы на колесе соперников и выкладывается на последних 30% гонки.' },
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

  // Служебные трассы триатлона: плавательная петля между буями и беговая трасса в парке.
  const EXTRA_TRACKS = [
    {
      id: 'swimcourse', name: 'Плавательная петля', env: 'lake', tier: 1, laps: 1, width: 16, offSurface: 'water', prize: 0,
      points: [[0, 0, 0], [120, -10, 0], [240, 0, 0], [280, 60, 0], [240, 125, 0], [120, 135, 0], [0, 125, 0], [-40, 60, 0]],
      surfaces: [[0, 1, 'water']],
    },
    {
      id: 'runcourse', name: 'Беговая трасса в парке', env: 'park', tier: 1, laps: 1, width: 7, offSurface: 'grass', prize: 0,
      points: [[0, 0, 0], [90, -20, 1], [180, 10, 2], [230, 90, 1], [170, 160, 0], [210, 240, 2], [110, 290, 3], [10, 240, 1],
        [-60, 280, 0], [-130, 200, 1], [-90, 110, 2], [-120, 40, 1]],
      surfaces: [[0, 1, 'path']],
    },
  ];

  const ENVIRONMENTS = {
    urbanhill: { ground: '#8a7f74', decal: ['#7a6f65', '#988c80'], scenery: [], density: 0, urban: true },
    oldtown: { ground: '#857a6c', decal: ['#776c60', '#968a7c'], scenery: [], density: 0, urban: true },
    alpine: { ground: '#7d8f63', decal: ['#8a8b84', '#6d8054', '#e9eef2', '#9aa38a'], scenery: ['pine', 'rock', 'rock', 'pine', 'snowpatch', 'rock'], density: 1.1, relief: 1.2 },
    forestdh: { ground: '#355e2c', decal: ['#2a4d22', '#47733a', '#6b5236'], scenery: ['pine', 'tree', 'fern', 'pine', 'log', 'birch', 'fern'], density: 2.4, relief: 0.8 },
    canyon: { ground: '#b9673e', decal: ['#a85a35', '#cf7a4a', '#d9a070'], scenery: ['mesa', 'rock', 'rock', 'cactus', 'mesa'], density: 0.8, relief: 1.6 },
    meadow: { ground: '#5f9a40', decal: ['#6fae4a', '#527f35', '#e6d15a', '#f3f3f3'], scenery: ['tree', 'tree', 'birch', 'bush', 'flowers', 'rock', 'house'], density: 1.0, lakes: 2 },
    city: { ground: '#6f6a64', decal: ['#625d58', '#7d7770'], scenery: ['building', 'building', 'building', 'lamp', 'tree', 'bench'], density: 1.3 },
    countryside: { ground: '#9db04d', decal: ['#c9b95a', '#88a043', '#b7c766'], scenery: ['tree', 'haybale', 'bush', 'house', 'birch', 'flowers'], density: 0.9, lakes: 1 },
    mountain: { ground: '#6d8a4f', decal: ['#7a7d78', '#5b7642', '#8a9a72'], scenery: ['pine', 'pine', 'rock', 'rock', 'pine', 'flowers'], density: 1.2, lakes: 1, relief: 0.9 },
    forest: { ground: '#3f6b33', decal: ['#2f5527', '#4e7d3c', '#6b5236'], scenery: ['pine', 'tree', 'pine', 'birch', 'bush', 'pine', 'fern', 'pine', 'tree', 'fern', 'log'], density: 2.0, lakes: 1 },
    desert: { ground: '#dcc287', decal: ['#cfb173', '#e8d39c', '#b99a5f'], scenery: ['cactus', 'rock', 'cactus', 'dune'], density: 0.6 },
    snow: { ground: '#e3edf5', decal: ['#cddbe7', '#f7fbff', '#b9c9d8'], scenery: ['snowpine', 'snowpine', 'rock', 'snowpine', 'snowpine', 'snowpine', 'rock', 'snowpine', 'snowman'], density: 1.1 },
    lake: { ground: '#2c78ad', decal: ['#4f97c9', '#7cb8df', '#2a6d9e'], scenery: ['boat', 'kayak'], density: 0.12, water: true },
    park: { ground: '#5a9a42', decal: ['#6db04c', '#4d8636', '#e6d15a', '#f08cb0'], scenery: ['tree', 'tree', 'bush', 'bench', 'flowers', 'birch'], density: 1.2 },
    coast: { ground: '#d8c896', decal: ['#c6b27d', '#7fb0c9', '#e7dcb4'], scenery: ['palm', 'palm', 'building', 'rock', 'umbrella'], density: 0.9, sea: true },
  };

  // Триатлон: отдельные навыки триатлета (велоэтап использует велосипед и навыки велогонщика).
  const TRI_SKILLS = [
    { id: 'swim', name: 'Плавание', icon: '🏊', training: 'Техника и интервалы в бассейне', base: 110, effect: 'Скорость плавания +0.065 м/с за уровень' },
    { id: 'run', name: 'Бег', icon: '🏃', training: 'Темповые и длинные пробежки', base: 110, effect: 'Скорость бега +0.17 м/с за уровень' },
    { id: 'transition', name: 'Транзиты', icon: '⏱️', training: 'Отработка T1 и T2: гидрокостюм, шлем, обувь', base: 70, effect: '−9 с в T1 и −6 с в T2 за уровень' },
    { id: 'stamina', name: 'Выносливость', icon: '🔋', training: '«Кирпичи»: длинный вело + бег', base: 130, effect: 'Гликоген +10%, усталость к финишу меньше' },
    { id: 'nutrition', name: 'Питание', icon: '🍌', training: 'Тренировка питания на ходу', base: 90, effect: 'Больше гелей, лучше усвоение на пунктах питания' },
  ];

  const BOT_NAMES = ['Погачар', 'Вингегор', 'Ван Арт', 'Эвенепул', 'Роглич', 'Ван дер Пул', 'Педерсен', 'Пиднок',
    'Власов', 'Сивцов', 'Захаров', 'Чернецкий', 'Алафилипп', 'Гирмай', 'Бернал'];
  const BOT_COLORS = ['#ffd400', '#00b3ff', '#ff4fa3', '#41e37a', '#ff8a00', '#b46cff', '#ff3b3b', '#ffffff'];

  const START_MONEY = 500;
  const PRIZE_SHARE = [1, 0.65, 0.45, 0.32, 0.24, 0.18];

  // ═════════ ДАУНХИЛЛ ═════════
  // Отдельная дисциплина: спуск на время по трассе с перепадом высоты, прыжками и лестницами.
  const DH_STAT_KEYS = ['speed', 'brakes', 'handling', 'suspension', 'stability', 'jump'];
  const DH_STAT_NAMES = {
    speed: 'Скорость на спуске', brakes: 'Торможение', handling: 'Управляемость',
    suspension: 'Подвеска', stability: 'Устойчивость', jump: 'Прыжки',
  };
  // DH-покрышки (размер 'dh'): накат и сцепление на всех покрытиях.
  const dhTire = (name, price, desc, roll, grip, mods) => ({ name, size: 'dh', price, desc, roll, grip, mods: mods || {} });
  const allSurf = (base, over) => Object.assign({ asphalt: base, cobble: base, gravel: base, dirt: base, sand: base * 0.8, snow: base * 0.7, grass: base * 0.9, water: 0.3, path: base, rock: base, stairs: base, wood: base }, over);
  Object.assign(WHEELS, {
    assegai: dhTire('Maxxis Assegai 29×2.5" DH', 450, 'Эталон DH: предсказуемое сцепление на любом грунте.',
      allSurf(0.9, { asphalt: 0.86, dirt: 0.95, rock: 0.92 }), allSurf(0.95, { dirt: 1.0, rock: 0.96, asphalt: 0.9 })),
    magicmary: dhTire('Schwalbe Magic Mary 27.5×2.4" Super Downhill', 600, 'Агрессивные шипы для грязи и корней, на асфальте медленнее.',
      allSurf(0.86, { asphalt: 0.8, cobble: 0.84, dirt: 0.98, rock: 0.95 }), allSurf(0.96, { dirt: 1.05, rock: 1.02, asphalt: 0.86 }), { handling: 2 }),
    dh22: dhTire('Michelin DH22 29×2.4"', 750, 'Быстрая резина для сухих и городских трасс: асфальт, брусчатка, лестницы.',
      allSurf(0.94, { asphalt: 0.98, cobble: 0.96, stairs: 0.95, wood: 0.97, dirt: 0.88 }), allSurf(0.92, { asphalt: 1.0, cobble: 0.98, stairs: 0.96, dirt: 0.88 }), { speed: 2 }),
    kryptotal: dhTire('Continental Kryptotal-Fr DH SuperSoft', 950, 'Самая мягкая смесь: максимум сцепления везде.',
      allSurf(0.9, { dirt: 0.96, rock: 0.95 }), allSurf(1.02, { rock: 1.04, dirt: 1.04 }), { handling: 3, brakes: 2 }),
  });
  WHEEL_SIZE_NAMES.dh = 'DH 27.5–29"';

  // Специальные улучшения для DH-велосипедов (до 5 уровней).
  const DH_UPGRADES = [
    { id: 'dh_fork', name: 'Двухкоронная вилка FOX 40 Factory', icon: '🔱', mods: { suspension: 5, handling: 1 }, base: 180 },
    { id: 'dh_shock', name: 'Амортизатор FOX DHX2 с прогрессией', icon: '🌀', mods: { suspension: 3, jump: 3 }, base: 170 },
    { id: 'dh_brakes', name: 'Тормоза Shimano Saint, роторы 220 мм', icon: '🛑', mods: { brakes: 6 }, base: 120 },
    { id: 'dh_cockpit', name: 'Руль 800 мм, вынос 35 мм', icon: '🎯', mods: { handling: 5 }, base: 130 },
    { id: 'dh_geometry', name: 'Геометрия: длинная база, низкая каретка', icon: '📐', mods: { stability: 6 }, base: 160 },
    { id: 'dh_wheels', name: 'DH-обода с вкладышами CushCore', icon: '⭕', mods: { speed: 3, jump: 2 }, base: 200 },
  ];

  const DH_BIKES = [
    { id: 'collosus', brand: 'Polygon', model: 'Collosus DH9', tier: 1, price: 1200, color: '#1d1f22', accent: '#d9e021', decal: '#d9e021',
      dhStats: { speed: 50, brakes: 52, handling: 55, suspension: 58, stability: 52, jump: 50 },
      desc: 'Доступный DH-двухподвес из Индонезии: 200 мм хода, чтобы начать спуски.', },
    { id: 'supreme', brand: 'Commencal', model: 'Supreme DH V5', tier: 2, price: 2600, color: '#c3c8cd', accent: '#1b6bd8', decal: '#1b6bd8',
      dhStats: { speed: 60, brakes: 62, handling: 62, suspension: 66, stability: 64, jump: 60 },
      desc: 'Французская DH-классика с высокой осью задней подвески: прёт через корни и камни.', },
    { id: 'tues', brand: 'YT', model: 'Tues', tier: 2, price: 3400, color: '#2a2a2c', accent: '#ff6a00', decal: '#ff6a00',
      dhStats: { speed: 63, brakes: 64, handling: 70, suspension: 68, stability: 60, jump: 74 },
      desc: 'Игривый немецкий DH: лучший в прыжках и на городских трамплинах.', },
    { id: 'sender', brand: 'Canyon', model: 'Sender CFR', tier: 3, price: 4600, color: '#1d2b23', accent: '#9ad13a', decal: '#9ad13a',
      dhStats: { speed: 72, brakes: 70, handling: 68, suspension: 74, stability: 75, jump: 66 },
      desc: 'Карбоновый DH Кубка мира: регулируемая геометрия, стабилен на огромной скорости.', },
    { id: 'session', brand: 'Trek', model: 'Session 9.9', tier: 4, price: 5800, color: '#3a1a5c', accent: '#ff3366', decal: '#ffffff',
      dhStats: { speed: 76, brakes: 76, handling: 75, suspension: 82, stability: 77, jump: 72 },
      desc: 'Подвеска ABP не «затвердевает» при торможении — лучшая работа на камнях.', },
    { id: 'demo', brand: 'Specialized', model: 'Demo Race', tier: 4, price: 7200, color: '#101012', accent: '#e5332a', decal: '#e5332a',
      dhStats: { speed: 81, brakes: 80, handling: 72, suspension: 80, stability: 85, jump: 70 },
      desc: 'Низкий и длинный: невероятно устойчив на скоростных альпийских трассах.', },
    { id: 'v10', brand: 'Santa Cruz', model: 'V10', tier: 5, price: 9500, color: '#2b61c9', accent: '#f5d10a', decal: '#f5d10a',
      dhStats: { speed: 87, brakes: 85, handling: 83, suspension: 90, stability: 87, jump: 80 },
      desc: 'Легенда с подвеской VPP: чемпионские титулы Кубка мира. Лучший DH в игре.', },
  ];
  DH_BIKES.forEach((b) => {
    Object.assign(b, { type: 'dh', dh: true, sizes: ['dh'], stockWheel: 'assegai', look: { rims: 'alu' }, name: `${b.brand} ${b.model}` });
    // Обычные характеристики (для общих экранов): DH-байк силён в бездорожье и слаб в подъёмах.
    b.stats = { speed: b.dhStats.speed, accel: Math.round((b.dhStats.speed + b.dhStats.jump) / 2), handling: b.dhStats.handling, brakes: b.dhStats.brakes, climb: 12, offroad: b.dhStats.suspension };
    BIKES.push(b);
  });

  // Трассы спуска: незамкнутые, от старта на вершине до финиша внизу.
  // features: stairs — лестница (дополнительный перепад h на участке a..b), drop — уступ (резкий перепад h),
  // kicker — трамплин (прыжок). Высоты z — метры над финишем.
  const DH_TRACKS = [
    {
      id: 'dh_forest', name: 'Лесные корни', env: 'forestdh', dh: true, open: true, tier: 1, level: 1, laps: 1, width: 5, offSurface: 'dirt', prize: 600,
      focus: 'Подвеска и управляемость', desc: 'Крутой лесной спуск: корни, камни, деревянный настил и два уступа.',
      points: [[0, 0, 120], [50, 50, 112], [30, 120, 102], [-30, 170, 92], [-10, 240, 82], [60, 280, 70], [90, 350, 58], [50, 420, 46], [-10, 470, 34], [10, 540, 22], [80, 580, 10], [130, 620, 0]],
      surfaces: [[0, 0.3, 'dirt'], [0.3, 0.45, 'rock'], [0.45, 0.6, 'dirt'], [0.6, 0.7, 'wood'], [0.7, 0.85, 'rock'], [0.85, 1, 'dirt']],
      features: [{ type: 'drop', at: 0.2, h: 2.5 }, { type: 'kicker', at: 0.5 }, { type: 'kicker', at: 0.66 }, { type: 'drop', at: 0.78, h: 3 }],
    },
    {
      id: 'dh_urban', name: 'Портовые холмы', env: 'urbanhill', dh: true, open: true, tier: 2, level: 3, laps: 1, width: 4.6, offSurface: 'cobble', prize: 900,
      focus: 'Прыжки и скорость', desc: 'Городской спуск в духе Вальпараисо: узкие улицы между пёстрыми домами, лестницы, трамплины и толпы болельщиков.',
      points: [[0, 0, 130], [60, 40, 124], [90, 110, 116], [50, 170, 108], [-20, 210, 98], [-40, 280, 88], [10, 340, 78], [80, 370, 70], [120, 440, 58], [90, 510, 46], [20, 550, 36], [-30, 620, 24], [0, 690, 14], [70, 730, 6], [120, 780, 0]],
      surfaces: [[0, 0.15, 'cobble'], [0.15, 0.22, 'stairs'], [0.22, 0.4, 'asphalt'], [0.4, 0.46, 'stairs'], [0.46, 0.6, 'cobble'], [0.6, 0.64, 'wood'], [0.64, 0.8, 'cobble'], [0.8, 0.86, 'stairs'], [0.86, 1, 'asphalt']],
      features: [{ type: 'stairs', a: 0.15, b: 0.22, h: 6 }, { type: 'kicker', at: 0.3 }, { type: 'stairs', a: 0.4, b: 0.46, h: 5 }, { type: 'kicker', at: 0.62 }, { type: 'drop', at: 0.7, h: 2.5 }, { type: 'stairs', a: 0.8, b: 0.86, h: 6 }, { type: 'kicker', at: 0.93 }],
    },
    {
      id: 'dh_oldtown', name: 'Старый город', env: 'oldtown', dh: true, open: true, tier: 2, level: 5, laps: 1, width: 4.0, offSurface: 'cobble', prize: 1000,
      focus: 'Управляемость и торможение', desc: 'Средневековые переулки шириной в велосипед: брусчатка, крутые лестницы и повороты под 90°.',
      points: [[0, 0, 100], [40, 60, 94], [0, 120, 86], [-50, 150, 80], [-60, 220, 70], [0, 260, 62], [40, 330, 52], [0, 390, 42], [-40, 450, 32], [0, 520, 22], [50, 560, 12], [90, 620, 0]],
      surfaces: [[0, 0.25, 'cobble'], [0.25, 0.32, 'stairs'], [0.32, 0.55, 'cobble'], [0.55, 0.6, 'stairs'], [0.6, 0.75, 'cobble'], [0.75, 0.82, 'stairs'], [0.82, 1, 'cobble']],
      features: [{ type: 'stairs', a: 0.25, b: 0.32, h: 5 }, { type: 'kicker', at: 0.45 }, { type: 'stairs', a: 0.55, b: 0.6, h: 4 }, { type: 'kicker', at: 0.7 }, { type: 'stairs', a: 0.75, b: 0.82, h: 5 }, { type: 'drop', at: 0.9, h: 2 }],
    },
    {
      id: 'dh_alpine', name: 'Альпийский ледник', env: 'alpine', dh: true, open: true, tier: 3, level: 8, laps: 1, width: 6.5, offSurface: 'grass', prize: 1400,
      focus: 'Устойчивость на скорости', desc: 'Скоростной горный спуск на 190 м вниз: каменные поля, виражи, уступы и прыжки над склоном.',
      points: [[0, 0, 190], [80, 30, 180], [150, 90, 168], [110, 160, 155], [30, 200, 142], [-40, 260, 128], [0, 330, 114], [90, 360, 100], [170, 420, 86], [140, 500, 70], [60, 540, 58], [0, 610, 44], [50, 680, 30], [130, 720, 18], [200, 780, 6], [260, 820, 0]],
      surfaces: [[0, 0.2, 'rock'], [0.2, 0.35, 'dirt'], [0.35, 0.5, 'rock'], [0.5, 0.62, 'gravel'], [0.62, 0.8, 'dirt'], [0.8, 0.9, 'rock'], [0.9, 1, 'grass']],
      features: [{ type: 'kicker', at: 0.25 }, { type: 'drop', at: 0.45, h: 3 }, { type: 'kicker', at: 0.58 }, { type: 'drop', at: 0.75, h: 4 }, { type: 'kicker', at: 0.88 }],
    },
    {
      id: 'dh_canyon', name: 'Красный каньон', env: 'canyon', dh: true, open: true, tier: 4, level: 12, laps: 1, width: 7, offSurface: 'sand', prize: 2200,
      focus: 'Прыжки, подвеска, бесстрашие', desc: 'Фрирайд по хребтам из песчаника, как на легендарном Rampage: огромные уступы и перепад 230 м.',
      points: [[0, 0, 230], [70, 40, 215], [130, 100, 196], [100, 170, 176], [30, 210, 158], [-20, 280, 136], [30, 340, 114], [110, 370, 94], [170, 440, 72], [130, 520, 50], [60, 560, 32], [40, 640, 14], [90, 700, 0]],
      surfaces: [[0, 0.3, 'rock'], [0.3, 0.5, 'sand'], [0.5, 0.75, 'rock'], [0.75, 0.9, 'dirt'], [0.9, 1, 'sand']],
      features: [{ type: 'drop', at: 0.18, h: 3.5 }, { type: 'kicker', at: 0.35 }, { type: 'drop', at: 0.52, h: 4 }, { type: 'kicker', at: 0.68 }, { type: 'drop', at: 0.82, h: 5 }],
    },
  ];
  // Линия прохождения на спуске (вместо тактики).
  const DH_LINES = [
    { id: 'safe', name: 'Аккуратно', icon: '🛡️', corner: -0.05, land: 3, desc: 'Раньше тормозит, мягче приземляется. Медленнее, зато без падений.' },
    { id: 'race', name: 'Гоночная линия', icon: '🏁', corner: 0, land: 0, desc: 'Баланс скорости и риска.' },
    { id: 'send', name: 'На грани', icon: '🔥', corner: 0.05, land: -2.5, desc: 'Поздние торможения и полёты на полной скорости. Можно упасть.' },
  ];

  window.GameData = {
    STAT_KEYS, STAT_NAMES, SURFACES, WHEELS, WHEEL_SIZE_NAMES, BIKE_TYPES, BIKES, UPGRADES, MAX_UPGRADE,
    TRACKS, EXTRA_TRACKS, TRI_SKILLS, ENVIRONMENTS, BOT_NAMES,
    DH_STAT_KEYS, DH_STAT_NAMES, DH_UPGRADES, DH_TRACKS, DH_LINES,
    isDh: (b) => !!(b && (b.dh || (typeof b === 'string' && BIKES.find((x) => x.id === b && x.dh)))), BOT_COLORS, START_MONEY, PRIZE_SHARE, RIDER_SKILLS, RIDER_MAX, TACTICS,
    bikeById: (id) => BIKES.find((b) => b.id === id),
    trackById: (id) => TRACKS.find((t) => t.id === id) || EXTRA_TRACKS.find((t) => t.id === id) || DH_TRACKS.find((t) => t.id === id),
  };
})();
