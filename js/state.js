// Сохранение прогресса и расчёт итоговых характеристик велосипеда.
(function () {
  'use strict';
  const D = window.GameData;
  const SAVE_KEY = 'velorush.save.v1';

  function emptyUpgrades() {
    const u = {};
    D.UPGRADES.forEach((up) => { u[up.id] = 0; });
    return u;
  }

  function newGame() {
    const s = {
      money: D.START_MONEY,
      active: 'stels',
      owned: {},
      wheels: [],
      best: {},
      bestTime: {},
      races: 0,
      wins: 0,
    };
    grantBike(s, 'stels');
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
        // Защита от устаревших/битых сохранений.
        Object.keys(s.owned).forEach((id) => { if (!D.bikeById(id)) delete s.owned[id]; });
        if (!s.owned[s.active]) s.active = Object.keys(s.owned)[0] || 'stels';
        if (!s.owned.stels && Object.keys(s.owned).length === 0) grantBike(s, 'stels');
        Object.values(s.owned).forEach((o) => { o.upgrades = Object.assign(emptyUpgrades(), o.upgrades); });
        return s;
      }
    } catch (e) { /* хранилище недоступно — начинаем заново */ }
    return newGame();
  }

  function save(s) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* игнорируем */ }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Итоговые характеристики = база велосипеда + улучшения + бонусы колёс.
  function effectiveStats(bikeId, upgrades, wheelId) {
    const bike = D.bikeById(bikeId);
    const out = Object.assign({}, bike.stats);
    D.UPGRADES.forEach((up) => {
      const lvl = (upgrades && upgrades[up.id]) || 0;
      Object.entries(up.mods).forEach(([k, v]) => { out[k] += v * lvl; });
    });
    const wheel = D.WHEELS[wheelId || bike.stockWheel];
    Object.entries(wheel.mods).forEach(([k, v]) => { out[k] += v; });
    D.STAT_KEYS.forEach((k) => { out[k] = clamp(out[k], 1, 100); });
    return out;
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

  window.GameState = { load, save, newGame, grantBike, effectiveStats, upgradePrice, wheelFits, Physics, clamp };
})();
