// Точка входа: меню ↔ гонка (велогонка или триатлон), игровой цикл, управление, HUD.
(function () {
  'use strict';
  const D = window.GameData;
  const GS = window.GameState;
  const PR = window.Progression;
  const TRI = window.Triathlon;
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
  let lastStart = null;

  // ── Управление ────────────────────────────────────────
  // Велосипед (и триатлет) движется сам: игрок командует спурт / гель, темп и скорость времени.
  let timeScale = 1;
  window.addEventListener('keydown', (e) => {
    if (!race) return;
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { e.preventDefault(); action(); }
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyF') cycleSpeed();
    if (race && race.mode === 'tri' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) setPace(['easy', 'steady', 'hard'][+e.code.slice(-1) - 1]);
  });
  function flash(b) { b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 600); if (navigator.vibrate) navigator.vibrate(30); }
  function action() {
    if (!race || paused) return;
    const ok = race.mode === 'tri' ? race.takeGel(race.player) : race.sprintNow();
    if (ok) flash($('btn-sprint'));
  }
  function setPace(p) {
    if (!race || race.mode !== 'tri') return;
    race.player.pace = p;
    state.tri.pacing = p;
  }
  function cycleSpeed() {
    timeScale = timeScale === 1 ? 2 : timeScale === 2 ? 4 : 1;
    $('btn-speed').textContent = `×${timeScale}`;
  }
  $('btn-sprint').addEventListener('pointerdown', (e) => { e.preventDefault(); action(); });
  $('btn-speed').addEventListener('click', cycleSpeed);
  document.querySelectorAll('#tri-controls [data-pace]').forEach((b) => { b.onclick = () => setPace(b.dataset.pace); });
  $('btn-skip').onclick = () => { if (race && race.mode === 'tri' && race.state === 'racing') race.skipLeg(); };

  // ── Запуск гонки ──────────────────────────────────────────
  function start(opts) {
    lastStart = opts;
    const o = state.owned[state.active];
    const skills = state.rider.skills;
    const stats = GS.effectiveStats(state.active, o.upgrades, o.wheel, skills, state.perks);
    const profile = GS.riderProfile(skills, state.perks);
    const champ = opts.champ && state.champ ? PR.champById(state.champ.id) : null;
    const extra = champ ? { roster: state.champ.roster, tier: champ.tier } : {};
    if (opts.mode === 'tri') {
      race = new TRI.TriRace(opts.id, {
        name: state.rider.name || 'Вы', bikeId: state.active, wheel: o.wheel, stats, skill: profile.skill,
        tri: TRI.triProfile(state.tri.skills, state.perks), pace: state.tri.pacing || 'steady', autoGel: state.tri.autoGel !== false,
      }, extra);
    } else {
      race = new window.RaceEngine.Race(opts.id, {
        bikeId: state.active, wheel: o.wheel, stats, profile, tactic: state.tactic, name: state.rider.name || 'Вы',
      }, extra);
    }
    const tri = race.mode === 'tri';
    $('tri-controls').hidden = !tri;
    $('hud-legs').hidden = !tri;
    $('btn-sprint').innerHTML = tri ? '🍌<span>Гель</span>' : '⚡<span>Спурт</span>';
    timeScale = 1;
    $('btn-speed').textContent = '×1';
    view.hidden = false;
    $('results').hidden = true;
    $('pause').hidden = true;
    paused = false;
    document.body.style.overflow = 'hidden';
    renderer.resize();
    if (tri) race.updateView();
    buildMiniMap();
    $('hud-total').textContent = (race.riders || race.athletes).length;
    lastT = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function leaveRace(screen) {
    cancelAnimationFrame(raf);
    race = null;
    view.hidden = true;
    document.body.style.overflow = '';
    window.UI.show(screen || 'race');
  }

  function togglePause() {
    if (!race || race.state === 'done') return;
    paused = !paused;
    $('pause').hidden = !paused;
    if (!paused) lastT = performance.now();
  }
  $('btn-pause').onclick = togglePause;
  $('btn-resume').onclick = togglePause;
  // Перезапуск этапа чемпионата не даёт «переиграть» результат: только одиночные гонки.
  $('btn-restart').onclick = () => start(Object.assign({}, lastStart, { champ: false }));
  $('btn-quit').onclick = () => leaveRace('race');

  window.addEventListener('resize', () => { if (race) renderer.resize(); });

  // ── Миникарта ─────────────────────────────────────────────
  function buildMiniMap() {
    const size = 200;
    mini.width = size; mini.height = size;
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    const map = window.Render.drawTrackMap(off.getContext('2d'), race.track, size, size, { lw: 4, pad: 14 });
    miniMap = { img: off, tx: map.tx, ty: map.ty, track: race.track };
  }
  function drawMiniMap() {
    if (miniMap.track !== race.track) buildMiniMap();
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
  function setHtml(id, html) {
    if (hudCache[id] !== html) { hudCache[id] = html; $(id).innerHTML = html; }
  }
  function centerText(center) {
    const c = $('hud-center');
    setText('hud-center', center);
    c.classList.toggle('small', center.length > 6 && center.length <= 16);
    c.classList.toggle('tiny', center.length > 16);
  }
  // Короткие всплывающие события (гель, второе дыхание, смена этапа).
  function eventText() {
    const ev = race.events && race.events[race.events.length - 1];
    setText('hud-event', ev && race.time - ev.t < 2.2 ? ev.text : '');
  }

  function updateHudCycle() {
    const p = race.player;
    const P = GS.Physics;
    setText('hud-pos', String(p.place));
    setText('hud-lap', `Круг ${Math.min(race.laps, Math.max(1, p.lap + 1))}/${race.laps}`);
    setText('hud-time', window.UI.fmtTime(race.time));
    setText('hud-speed', String(Math.round(P.kmh(p.v))));
    $('hud-speed').nextElementSibling.textContent = 'км/ч';
    $('hud-energy').parentElement.nextElementSibling.textContent = 'Энергия';
    $('hud-energy').style.width = (p.energy / p.profile.energyMax * 100) + '%';
    const tac = D.TACTICS.find((t) => t.id === p.tactic);
    const sprintOn = p.sprintHold > 0;
    setText('hud-tactic', sprintOn ? '⚡ СПУРТ!' : `${tac.icon} ${tac.name}${p.drafting ? ' · на колесе' : ''}`);
    $('hud-tactic').classList.toggle('sprint', sprintOn);
    $('btn-sprint').disabled = p.energy < p.profile.energyMax * 0.08 || race.state !== 'racing' || p.finished;
    const surf = D.SURFACES[p.surface];
    setText('hud-surf', p.onRoad ? surf.name : `Вне трассы (${surf.name.toLowerCase()})`);
    $('hud-surf-dot').style.background = surf.color;
    const slope = race.track.samples[p.idx].slope * Math.cos(p.heading - race.track.samples[p.idx].ang);
    setText('hud-slope', Math.abs(slope) > 0.02 ? ` ${slope > 0 ? '↗' : '↘'} ${Math.round(Math.abs(slope) * 100)}%` : '');
    let center = '';
    if (race.state === 'countdown') center = race.countdown > 3 ? 'Приготовьтесь' : String(Math.ceil(race.countdown));
    else if (race.time < 1) center = 'СТАРТ!';
    else if (race.state === 'finishing') center = p.finished ? 'ФИНИШ!' : 'Время вышло';
    else if (race.cutoff != null && !p.finished) center = `Лидер финишировал · ${Math.ceil(race.cutoff)} с`;
    else if (p.lap === race.laps - 1 && race.laps > 1 && race.time - p.lastLapStart < 2.5) center = 'Последний круг!';
    centerText(center);
    const leader = race.order[0];
    setHtml('hud-board', race.order.map((r) => {
      let gap = '';
      if (r !== leader) gap = r.finished ? '' : `+${Math.max(0, (race.progress(leader) - race.progress(r)) / Math.max(8, leader.v || 8)).toFixed(1)}с`;
      return `<li class="${r.isPlayer ? 'me' : ''}"><span class="sw" style="background:${r.jersey}"></span>${r.place}. ${r.name}<span class="gap">${r.finished ? '🏁' : gap}</span></li>`;
    }).join(''));
  }

  function updateHudTri() {
    const p = race.player;
    const legIdx = Math.min(p.leg, race.legs.length - 1);
    const leg = race.legs[legIdx];
    const info = TRI.LEG_INFO[leg.kind];
    setText('hud-pos', String(p.place));
    setText('hud-lap', p.finished ? '🏁 Финиш' : race.isTransition(leg.kind) ? info.name : `${info.icon} ${(p.legDist / 1000).toFixed(leg.meters > 5000 ? 1 : 2)} / ${leg.meters / 1000} км`);
    setText('hud-time', TRI.fmtClock(race.realTime));
    setText('hud-speed', race.isTransition(leg.kind) ? '—' : TRI.fmtPace(leg.kind, p.speed).replace(/ .*/, ''));
    $('hud-speed').nextElementSibling.textContent = race.isTransition(leg.kind) ? '' : TRI.fmtPace(leg.kind, p.speed).replace(/^[^ ]+ /, '');
    $('hud-energy').style.width = Math.max(0, p.gly / p.tri.glyMax * 100) + '%';
    $('hud-energy').parentElement.nextElementSibling.textContent = `Гликоген · гелей ${p.gelsLeft}`;
    const pace = TRI.PACES[p.pace];
    setText('hud-tactic', `${pace.icon} ${pace.name}${p.bonk ? ' · 🧱 «СТЕНА»!' : ''}`);
    $('hud-tactic').classList.toggle('sprint', false);
    setText('hud-surf', race.isTransition(leg.kind) ? 'Транзитная зона' : leg.kind === 'swim' ? 'Открытая вода' : leg.kind === 'run' ? 'Беговая трасса' : D.SURFACES[race.track.sampleAt(0).surface].name);
    $('hud-surf-dot').style.background = leg.kind === 'swim' ? '#2f7fb8' : leg.kind === 'run' ? '#b07a5a' : '#4b4f56';
    setText('hud-slope', '');
    $('btn-sprint').disabled = p.gelsLeft <= 0 || p.finished || race.state !== 'racing';
    document.querySelectorAll('#tri-controls [data-pace]').forEach((b) => b.classList.toggle('on', b.dataset.pace === p.pace));
    setHtml('hud-legs', race.legs.map((l, i) => `<span class="${i < p.leg ? 'done' : i === p.leg ? 'now' : ''}">${TRI.LEG_INFO[l.kind].icon}${l.kind[0] === 't' ? l.kind.toUpperCase() : ''}</span>`).join('<i>›</i>'));
    let center = '';
    if (race.state === 'countdown') center = race.countdown > 2.5 ? race.event.name : String(Math.ceil(race.countdown));
    else if (race.time < 1) center = 'СТАРТ!';
    else if (race.state === 'finishing') center = 'ФИНИШ!';
    centerText(center);
    const leader = race.order[0];
    setHtml('hud-board', race.order.map((a) => {
      let gap = '';
      if (a.finished) gap = TRI.fmtClock(a.total);
      else if (a !== leader) gap = `−${Math.max(0, Math.round((race.covered(leader) - race.covered(a)))).toLocaleString('ru-RU')} м`;
      const k = race.legs[Math.min(a.leg, race.legs.length - 1)].kind;
      return `<li class="${a.isPlayer ? 'me' : ''}"><span class="sw" style="background:${a.jersey}"></span>${a.place}. ${a.name} ${a.finished ? '🏁' : TRI.LEG_INFO[k].icon}<span class="gap">${gap}</span></li>`;
    }).join(''));
  }

  // ── Адаптивное качество: держим плавные 60 кадров на телефонах ──
  const perf = { sum: 0, n: 0 };
  function adaptQuality(frameMs) {
    perf.sum += frameMs; perf.n++;
    if (perf.n < 45) return;
    const avg = perf.sum / perf.n;
    perf.sum = 0; perf.n = 0;
    let q = renderer.quality;
    if (avg > 21 && q > 0.5) q = Math.max(0.5, q - 0.15);
    else if (avg < 13 && q < 1) q = Math.min(1, q + 0.1);
    if (q !== renderer.quality) { renderer.quality = q; renderer.resize(); }
  }

  // ── Цикл ──────────────────────────────────────────────────
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (!race) return;
    const frameMs = t - lastT;
    const dt = Math.min(0.05, frameMs / 1000);
    lastT = t;
    if (frameMs > 0 && frameMs < 200) adaptQuality(frameMs);
    if (!paused && race.state !== 'done') {
      // При ускорении времени делаем несколько шагов, чтобы физика оставалась точной.
      for (let k = 0; k < timeScale && race.state !== 'done'; k++) race.update(dt);
    }
    renderer.render(race);
    race.firstFrame = false;
    drawMiniMap();
    if (race.mode === 'tri') updateHudTri(); else updateHudCycle();
    eventText();
    if (race.state === 'done' && !race.shown) {
      race.shown = true;
      window.UI.showResults(race, {
        champ: !!(lastStart && lastStart.champ),
        onAgain: () => start(Object.assign({}, lastStart, { champ: false })),
        onMenu: (screen) => leaveRace(screen),
      });
    }
  }

  window.UI.init(state, start);
  // Для отладки и автотестов.
  window.VeloRush = { state, start, startRace: (id) => start({ mode: 'cycle', id }), startTri: (id) => start({ mode: 'tri', id }), get race() { return race; }, renderer };
})();
