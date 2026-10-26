// Сохранение прогресса, итоговые характеристики велосипеда и гонщика.
(function () {
  'use strict';
  const D = window.GameData;
  const SAVE_KEY = 'velorush.save.v1';

  function emptyUpgrades() {
    const u = {};
    D.UPGRADES.forEach((up) => { u[up.id] = 0; });
    return u;
  }

  function emptySkills() {
    const r = {};
    D.RIDER_SKILLS.forEach((k) => { r[k.id] = 0; });
    return r;
  }

  function emptyTriSkills() {
    const r = {};
    (D.TRI_SKILLS || []).forEach((k) => { r[k.id] = 0; });
    return r;
  }

  function newGame() {
    const s = {
      money: D.START_MONEY,
      active: 'rockrider',
      rider: { name: 'Вы', skills: emptySkills() },
      tactic: 'steady',
      xp: 0,
      perks: [],
      trophies: { medals: [], cups: [] },
      champ: null,
      tri: { skills: emptyTriSkills(), pacing: 'steady', best: {}, bestTime: {} },
      owned: {},
      wheels: [],
      best: {},
      bestTime: {},
      races: 0,
      wins: 0,
    };
    grantBike(s, 'rockrider');
    return s;
  }

  function grantBike(s, bikeId) {
    const bike = D.bikeById(bikeId);
    s.owned[bikeId] = { upgrades: emptyUpgrades(), wheel: bike.stockWheel };
    if (!s.wheels.includes(bike.stockWheel)) s.wheels.push(bike.stockWheel);
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const s = Object.assign(newGame(), JSON.parse(raw));
        // Миграция: стартовый Stels заменён на Rockrider ST 100.
        if (s.owned.stels) { s.owned.rockrider = s.owned.rockrider || s.owned.stels; delete s.owned.stels; }
        if (s.active === 'stels') s.active = 'rockrider';
        // Защита от устаревших/битых сохранений.
        Object.keys(s.owned).forEach((id) => { if (!D.bikeById(id)) delete s.owned[id]; });
        if (Object.keys(s.owned).length === 0) grantBike(s, 'rockrider');
        if (!s.owned[s.active]) s.active = Object.keys(s.owned)[0];
        Object.values(s.owned).forEach((o) => { o.upgrades = Object.assign(emptyUpgrades(), o.upgrades); });
        s.rider = Object.assign({ name: 'Вы' }, s.rider);
        s.rider.skills = Object.assign(emptySkills(), s.rider.skills);
        if (!D.TACTICS.some((t) => t.id === s.tactic)) s.tactic = 'steady';
        // Миграция на систему уровней: опыт за уже проведённые гонки.
        const raw0 = JSON.parse(raw);
        if (raw0.xp == null) s.xp = (s.races || 0) * 90;
        s.perks = Array.isArray(s.perks) ? s.perks : [];
        s.trophies = Object.assign({ medals: [], cups: [] }, s.trophies);
        s.tri = Object.assign({ pacing: 'steady', best: {}, bestTime: {} }, s.tri);
        s.tri.skills = Object.assign(emptyTriSkills(), s.tri.skills);
        return s;
      }
    } catch (e) { /* хранилище недоступно — начинаем заново */ }
    return newGame();
  }

  function save(s) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* игнорируем */ }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Итоговые характеристики = база велосипеда + улучшения + колёса + тренированность гонщика.
  function effectiveStats(bikeId, upgrades, wheelId, riderSkills, perks) {
    const bike = D.bikeById(bikeId);
    const out = Object.assign({}, bike.stats);
    D.UPGRADES.forEach((up) => {
      const lvl = (upgrades && upgrades[up.id]) || 0;
      Object.entries(up.mods).forEach(([k, v]) => { out[k] += v * lvl; });
    });
    const wheel = D.WHEELS[wheelId || bike.stockWheel];
    Object.entries(wheel.mods).forEach(([k, v]) => { out[k] += v; });
    D.STAT_KEYS.forEach((k) => { out[k] = clamp(out[k], 1, 100); });
    if (riderSkills) {
      D.RIDER_SKILLS.forEach((sk) => {
        const lvl = riderSkills[sk.id] || 0;
        Object.entries(sk.mods).forEach(([k, v]) => { out[k] = clamp(out[k] + v * lvl, 1, 120); });
      });
    }
    if (perks && perks.length && window.Progression) {
      Object.entries(window.Progression.perkEffects(perks).mods).forEach(([k, v]) => { out[k] = clamp(out[k] + v, 1, 125); });
    }
    return out;
  }

  // Параметры гонщика, которые не сводятся к характеристикам велосипеда.
  function riderProfile(skills, perks) {
    const sk = skills || {};
    const lv = (id) => sk[id] || 0;
    const total = D.RIDER_SKILLS.reduce((a, k) => a + lv(k.id), 0);
    const pe = (perks && perks.length && window.Progression) ? window.Progression.perkEffects(perks).prof : {};
    const p = (k) => pe[k] || 0;
    return {
      skill: 0.9 + 0.0015 * total + p('skill'),
      energyMax: 100 + 12 * lv('endurance'),
      regen: (5 + 0.7 * lv('endurance')) * (1 + p('regenMult')),
      sprintBoost: 1.08 + 0.008 * lv('sprint') + p('sprintBoost'),
      sprintCost: 1 + p('sprintCost'),
      finalKick: 1 + p('finalKick'),
      descend: 1 + p('descend'),
      slipGrip: 1 + p('slipGrip'),
      secondWind: p('secondWind') > 0,
      draft: 0.03 + 0.004 * lv('tactics') + p('draft'),
      corner: 0.93 + 0.004 * lv('technique') + 0.002 * lv('tactics') + p('corner'),
      tactics: lv('tactics'),
    };
  }

  function riderLevel(skills) {
    return 1 + Math.floor(D.RIDER_SKILLS.reduce((a, k) => a + (skills[k.id] || 0), 0) / 3);
  }

  function trainingPrice(skillId, level) {
    const sk = D.RIDER_SKILLS.find((k) => k.id === skillId);
    return Math.round(sk.base * Math.pow(level + 1, 1.5) / 10) * 10;
  }

  function upgradePrice(bikeId, upId, level) {
    const bike = D.bikeById(bikeId);
    const up = D.UPGRADES.find((u) => u.id === upId);
    const raw = up.base * (1 + (bike.tier - 1) * 0.35) * Math.pow(level + 1, 1.45);
    return Math.round(raw / 10) * 10;
  }

  function wheelFits(bikeId, wheelId) {
    return D.bikeById(bikeId).sizes.includes(D.WHEELS[wheelId].size);
  }

  // ── Физическая модель (общая для гонки и для оценки трассы) ──────────
  const Physics = {
    topSpeed(stats) { return 10 + stats.speed * 0.17; },            // ед/с
    accel(stats) { return 3.5 + stats.accel * 0.085; },
    brake(stats) { return 6 + stats.brakes * 0.13; },
    latGrip(stats) { return 7 + stats.handling * 0.075; },          // предельное боковое ускорение
    turnRate(stats) { return 1.3 + stats.handling * 0.022; },       // рад/с
    climbFactor(stats) { return 1.35 - stats.climb * 0.0085; },
    // Множитель максимальной скорости от покрытия.
    surfaceSpeed(stats, wheelId, surface) {
      const w = D.WHEELS[wheelId];
      const s = D.SURFACES[surface];
      const rough = s.rough * (1 - stats.offroad / 110);
      return w.roll[surface] * (1 - rough * 0.65);
    },
    surfaceGrip(stats, wheelId, surface) {
      return D.SURFACES[surface].grip * D.WHEELS[wheelId].grip[surface];
    },
    slopeSpeed(stats, slope) {
      return clamp(1 - slope * 3.4 * this.climbFactor(stats), 0.42, 1.35);
    },
    kmh(v) { return v * 2.25; },
  };

  window.GameState = {
    load, save, newGame, grantBike, effectiveStats, upgradePrice, wheelFits, Physics, clamp,
    riderProfile, riderLevel, trainingPrice,
  };
})();
