// Прогресс гонщика: опыт и уровни, дерево навыков (перки), медали и кубки, чемпионаты.
(function () {
  'use strict';
  const D = window.GameData;
  const GS = window.GameState;

  const MAX_LEVEL = 50;
  const PLACE_XP = [1, 0.8, 0.65, 0.52, 0.42, 0.35];
  const CHAMP_POINTS = [25, 18, 15, 12, 10, 8];

  // ── Дерево навыков ───────────────────────────────────────────
  // level — с какого уровня гонщика доступен навык, req — какой навык нужен до него.
  // mods — прибавки к характеристикам, prof — к профилю гонщика в гонке, tri — к триатлону.
  const BRANCHES = [
    { id: 'sprint', name: 'Спринтер', icon: '🚀', color: '#ff5c7a' },
    { id: 'climb', name: 'Горняк', icon: '⛰️', color: '#6cc070' },
    { id: 'tech', name: 'Технарь', icon: '🌲', color: '#c58b4a' },
    { id: 'tact', name: 'Тактик', icon: '🧠', color: '#8f7bff' },
    { id: 'tri', name: 'Триатлет', icon: '🏊', color: '#33b5ff' },
  ];
  const PERKS = [
    { id: 'sp1', branch: 'sprint', name: 'Взрывной старт', level: 2, cost: 1, mods: { accel: 4 }, desc: 'Разгон +4' },
    { id: 'sp2', branch: 'sprint', name: 'Финишёр', level: 5, req: 'sp1', cost: 1, prof: { sprintBoost: 0.03 }, desc: 'Спурт +3% к скорости' },
    { id: 'sp3', branch: 'sprint', name: 'Длинный спурт', level: 9, req: 'sp2', cost: 1, prof: { sprintCost: -0.2 }, desc: 'Спурт тратит на 20% меньше энергии' },
    { id: 'sp4', branch: 'sprint', name: 'Король спринта', level: 16, req: 'sp3', cost: 2, prof: { finalKick: 0.03 }, desc: '+3% к скорости на последних 7% дистанции' },
    { id: 'cl1', branch: 'climb', name: 'Лёгкий вес', level: 2, cost: 1, mods: { climb: 4 }, desc: 'Подъёмы +4' },
    { id: 'cl2', branch: 'climb', name: 'Ритм в гору', level: 6, req: 'cl1', cost: 1, mods: { climb: 5 }, desc: 'Подъёмы +5' },
    { id: 'cl3', branch: 'climb', name: 'Бесстрашный спуск', level: 11, req: 'cl2', cost: 1, mods: { brakes: 4 }, prof: { descend: 0.05 }, desc: '+5% на спусках, тормоза +4' },
    { id: 'cl4', branch: 'climb', name: 'Король гор', level: 19, req: 'cl3', cost: 2, mods: { climb: 6 }, prof: { skill: 0.005 }, desc: 'Подъёмы +6, класс +0.5%' },
    { id: 'te1', branch: 'tech', name: 'Чувство баланса', level: 3, cost: 1, mods: { handling: 4 }, desc: 'Управляемость +4' },
    { id: 'te2', branch: 'tech', name: 'Грязь не помеха', level: 7, req: 'te1', cost: 1, mods: { offroad: 6 }, desc: 'Бездорожье +6' },
    { id: 'te3', branch: 'tech', name: 'Ледяные нервы', level: 12, req: 'te2', cost: 1, prof: { slipGrip: 0.12 }, desc: 'Сцепление на снегу и песке +12%' },
    { id: 'te4', branch: 'tech', name: 'Мастер траектории', level: 20, req: 'te3', cost: 2, prof: { corner: 0.03 }, desc: 'Смелость в поворотах +3%' },
    { id: 'ta1', branch: 'tact', name: 'Чтение гонки', level: 4, cost: 1, prof: { draft: 0.015 }, desc: '«На колесе» +1.5% к скорости' },
    { id: 'ta2', branch: 'tact', name: 'Второе дыхание', level: 8, req: 'ta1', cost: 1, prof: { secondWind: 1 }, desc: 'Раз за гонку при пустом баке +35% энергии' },
    { id: 'ta3', branch: 'tact', name: 'Экономный', level: 14, req: 'ta2', cost: 2, prof: { regenMult: 0.2 }, desc: 'Восстановление энергии +20%' },
    { id: 'ta4', branch: 'tact', name: 'Лидер пелотона', level: 24, req: 'ta3', cost: 2, prof: { skill: 0.015 }, desc: 'Класс гонщика +1.5%' },
    { id: 'tr1', branch: 'tri', name: 'Гидрокостюм', level: 3, cost: 1, tri: { swim: 0.05 }, desc: 'Плавание +5%' },
    { id: 'tr2', branch: 'tri', name: 'Быстрые транзиты', level: 6, req: 'tr1', cost: 1, tri: { transition: 0.25 }, desc: 'Транзиты на 25% быстрее' },
    { id: 'tr3', branch: 'tri', name: 'Беговая экономичность', level: 10, req: 'tr2', cost: 1, tri: { run: 0.04 }, desc: 'Бег +4%' },
    { id: 'tr4', branch: 'tri', name: 'Нутрициолог', level: 14, req: 'tr3', cost: 2, tri: { gels: 1, gelPower: 0.25 }, desc: '+1 гель, гели на 25% сильнее' },
    { id: 'tr5', branch: 'tri', name: 'Железный человек', level: 22, req: 'tr4', cost: 2, tri: { glycogen: 0.2 }, desc: 'Запас гликогена +20%' },
  ];

  // ── Чемпионаты ───────────────────────────────────────────────
  const CHAMPIONSHIPS = [
    { id: 'novice', name: 'Кубок новичков', mode: 'cycle', level: 1, tier: 1, prize: 1500, color: '#c9d1da', stages: ['highway', 'crit', 'gravel'] },
    { id: 'classics', name: 'Весенние классики', mode: 'cycle', level: 4, tier: 2, prize: 2500, color: '#7fd3ff', stages: ['crit', 'gravel', 'coast'] },
    { id: 'mountains', name: 'Горный тур', mode: 'cycle', level: 8, tier: 3, prize: 3500, color: '#6cc070', stages: ['mountain', 'gravel', 'mountain'] },
    { id: 'offroad', name: 'Кубок мира по бездорожью', mode: 'cycle', level: 12, tier: 4, prize: 5000, color: '#c58b4a', stages: ['forest', 'desert', 'tundra'] },
    { id: 'grandtour', name: 'Гранд-тур', mode: 'cycle', level: 18, tier: 4, prize: 9000, color: '#ffd400', stages: ['highway', 'crit', 'mountain', 'forest', 'desert', 'coast'] },
    { id: 'worlds', name: 'Чемпионат мира', mode: 'cycle', level: 25, tier: 5, prize: 15000, color: '#ff5c7a', stages: ['highway', 'crit', 'gravel', 'mountain', 'forest', 'desert', 'tundra', 'coast'] },
    { id: 'trisprint', name: 'Серия спринт-триатлона', mode: 'tri', level: 3, tier: 2, prize: 3000, color: '#33b5ff', stages: ['supersprint', 'sprint', 'olympic'] },
    { id: 'tri703', name: 'Серия Ironman 70.3', mode: 'tri', level: 12, tier: 4, prize: 7000, color: '#ff8a00', stages: ['olympic', 'half', 'half'] },
    { id: 'kona', name: 'Чемпионат мира Ironman · Кона', mode: 'tri', level: 20, tier: 5, prize: 15000, color: '#e0262f', stages: ['half', 'ironman'] },
  ];

  // ── Опыт и уровни ────────────────────────────────────────────
  const xpToNext = (lvl) => Math.round(150 * Math.pow(lvl, 1.35));
  function levelInfo(xp) {
    let lvl = 1, left = xp;
    while (lvl < MAX_LEVEL && left >= xpToNext(lvl)) { left -= xpToNext(lvl); lvl++; }
    return { level: lvl, into: left, need: lvl >= MAX_LEVEL ? 0 : xpToNext(lvl) };
  }
  const level = (st) => levelInfo(st.xp || 0).level;
  const pointsTotal = (lvl) => (lvl - 1) + Math.floor(lvl / 5);
  function pointsSpent(st) {
    return (st.perks || []).reduce((a, id) => a + ((PERKS.find((p) => p.id === id) || {}).cost || 0), 0);
  }
  const pointsFree = (st) => pointsTotal(level(st)) - pointsSpent(st);
  // Тренировки ограничены уровнем: потолок растёт на 1 каждые 2 уровня.
  const trainingCap = (st) => Math.min(D.RIDER_MAX, 1 + Math.floor(level(st) / 2));

  function perkState(st, perk) {
    const has = (st.perks || []).includes(perk.id);
    if (has) return 'owned';
    if (level(st) < perk.level) return 'locked';
    if (perk.req && !(st.perks || []).includes(perk.req)) return 'needreq';
    if (pointsFree(st) < perk.cost) return 'nopoints';
    return 'available';
  }
  function buyPerk(st, id) {
    const p = PERKS.find((x) => x.id === id);
    if (!p || perkState(st, p) !== 'available') return false;
    st.perks = (st.perks || []).concat(id);
    return true;
  }

  // Сумма эффектов купленных навыков.
  function perkEffects(perks) {
    const out = { mods: {}, prof: {}, tri: {} };
    (perks || []).forEach((id) => {
      const p = PERKS.find((x) => x.id === id);
      if (!p) return;
      ['mods', 'prof', 'tri'].forEach((k) => {
        Object.entries(p[k] || {}).forEach(([kk, v]) => { out[k][kk] = (out[k][kk] || 0) + v; });
      });
    });
    return out;
  }

  // Начисление опыта; возвращает список полученных уровней и бонус в монетах.
  function addXp(st, amount) {
    const before = level(st);
    st.xp = (st.xp || 0) + Math.round(amount);
    const after = level(st);
    let bonus = 0;
    for (let l = before + 1; l <= after; l++) bonus += 60 * l;
    st.money += bonus;
    return { gained: Math.round(amount), levels: after - before, newLevel: after, bonus };
  }
  function raceXp(tier, place, mult) {
    return (50 + tier * 30) * (PLACE_XP[place - 1] || 0.3) * (mult || 1);
  }

  // ── Медали и кубки ───────────────────────────────────────────
  const MEDAL = ['gold', 'silver', 'bronze'];
  function addMedal(st, place, info) {
    if (place > 3) return null;
    st.trophies = st.trophies || { medals: [], cups: [] };
    const m = Object.assign({ kind: MEDAL[place - 1], date: Date.now() }, info);
    st.trophies.medals.push(m);
    return m;
  }
  function addCup(st, place, champ) {
    if (place > 3) return null;
    st.trophies = st.trophies || { medals: [], cups: [] };
    const c = { kind: MEDAL[place - 1], champ: champ.id, name: champ.name, color: champ.color, date: Date.now() };
    st.trophies.cups.push(c);
    return c;
  }

  // ── Чемпионат: состояние ─────────────────────────────────────
  function makeRoster(tier, seed) {
    const rnd = window.Tracks.mulberry32(seed >>> 0);
    const names = D.BOT_NAMES.slice().sort(() => rnd() - 0.5);
    return Array.from({ length: 5 }, (_, i) => ({
      name: names[i],
      jersey: D.BOT_COLORS[(i + 1) % D.BOT_COLORS.length],
      helmet: ['#ffffff', '#111111', '#e0e0e0'][i % 3],
      skillJitter: rnd() * 0.04 - (i === 4 ? 0.04 : 0),
      tactic: D.TACTICS[Math.floor(rnd() * D.TACTICS.length)].id,
      triJitter: rnd(),
    }));
  }
  function startChamp(st, id) {
    const c = CHAMPIONSHIPS.find((x) => x.id === id);
    st.champ = { id, stage: 0, points: {}, history: [], roster: makeRoster(c.tier, Date.now()) };
    return st.champ;
  }
  // results — массив имён в порядке финиша; возвращает начисленные очки.
  function recordChampStage(st, order) {
    const ch = st.champ;
    const gained = {};
    order.forEach((name, i) => {
      const pts = CHAMP_POINTS[i] || 0;
      ch.points[name] = (ch.points[name] || 0) + pts;
      gained[name] = pts;
    });
    ch.history.push(order);
    ch.stage++;
    return gained;
  }
  function standings(st) {
    const ch = st.champ;
    const names = Object.keys(ch.points);
    return names.map((n) => ({ name: n, points: ch.points[n], last: ch.history.length ? ch.history[ch.history.length - 1].indexOf(n) : 0 }))
      .sort((a, b) => b.points - a.points || a.last - b.last);
  }

  window.Progression = {
    MAX_LEVEL, BRANCHES, PERKS, CHAMPIONSHIPS, CHAMP_POINTS,
    xpToNext, levelInfo, level, pointsTotal, pointsFree, trainingCap, perkState, buyPerk, perkEffects,
    addXp, raceXp, addMedal, addCup, makeRoster, startChamp, recordChampStage, standings,
    champById: (id) => CHAMPIONSHIPS.find((c) => c.id === id),
  };
})();
