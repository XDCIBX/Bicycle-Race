// Триатлон и его разновидности (акватлон, дуатлон, Ironman 70.3, Ironman).
// Время каждого спортсмена считается по «реальной» модели: скорости плавания и бега,
// велоэтап — по характеристикам велосипеда на трассе, транзиты, гликоген, гели,
// пункты питания, усталость и выбранный темп. Гонка проигрывается в ускоренном времени:
// каждый этап показан на своей трассе (озеро, велотрасса, беговой парк).
(function () {
  'use strict';
  const D = window.GameData;
  const GS = window.GameState;
  const clamp = GS.clamp;

  const EVENTS = [
    { id: 'aquathlon', name: 'Акватлон', tier: 1, level: 1, prize: 350, legs: [['swim', 1.0], ['t1'], ['run', 5]], place: 'Городское озеро',
      desc: 'Плавание и бег без велоэтапа — проверка «чистой» физики.' },
    { id: 'supersprint', name: 'Супер-спринт', tier: 1, level: 1, prize: 450, legs: [['swim', 0.4], ['t1'], ['bike', 10], ['t2'], ['run', 2.5]], bikeTrack: 'crit', place: 'Набережная, кольцо в центре',
      desc: 'Короткая и взрывная гонка: транзиты решают всё.' },
    { id: 'sprint', name: 'Спринт', tier: 2, level: 3, prize: 750, legs: [['swim', 0.75], ['t1'], ['bike', 20], ['t2'], ['run', 5]], bikeTrack: 'highway', place: 'Загородное шоссе',
      desc: 'Классика для старта в триатлоне.' },
    { id: 'duathlon', name: 'Дуатлон', tier: 2, level: 4, prize: 800, legs: [['run', 5], ['t1'], ['bike', 40], ['t2'], ['run', 10]], bikeTrack: 'crit', place: 'Городской критериум',
      desc: 'Бег — вело — бег. Второй беговой этап на забитых ногах.' },
    { id: 'olympic', name: 'Олимпийская дистанция', tier: 3, level: 6, prize: 1300, legs: [['swim', 1.5], ['t1'], ['bike', 40], ['t2'], ['run', 10]], bikeTrack: 'highway', place: 'Олимпийский формат',
      desc: '1,5 / 40 / 10 км — дистанция Олимпийских игр.' },
    { id: 'half', name: 'Ironman 70.3', tier: 4, level: 12, prize: 2600, legs: [['swim', 1.9], ['t1'], ['bike', 90], ['t2'], ['run', 21.1]], bikeTrack: 'mountain', place: 'Горная велотрасса', cutoff: 8.5 * 3600,
      desc: 'Половина «железной» дистанции — 113 км. Без питания не обойтись.' },
    { id: 'ironman', name: 'Ironman', tier: 5, level: 20, prize: 5000, legs: [['swim', 3.8], ['t1'], ['bike', 180], ['t2'], ['run', 42.2]], bikeTrack: 'highway', place: 'Жаркое шоссе вдоль океана', cutoff: 17 * 3600,
      desc: '226 км: 3,8 км плавания, 180 км вело и марафон. Темп и гели важнее скорости.' },
  ];
  const LEG_INFO = {
    swim: { icon: '🏊', name: 'Плавание' }, bike: { icon: '🚴', name: 'Велоэтап' }, run: { icon: '🏃', name: 'Бег' },
    t1: { icon: '⏱', name: 'Транзит T1' }, t2: { icon: '⏱', name: 'Транзит T2' },
  };
  const PACES = {
    easy: { name: 'Спокойно', icon: '🐢', speed: 0.94, burn: 0.7 },
    steady: { name: 'Ровно', icon: '⚖️', speed: 1.0, burn: 1.0 },
    hard: { name: 'Мощно', icon: '🔥', speed: 1.05, burn: 1.45 },
  };
  // Расход гликогена в час (ровный темп) и поступление на пунктах питания.
  const BURN = { swim: 45, bike: 55, run: 70 };
  const SCREEN_SECONDS = { swim: 38, bike: 50, run: 45, t: 3.5 };
  const BOT_TRI = [0.3, 2, 4, 6.5, 9];

  // ── Профиль триатлета ────────────────────────────────────────
  function triProfile(triSkills, perks) {
    const sk = triSkills || {};
    const lv = (id) => sk[id] || 0;
    const pe = (perks && perks.length && window.Progression) ? window.Progression.perkEffects(perks).tri : {};
    const p = (k) => pe[k] || 0;
    return {
      swimV: (0.78 + 0.065 * lv('swim')) * (1 + p('swim')),
      runV: (2.55 + 0.17 * lv('run')) * (1 + p('run')),
      t1: Math.max(35, 140 - 9 * lv('transition')) * (1 - p('transition')),
      t2: Math.max(25, 95 - 6 * lv('transition')) * (1 - p('transition')),
      glyMax: 100 * (1 + 0.1 * lv('stamina') + p('glycogen')),
      fatigue: 0.025 * (1 - 0.06 * lv('stamina')),
      gels: 3 + Math.floor(lv('nutrition') / 2) + p('gels'),
      gelPower: 28 * (1 + 0.05 * lv('nutrition')) * (1 + p('gelPower')),
      aid: { bike: 30 + 3 * lv('nutrition'), run: 20 + 2.5 * lv('nutrition') },
    };
  }

  // Средняя скорость велоэтапа (м/с) по оценке времени круга на трассе.
  function bikeSpeed(bikeTrack, stats, wheel, skill) {
    const tr = window.Tracks.get(bikeTrack);
    const lap = window.Tracks.estimateLap(tr, stats, wheel);
    // Игровая скорость → реалистичная средняя на длинной дистанции (TT-байк ≈ 45 км/ч, МТБ ≈ 24 км/ч).
    const kmh = 9 + 0.58 * (tr.L / lap * 2.25) * (skill || 1);
    return kmh / 3.6;
  }

  function bestBotBike(bikeTrack, tier, rnd) {
    const pool = D.BIKES.filter((b) => b.tier >= tier - 1 && b.tier <= Math.max(2, tier + 1));
    const lvl = clamp(tier - 2, 0, 4);
    let best = null;
    pool.forEach((b) => {
      const up = {};
      D.UPGRADES.forEach((u) => { up[u.id] = lvl; });
      Object.keys(D.WHEELS).forEach((w) => {
        if (!b.sizes.includes(D.WHEELS[w].size)) return;
        const st = GS.effectiveStats(b.id, up, w);
        const lap = window.Tracks.estimateLap(window.Tracks.get(bikeTrack), st, w) * (1 + rnd() * 0.04);
        if (!best || lap < best.lap) best = { bikeId: b.id, wheel: w, stats: st, lap };
      });
    });
    return best;
  }

  function fmtClock(t) {
    t = Math.max(0, Math.round(t));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
  }
  function fmtPace(kind, v) {
    if (kind === 'swim') { const t = 100 / Math.max(0.1, v); return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')} /100 м`; }
    if (kind === 'run') { const t = 1000 / Math.max(0.1, v); return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')} /км`; }
    if (kind === 'bike') return `${Math.round(v * 3.6)} км/ч`;
    return '';
  }

  class TriRace {
    constructor(eventId, player, opts) {
      const o = opts || {};
      this.mode = 'tri';
      this.event = EVENTS.find((e) => e.id === eventId);
      this.def = { name: this.event.name, tier: o.tier || this.event.tier, id: eventId };
      this.legs = this.event.legs.map(([kind, km]) => ({ kind, meters: (km || 0) * 1000 }));
      this.state = 'countdown';
      this.countdown = o.countdown != null ? o.countdown : 3;
      this.realTime = 0;
      this.time = 0; // экранное время
      this.particles = [];
      this.events = [];
      this.rnd = window.Tracks.mulberry32((Date.now() ^ (o.seed || 0)) >>> 0);
      const tier = this.def.tier;
      const roster = o.roster;
      const names = D.BOT_NAMES.slice().sort(() => this.rnd() - 0.5);
      const bikeTrack = this.event.bikeTrack;
      const bots = Array.from({ length: 5 }, (_, i) => {
        const ro = roster && roster[i];
        const jit = ro ? ro.triJitter : this.rnd();
        const base = BOT_TRI[tier - 1];
        const lv = () => clamp(Math.round(base - 1 + jit * 2 + this.rnd() * 2 - (i === 4 ? 2 : 0)), 0, 10);
        const sk = { swim: lv(), run: lv(), transition: lv(), stamina: lv(), nutrition: lv() };
        const bk = bikeTrack ? bestBotBike(bikeTrack, tier, this.rnd) : { bikeId: 'tcr', wheel: 'gp5000', stats: D.bikeById('tcr').stats };
        const skill = [0.8, 0.86, 0.91, 0.94, 0.965][tier - 1] + (ro ? ro.skillJitter : this.rnd() * 0.04 - 0.02);
        return {
          name: ro ? ro.name : names[i], isPlayer: false,
          jersey: ro ? ro.jersey : D.BOT_COLORS[(i + 1) % D.BOT_COLORS.length],
          helmet: ro ? ro.helmet : ['#ffffff', '#111111', '#e0e0e0'][i % 3],
          bikeId: bk.bikeId, wheel: bk.wheel, tri: triProfile(sk), skill,
          bikeV: bikeTrack ? bikeSpeed(bikeTrack, bk.stats, bk.wheel, skill) : 0,
          pace: ['steady', 'steady', 'hard', 'easy'][Math.floor(this.rnd() * 4)], autoGel: true,
        };
      });
      const me = Object.assign({ isPlayer: true, jersey: '#ff2d55', helmet: '#ffd400', autoGel: true }, player);
      me.bikeV = bikeTrack ? bikeSpeed(bikeTrack, player.stats, player.wheel, player.skill) : 0;
      this.athletes = [...bots.slice(0, 3), me, ...bots.slice(3)];
      this.athletes.forEach((a, i) => {
        Object.assign(a, {
          leg: 0, legDist: 0, legTime: 0, splits: [], total: 0, finished: false,
          gly: a.tri.glyMax, gelsLeft: a.tri.gels, bonk: false, place: i + 1,
          lane: (i - 2.5) / 3.2, phase: this.rnd() * 6, speed: 0,
        });
      });
      this.player = me;
      this.courses = {
        swim: window.Tracks.get('swimcourse'),
        bike: bikeTrack ? window.Tracks.get(bikeTrack) : null,
        run: window.Tracks.get('runcourse'),
      };
      this.firstFrame = true;
      this.viewLeg = -1;
      this.order = this.athletes.slice();
    }

    legKind(a) { const l = this.legs[a.leg]; return l ? l.kind : 'done'; }
    isTransition(kind) { return kind === 't1' || kind === 't2'; }

    // Сколько реальных секунд проходит за одну экранную — по текущему этапу игрока.
    timeScale() {
      const p = this.player;
      const leg = this.legs[Math.min(p.leg, this.legs.length - 1)];
      if (this.isTransition(leg.kind)) return (leg.kind === 't1' ? p.tri.t1 : p.tri.t2) / SCREEN_SECONDS.t;
      const v = this.baseSpeed(p, leg.kind);
      return leg.meters / v / SCREEN_SECONDS[leg.kind];
    }

    baseSpeed(a, kind) {
      if (kind === 'swim') return a.tri.swimV;
      if (kind === 'run') return a.tri.runV;
      if (kind === 'bike') return a.bikeV;
      return 1;
    }

    // Текущая скорость с учётом темпа, усталости и «стены».
    speedNow(a, kind) {
      const pace = PACES[a.pace] || PACES.steady;
      const hours = a.total / 3600;
      const fatigue = Math.max(0.75, 1 - a.tri.fatigue * hours * (kind === 'run' ? 1.4 : 1));
      a.bonk = a.gly <= 0;
      return this.baseSpeed(a, kind) * pace.speed * fatigue * (a.bonk ? 0.7 : 1);
    }

    takeGel(a) {
      if (a.gelsLeft <= 0 || a.finished) return false;
      a.gelsLeft--;
      a.gly = Math.min(a.tri.glyMax, a.gly + a.tri.gelPower);
      if (a.isPlayer) this.events.push({ t: this.time, text: '🍌 Гель!' });
      return true;
    }

    stepAthlete(a, dt) {
      if (a.finished) return;
      const leg = this.legs[a.leg];
      a.total += dt;
      if (this.isTransition(leg.kind)) {
        a.legTime += dt;
        a.speed = 1.5;
        const need = leg.kind === 't1' ? a.tri.t1 : a.tri.t2;
        if (a.legTime >= need) this.nextLeg(a, need);
        return;
      }
      const v = this.speedNow(a, leg.kind);
      a.speed = v;
      a.legDist += v * dt;
      a.legTime += dt;
      const pace = PACES[a.pace] || PACES.steady;
      const intake = leg.kind === 'bike' ? a.tri.aid.bike : leg.kind === 'run' ? a.tri.aid.run : 0;
      a.gly = Math.min(a.tri.glyMax, a.gly - (BURN[leg.kind] * pace.burn - intake) * dt / 3600);
      if (a.gly < 0) a.gly = Math.max(-5, a.gly);
      if (a.autoGel && a.gly < a.tri.glyMax * 0.22) this.takeGel(a);
      if (a.legDist >= leg.meters) {
        // Точное время финиша этапа (с учётом перелёта за шаг).
        const over = (a.legDist - leg.meters) / Math.max(0.1, v);
        a.total -= over;
        this.nextLeg(a, a.legTime - over);
        a.total += over;
      }
    }

    nextLeg(a, legTime) {
      a.splits.push(legTime);
      a.leg++;
      a.legDist = 0;
      a.legTime = 0;
      if (a.leg >= this.legs.length) {
        a.finished = true;
        a.total = a.splits.reduce((x, y) => x + y, 0);
        if (a.isPlayer) this.events.push({ t: this.time, text: '🏁 Финиш!' });
      } else if (a.isPlayer) {
        const k = this.legs[a.leg].kind;
        this.events.push({ t: this.time, text: `${LEG_INFO[k].icon} ${LEG_INFO[k].name}` });
      }
    }

    // Пройдено метров всего (для позиций), транзиты считаем как «стоим на месте».
    covered(a) {
      let m = 0;
      for (let i = 0; i < a.leg && i < this.legs.length; i++) m += this.legs[i].meters + (this.isTransition(this.legs[i].kind) ? 1 : 0);
      return m + (a.leg < this.legs.length ? a.legDist + (this.isTransition(this.legs[a.leg].kind) ? a.legTime / 1000 : 0) : 0);
    }

    update(dt) {
      this.dt = dt;
      if (this.state === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0) this.state = 'racing';
        this.updateView();
        return;
      }
      this.time += dt;
      let real = dt * this.timeScale();
      // Мелкие шаги, чтобы переходы между этапами были точными.
      while (real > 0) {
        const h = Math.min(real, 4);
        real -= h;
        this.realTime += h;
        this.athletes.forEach((a) => this.stepAthlete(a, h));
        if (this.player.finished) break;
      }
      this.updatePlaces();
      if (this.state === 'racing' && this.player.finished) { this.state = 'finishing'; this.finishTimer = 2.2; }
      if (this.state === 'finishing') {
        this.finishTimer -= dt;
        if (this.finishTimer <= 0) { this.finishAll(); this.state = 'done'; }
      }
      this.updateView();
    }

    // Быстрая перемотка до конца текущего этапа игрока.
    skipLeg() {
      const leg = this.player.leg;
      let guard = 0;
      while (!this.player.finished && this.player.leg === leg && guard++ < 20000) {
        this.realTime += 2;
        this.athletes.forEach((a) => this.stepAthlete(a, 2));
      }
      this.updatePlaces();
    }

    finishAll() {
      let guard = 0;
      while (this.athletes.some((a) => !a.finished) && guard++ < 100000) this.athletes.forEach((a) => this.stepAthlete(a, 5));
      this.updatePlaces();
      const cut = this.event.cutoff || Infinity;
      this.athletes.forEach((a) => { a.dnf = a.total > cut; });
      this.results = this.athletes.slice().sort((a, b) => (a.dnf - b.dnf) || (a.total - b.total))
        .map((a) => ({ rider: a, time: a.total, splits: a.splits, dnf: a.dnf }));
    }

    updatePlaces() {
      const sorted = this.athletes.slice().sort((a, b) => {
        if (a.finished && b.finished) return a.total - b.total;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return this.covered(b) - this.covered(a);
      });
      sorted.forEach((a, i) => { a.place = i + 1; });
      this.order = sorted;
    }

    // ── Представление для рендера: участники текущего этапа игрока на своей трассе ──
    updateView() {
      const p = this.player;
      const legIdx = Math.min(p.leg, this.legs.length - 1);
      let kind = this.legs[legIdx].kind;
      // Во время транзита показываем начало следующего этапа (зону смены).
      let showIdx = legIdx;
      if (this.isTransition(kind)) { showIdx = Math.min(legIdx + 1, this.legs.length - 1); kind = this.legs[showIdx].kind; }
      const course = this.courses[kind] || this.courses.run;
      if (showIdx !== this.viewLeg) { this.viewLeg = showIdx; this.firstFrame = true; }
      this.track = course;
      const riders = [];
      this.athletes.forEach((a) => {
        if (a.finished) return;
        let s, mode = kind;
        const prev = this.legs[showIdx - 1];
        if (a.leg === showIdx) {
          s = (a.legDist / this.legs[showIdx].meters) * course.L;
        } else if (a.leg === showIdx - 1 && prev && this.isTransition(prev.kind)) {
          // В зоне смены: стоят у старта следующего этапа.
          const need = prev.kind === 't1' ? a.tri.t1 : a.tri.t2;
          s = -6 - 4 * (1 - a.legTime / need);
          mode = 'run';
        } else return;
        const q = course.sampleAt(s);
        const lat = a.lane * course.hw * 0.75;
        a.mode = mode;
        a.x = q.x + q.nx * lat; a.y = q.y + q.ny * lat; a.z = q.z;
        a.heading = q.ang; a.v = 9; a.lean = 0;
        a.phase += this.dt * (mode === 'swim' ? 5 : mode === 'run' ? 9 : 7) * (this.state === 'racing' ? 1 : 0);
        a.pedal = a.phase;
        riders.push(a);
      });
      // Если игрок в транзите, камера смотрит на зону смены.
      if (!riders.includes(p)) {
        const q = course.sampleAt(-8);
        Object.assign(p, { x: q.x, y: q.y, z: q.z, heading: q.ang, v: 0, mode: 'run' });
        riders.push(p);
      }
      this.riders = riders;
      this.focus = p;
      // Брызги за пловцами.
      if (kind === 'swim' && this.state === 'racing') {
        riders.forEach((a) => {
          if (this.particles.length < 300 && this.rnd() < this.dt * 10) {
            this.particles.push({ x: a.x - Math.cos(a.heading) * 0.8, y: a.y - Math.sin(a.heading) * 0.8, z: 0.1, vx: (this.rnd() - 0.5), vy: (this.rnd() - 0.5), vz: 0.6, life: 0.6, max: 0.6, r: 0.07, c: '#e8f6ff', alpha: 0.6, grow: 0.15 });
          }
        });
      }
      this.particles.forEach((q) => { q.life -= this.dt; q.x += q.vx * this.dt; q.y += q.vy * this.dt; q.z = Math.max(0, q.z + q.vz * this.dt); q.vz -= 1.5 * this.dt; q.r += q.grow * this.dt; });
      this.particles = this.particles.filter((q) => q.life > 0);
    }

    progress(a) { return this.covered(a); }
  }

  window.Triathlon = { EVENTS, LEG_INFO, PACES, TriRace, triProfile, bikeSpeed, fmtClock, fmtPace, eventById: (id) => EVENTS.find((e) => e.id === id) };
})();
