// Точка входа: меню ↔ гонка, игровой цикл, управление, HUD.
(function () {
  'use strict';
  const D = window.GameData;
  const GS = window.GameState;
  const $ = (id) => document.getElementById(id);

  const state = GS.load();
  const view = $('race-view');
  const canvas = $('game');
  const renderer = new window.Render.Renderer(canvas);
  const mini = $('minimap');
  const mctx = mini.getContext('2d');
  let race = null;
  let paused = false;
  let lastT = 0;
  let raf = 0;
  let miniMap = null;

  // ── Управление ────────────────────────────────────────────
  const keys = {};
  const touch = { left: false, right: false, up: false, brake: false, sprint: false };
  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'brake', KeyS: 'brake', Space: 'brake',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
  };
  window.addEventListener('keydown', (e) => {
    if (!race) return;
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyR' && !paused) respawn();
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
  window.addEventListener('blur', () => { Object.keys(keys).forEach((k) => { keys[k] = false; }); });
  document.querySelectorAll('#touch button').forEach((b) => {
    const k = b.dataset.k;
    const on = (e) => { e.preventDefault(); touch[k] = true; b.classList.add('on'); };
    const off = (e) => { e.preventDefault(); touch[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  });
  function readInput() {
    const k = (n) => keys[n] || touch[n];
    return {
      throttle: !!k('up') && !k('brake'),
      brake: !!k('brake'),
      steer: (k('right') ? 1 : 0) - (k('left') ? 1 : 0),
      sprint: !!k('sprint'),
    };
  }

  function respawn() {
    if (!race || race.state !== 'racing') return;
    const r = race.player;
    const p = race.track.samples[r.idx];
    r.x = p.x; r.y = p.y; r.heading = p.ang; r.v = Math.min(r.v, 4); r.wrongWay = 0;
  }

  // ── Запуск гонки ──────────────────────────────────────────
  let lastTrack = null;
  function startRace(trackId) {
    lastTrack = trackId;
    const o = state.owned[state.active];
    race = new window.RaceEngine.Race(trackId, {
      bikeId: state.active, wheel: o.wheel, stats: GS.effectiveStats(state.active, o.upgrades, o.wheel),
    });
    view.hidden = false;
    $('results').hidden = true;
    $('pause').hidden = true;
    paused = false;
    document.body.style.overflow = 'hidden';
    renderer.resize();
    buildMiniMap();
    $('hud-total').textContent = race.riders.length;
    $('hud-keys').style.opacity = 1;
    setTimeout(() => { $('hud-keys').style.opacity = 0; }, 7000);
    lastT = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function leaveRace(screen) {
    cancelAnimationFrame(raf);
    race = null;
    view.hidden = true;
    document.body.style.overflow = '';
    window.UI.show(screen || 'tracks');
  }

  function togglePause() {
    if (!race || race.state === 'done') return;
    paused = !paused;
    $('pause').hidden = !paused;
    if (!paused) lastT = performance.now();
  }
  $('btn-pause').onclick = togglePause;
  $('btn-resume').onclick = togglePause;
  $('btn-restart').onclick = () => startRace(lastTrack);
  $('btn-quit').onclick = () => leaveRace('tracks');

  window.addEventListener('resize', () => { if (race) { renderer.resize(); } });

  // ── Миникарта ─────────────────────────────────────────────
  function buildMiniMap() {
    const size = 200;
    mini.width = size; mini.height = size;
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    const map = window.Render.drawTrackMap(off.getContext('2d'), race.track, size, size, { lw: 4, pad: 14 });
    miniMap = { img: off, tx: map.tx, ty: map.ty };
  }
  function drawMiniMap() {
    mctx.clearRect(0, 0, mini.width, mini.height);
    mctx.drawImage(miniMap.img, 0, 0);
    for (const r of race.riders) {
      if (r.isPlayer) continue;
      mctx.fillStyle = r.jersey;
      mctx.beginPath(); mctx.arc(miniMap.tx(r.x), miniMap.ty(r.y), 3.5, 0, 7); mctx.fill();
    }
    const p = race.player;
    mctx.fillStyle = '#ff2d55'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(miniMap.tx(p.x), miniMap.ty(p.y), 5.5, 0, 7); mctx.fill(); mctx.stroke();
  }

  // ── HUD ───────────────────────────────────────────────────
  const hudCache = {};
  function setText(id, txt) {
    if (hudCache[id] !== txt) { hudCache[id] = txt; $(id).textContent = txt; }
  }
  function updateHud() {
    const p = race.player;
    const P = GS.Physics;
    setText('hud-pos', String(p.place));
    setText('hud-lap', `Круг ${Math.min(race.laps, Math.max(1, p.lap + 1))}/${race.laps}`);
    setText('hud-time', window.UI.fmtTime(race.time));
    setText('hud-speed', String(Math.round(P.kmh(p.v))));
    $('hud-energy').style.width = p.energy + '%';
    const surf = D.SURFACES[p.surface];
    setText('hud-surf', p.onRoad ? surf.name : `Вне трассы (${surf.name.toLowerCase()})`);
    $('hud-surf-dot').style.background = surf.color;
    const slope = race.track.samples[p.idx].slope * Math.cos(p.heading - race.track.samples[p.idx].ang);
    setText('hud-slope', Math.abs(slope) > 0.02 ? ` ${slope > 0 ? '↗' : '↘'} ${Math.round(Math.abs(slope) * 100)}%` : '');
    $('hud-warn').hidden = !(p.wrongWay > 1.2);

    let center = '';
    if (race.state === 'countdown') center = race.countdown > 3 ? 'Приготовьтесь' : String(Math.ceil(race.countdown));
    else if (race.time < 1) center = 'СТАРТ!';
    else if (race.state === 'finishing') center = p.finished ? 'ФИНИШ!' : 'Время вышло';
    else if (race.cutoff != null && !p.finished) center = `Лидер финишировал · ${Math.ceil(race.cutoff)} с`;
    else if (p.lap === race.laps - 1 && race.laps > 1 && race.time - p.lastLapStart < 2.5) center = 'Последний круг!';
    const c = $('hud-center');
    setText('hud-center', center);
    c.classList.toggle('small', center.length > 6 && center.length <= 16);
    c.classList.toggle('tiny', center.length > 16);

    // Таблица позиций.
    const leader = race.order[0];
    const rows = race.order.map((r) => {
      let gap = '';
      if (r !== leader) {
        const d = race.progress(leader) - race.progress(r);
        gap = r.finished ? '' : `+${Math.max(0, d / Math.max(8, leader.v || 8)).toFixed(1)}с`;
      }
      return `<li class="${r.isPlayer ? 'me' : ''}"><span class="sw" style="background:${r.jersey}"></span>${r.place}. ${r.name}<span class="gap">${r.finished ? '🏁' : gap}</span></li>`;
    }).join('');
    if (hudCache.board !== rows) { hudCache.board = rows; $('hud-board').innerHTML = rows; }
  }

  // ── Цикл ──────────────────────────────────────────────────
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (!race) return;
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (!paused && race.state !== 'done') race.update(dt, readInput());
    renderer.render(race);
    drawMiniMap();
    updateHud();
    if (race.state === 'done' && !race.shown) {
      race.shown = true;
      window.UI.showResults(race, () => startRace(lastTrack), (screen) => leaveRace(screen));
    }
  }

  window.UI.init(state, startRace);
  // Для отладки и автотестов.
  window.VeloRush = { state, startRace, get race() { return race; }, renderer };
})();
