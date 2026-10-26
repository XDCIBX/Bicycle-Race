// Логика гонки: физика велосипеда, автопилот гонщиков (и игрока, и соперников),
// тактика и энергия, «сидение на колесе», круги и позиции.
(function () {
  'use strict';
  const D = window.GameData;
  const GS = window.GameState;
  const P = GS.Physics;
  const clamp = GS.clamp;

  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  // Подбор соперников: велосипеды близкого уровня, лучшие колёса под трассу.
  // Чем выше уровень трассы, тем сильнее соперники и тем точнее они подбирают технику.
  const FINISH_CUTOFF = 45;
  const BOT_SKILL = [0.8, 0.86, 0.91, 0.94, 0.965];
  const BOT_UPGRADES = [0, 0, 1, 2, 3];
  function makeBots(track, count, rnd) {
    const t = track.def.tier;
    const pool = D.BIKES.filter((b) => b.tier >= t - 1 && b.tier <= Math.max(2, t + 1));
    const options = pool.map((b) => {
      const upgrades = {};
      D.UPGRADES.forEach((u) => { upgrades[u.id] = clamp(BOT_UPGRADES[t - 1] + (rnd() < 0.4 ? 1 : 0), 0, D.MAX_UPGRADE); });
      let best = null;
      Object.keys(D.WHEELS).forEach((wid) => {
        if (!b.sizes.includes(D.WHEELS[wid].size)) return;
        const st = GS.effectiveStats(b.id, upgrades, wid);
        const lap = window.Tracks.estimateLap(track, st, wid);
        if (!best || lap < best.lap) best = { wheel: wid, lap, stats: st };
      });
      return { bike: b, upgrades, ...best };
    }).sort((a, b) => a.lap - b.lap);
    const strong = t >= 3 ? options.slice(0, 4) : options;
    const chosen = [];
    for (let i = 0; i < count; i++) {
      const src = i === count - 1 ? options : strong;
      chosen.push(src[Math.floor(rnd() * src.length)]);
    }
    const names = D.BOT_NAMES.slice().sort(() => rnd() - 0.5);
    return chosen.map((c, i) => {
      const lvl = Math.min(D.RIDER_MAX, (t - 1) * 2);
      const profile = GS.riderProfile({ endurance: lvl, sprint: lvl, tactics: lvl, technique: lvl });
      profile.corner = 0.95 + t * 0.004;
      return {
      name: names[i],
      bikeId: c.bike.id,
      wheel: c.wheel,
      stats: c.stats,
      profile,
      tactic: D.TACTICS[Math.floor(rnd() * D.TACTICS.length)].id,
      skill: clamp(BOT_SKILL[t - 1] + rnd() * 0.04 - (i === count - 1 ? 0.04 : 0), 0.75, 0.99),
      jersey: D.BOT_COLORS[(i + 1) % D.BOT_COLORS.length],
      helmet: ['#ffffff', '#111111', '#e0e0e0'][i % 3],
      };
    });
  }

  class Race {
    constructor(trackId, player, opts) {
      const o = opts || {};
      this.track = window.Tracks.get(trackId);
      this.def = this.track.def;
      this.laps = this.def.laps;
      this.time = 0;
      this.state = 'countdown';
      this.countdown = o.countdown != null ? o.countdown : 3.5;
      this.particles = [];
      this.firstFrame = true;
      this.dt = 1 / 60;
      this.rnd = window.Tracks.mulberry32((Date.now() ^ (o.seed || 0)) >>> 0);
      this.finishOrder = [];
      const bots = makeBots(this.track, o.bots != null ? o.bots : 5, this.rnd);
      const entries = bots.map((b) => Object.assign({ isPlayer: false }, b));
      if (player) {
        entries.splice(Math.min(entries.length, 3 + Math.floor(this.rnd() * 2)), 0, Object.assign({
          isPlayer: true, name: 'Вы', jersey: '#ff2d55', helmet: '#ffd400', tactic: 'steady',
        }, player));
      }
      const T = this.track;
      this.riders = entries.map((e, i) => {
        const row = Math.floor(i / 2), col = i % 2;
        const s = T.L - 5 - row * 5;
        const p = T.sampleAt(s);
        const lat = (col ? -1 : 1) * T.hw * 0.4;
        return Object.assign(e, {
          x: p.x + p.nx * lat, y: p.y + p.ny * lat, z: p.z, heading: p.ang, v: 0,
          idx: -1, lat, s, lap: -1, prevS: s, steer: 0, lean: 0, pedal: this.rnd() * 6,
          finished: false, finishTime: 0, place: i + 1, manualSprint: 0, drafting: false,
          input: { throttle: false, brake: false, steer: 0, sprint: false },
          lane: (this.rnd() - 0.5) * 0.8, laneT: 0, surface: p.surface, onRoad: true,
          wrongWay: 0, skid: 0, lastLapStart: 0, bestLap: 0,
        });
      });
      this.riders.forEach((r) => {
        const l = T.locate(r.x, r.y, null);
        r.idx = l.idx;
        if (!r.profile) r.profile = GS.riderProfile(null);
        if (r.skill == null) r.skill = r.profile.skill;
        r.energy = r.profile.energyMax;
      });
      this.player = this.riders.find((r) => r.isPlayer) || this.riders[0];
      this.focus = this.player;
    }

    progress(r) { return r.lap * this.track.L + r.s; }
    fraction(r) { return clamp(this.progress(r) / (this.laps * this.track.L), 0, 1); }

    // Ручной спурт игрока: велосипед едет сам, но рывок можно скомандовать.
    sprintNow() {
      const p = this.player;
      if (this.state !== 'racing' || p.finished || p.energy < p.profile.energyMax * 0.08) return false;
      p.manualSprint = 4;
      return true;
    }

    update(dt) {
      this.dt = dt;
      if (this.state === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0) { this.state = 'racing'; this.countdown = 0; }
      } else {
        this.time += dt;
      }
      const sub = Math.ceil(dt / (1 / 120));
      const h = dt / sub;
      for (let k = 0; k < sub; k++) {
        for (const r of this.riders) {
          this.ai(r, h);
          this.step(r, h);
        }
        this.collide();
      }
      this.updatePlaces();
      this.updateParticles(dt);
      this.firstFrame = false;
      // После финиша лидера у остальных есть ограниченное время.
      if (this.state === 'racing' && this.finishOrder.length && !this.player.finished) {
        this.cutoff = FINISH_CUTOFF - (this.time - this.finishOrder[0].finishTime);
        if (this.cutoff <= 0) { this.state = 'finishing'; this.finishTimer = 1.5; }
      }
      if (this.state === 'racing' && this.player.finished) {
        this.state = 'finishing';
        this.finishTimer = 2.5;
      }
      if (this.state === 'finishing') {
        this.finishTimer -= dt;
        if (this.finishTimer <= 0) { this.state = 'done'; this.computeResults(); }
      }
    }

    // ИИ: следуем гоночной линии и тормозим перед поворотами.
    ai(r, dt) {
      const T = this.track;
      const inp = r.input;
      if (this.state === 'countdown') { inp.throttle = false; inp.brake = false; inp.steer = 0; return; }
      const st = r.stats;
      // Выбор полосы: внутренний радиус поворота + объезд соперников.
      const ahead = T.sampleAt(r.s + 18);
      let lane = r.lane * T.hw;
      if (ahead.curvMax > 0.015) lane = ahead.turn * T.hw * 0.45 * Math.min(1, ahead.curvMax * 25) + lane * 0.3;
      // Соперник впереди: либо садимся ему «на колесо», либо обгоняем.
      const wantsDraft = !r.sprinting && r.tactic !== 'attack' && r.energy < r.profile.energyMax * 0.95;
      let tooClose = false;
      for (const o of this.riders) {
        if (o === r) continue;
        const ds = ((o.s - r.s + T.L * 1.5) % T.L) - T.L / 2;
        if (ds > 0 && ds < 9 && Math.abs(o.lat - r.lat) < 1.6) {
          if (wantsDraft && o.v > r.v * 0.85 && ahead.curvMax < 0.015) {
            lane = o.lat;
            if (ds < 2.6) tooClose = true;
          } else lane = o.lat + (o.lat > 0 ? -2.2 : 2.2);
        }
      }
      lane = clamp(lane, -T.hw + 1, T.hw - 1);
      r.laneT += (lane - r.laneT) * 0.02;
      const look = 6 + r.v * 0.5;
      const tp = T.sampleAt(r.s + look);
      const tx = tp.x + tp.nx * r.laneT, ty = tp.y + tp.ny * r.laneT;
      const diff = wrapAngle(Math.atan2(ty - r.y, tx - r.x) - r.heading);
      inp.steer = clamp(-diff * 3.2, -1, 1);
      // Скорость: проверяем повороты на тормозном пути вперёд.
      const grip = P.surfaceGrip(st, r.wheel, r.surface);
      const brake = P.brake(st) * Math.min(1, grip + 0.2) * 0.75;
      const horizon = r.v * r.v / (2 * brake) + 12;
      let mustBrake = false, coast = false;
      for (let d = 0; d < horizon; d += 4) {
        const p = T.sampleAt(r.s + d);
        if (p.curvMax < 0.004) continue;
        const g = P.surfaceGrip(st, r.wheel, p.surface);
        const vc = Math.sqrt(P.latGrip(st) * g / p.curvMax) * r.profile.corner;
        if (r.v > vc) {
          const need = (r.v * r.v - vc * vc) / (2 * brake);
          if (need >= d - 2) { mustBrake = true; break; }
          if (need >= d - 8) coast = true;
        }
      }
      inp.brake = mustBrake;
      inp.throttle = !mustBrake && !coast && !(tooClose && r.v > 6);
      inp.sprint = inp.throttle && this.wantsSprint(r);
      if (r.manualSprint > 0) {
        r.manualSprint -= dt;
        if (!mustBrake) { inp.throttle = true; inp.sprint = true; }
      }
    }

    // Когда спуртовать — зависит от выбранной тактики и опыта гонщика.
    wantsSprint(r) {
      const T = this.track;
      const e = r.energy / r.profile.energyMax;
      const frac = this.fraction(r);
      const straight = T.sampleAt(r.s + 40).curvMax < 0.01 && r.surface === T.sampleAt(r.s + 40).surface;
      if (frac > 0.93 && e > 0.03) return true; // финишный спринт для всех
      const keep = r.sprinting ? 0.1 : null;
      if (r.tactic === 'attack') {
        if (frac < 0.4) return e > (keep || 0.15);
        return straight && e > (keep || 0.6);
      }
      if (r.tactic === 'final') {
        const start = 0.7 - r.profile.tactics * 0.01;
        if (frac > start) return e > (keep ? 0.03 : 0.06);
        return straight && e > 0.97;
      }
      return straight && e > (keep || 0.55);
    }

    step(r, dt) {
      const T = this.track;
      const st = r.stats;
      const loc = T.locate(r.x, r.y, r.idx);
      r.idx = loc.idx; r.lat = loc.lat;
      const p = T.samples[loc.idx];
      // Учёт кругов при пересечении линии старта.
      const prev = r.s;
      r.s = loc.s;
      if (prev > T.L * 0.75 && r.s < T.L * 0.25) this.crossLine(r, 1);
      else if (prev < T.L * 0.25 && r.s > T.L * 0.75) this.crossLine(r, -1);

      const onRoad = Math.abs(loc.lat) <= T.hw + 0.3;
      r.onRoad = onRoad;
      r.surface = onRoad ? p.surface : this.def.offSurface;
      r.z += (p.z - r.z) * Math.min(1, dt * 12);
      const locked = this.state === 'countdown';
      const inp = r.input;

      const grip = P.surfaceGrip(st, r.wheel, r.surface) * (onRoad ? 1 : 0.9);
      const surfK = P.surfaceSpeed(st, r.wheel, r.surface) * (onRoad ? 1 : 0.72);
      const slopeDir = p.slope * Math.cos(r.heading - p.ang);
      r.sprinting = !!(inp.sprint && r.energy > 1 && inp.throttle && !locked);
      let vmax = P.topSpeed(st) * surfK * P.slopeSpeed(st, slopeDir) * (r.skill || 1);
      if (r.sprinting) vmax *= r.profile.sprintBoost;
      // «Сидение на колесе»: соперник прямо впереди снижает сопротивление воздуха.
      r.drafting = false;
      if (onRoad && r.v > 6) {
        for (const o of this.riders) {
          if (o === r) continue;
          const ds = ((o.s - r.s + T.L * 1.5) % T.L) - T.L / 2;
          if (ds > 1.2 && ds < 8 && Math.abs(o.lat - r.lat) < 1.3) { r.drafting = true; break; }
        }
      }
      if (r.drafting) vmax *= 1 + r.profile.draft * (r.surface === 'asphalt' ? 1 : 0.5);
      if (r.energy < r.profile.energyMax * 0.08) vmax *= 0.96; // усталость
      r.vmax = vmax;

      if (!locked) {
        if (inp.throttle && r.v < vmax) {
          const acc = P.accel(st) * Math.sqrt(surfK) * (r.sprinting ? 1.25 + r.profile.sprintBoost - 1.08 : 1);
          r.v += acc * (1 - r.v / vmax) * dt * 1.6;
        } else if (!inp.throttle) {
          r.v -= (0.35 + D.SURFACES[r.surface].rough * 2.2) * dt + 4.5 * slopeDir * dt;
        }
        if (r.v > vmax && inp.throttle) r.v -= (r.v - vmax) * 1.4 * dt;
        if (!inp.throttle && r.v > vmax * 1.3) r.v -= (r.v - vmax * 1.3) * 1.2 * dt;
        if (inp.brake) r.v -= P.brake(st) * Math.min(1, grip + 0.2) * dt;
        r.v = Math.max(0, r.v);
      }
      // Энергия для спурта.
      const pr = r.profile;
      if (r.sprinting) r.energy = Math.max(0, r.energy - 20 * dt);
      else r.energy = Math.min(pr.energyMax, r.energy + pr.regen * (inp.throttle ? 1 : 1.8) * (r.drafting ? 1.4 : 1) * dt);

      // Руление с ограничением по сцеплению.
      r.steer += (inp.steer - r.steer) * Math.min(1, dt * 9);
      let omega = r.steer * P.turnRate(st) * Math.min(1, r.v / 3.5);
      const omegaMax = P.latGrip(st) * grip / Math.max(r.v, 1);
      r.skid = 0;
      if (Math.abs(omega) > omegaMax) {
        const excess = Math.abs(omega) / omegaMax;
        omega = Math.sign(omega) * omegaMax;
        if (excess > 1.25) {
          r.v *= 1 - Math.min(0.9, (excess - 1.25) * 0.35) * dt;
          r.skid = Math.min(1, (excess - 1.25) * 0.5);
        }
      }
      r.heading = wrapAngle(r.heading - omega * dt);
      r.lean += (clamp(omega * r.v / 14, -1, 1) - r.lean) * Math.min(1, dt * 6);
      r.x += Math.cos(r.heading) * r.v * dt;
      r.y += Math.sin(r.heading) * r.v * dt;
      r.pedal += (inp.throttle && !locked ? r.v * 0.55 + 2 : 0) * dt;

      // Слишком далеко от трассы — мягко возвращаем.
      if (Math.abs(loc.lat) > T.hw + 28) {
        r.x -= p.nx * Math.sign(loc.lat) * 6 * dt;
        r.y -= p.ny * Math.sign(loc.lat) * 6 * dt;
      }
      // Неверное направление.
      const dirDot = Math.cos(r.heading - p.ang);
      r.wrongWay = dirDot < -0.3 && r.v > 2 ? r.wrongWay + dt : 0;

      // Пыль и снег из-под колёс.
      const s = D.SURFACES[r.surface];
      const dustCol = s.dust || (r.skid > 0.3 ? 'rgba(220,220,220,1)' : null);
      if (dustCol && r.v > 5 && this.particles.length < 450 && this.rnd() < (r.v / 30 + r.skid) * dt * 30) {
        this.particles.push({
          x: r.x - Math.cos(r.heading) * 0.8, y: r.y - Math.sin(r.heading) * 0.8, z: r.z + 0.1,
          vx: (this.rnd() - 0.5) * 2, vy: (this.rnd() - 0.5) * 2, vz: 0.8 + this.rnd(),
          life: 0.8, max: 0.8, r: 0.12 + this.rnd() * 0.18, c: dustCol, alpha: 0.4, grow: 0.7,
        });
      }
    }

    crossLine(r, dir) {
      r.lap += dir;
      if (dir > 0 && r.lap >= 1) {
        const lapTime = this.time - r.lastLapStart;
        if (!r.bestLap || lapTime < r.bestLap) r.bestLap = lapTime;
      }
      if (dir > 0) r.lastLapStart = this.time;
      if (dir > 0 && r.lap >= this.laps && !r.finished) {
        r.finished = true;
        r.finishTime = this.time;
        this.finishOrder.push(r);
      }
    }

    collide() {
      const rs = this.riders;
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i], b = rs[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          const min = 1.3;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2), push = (min - d) / 2;
            const nx = dx / d, ny = dy / d;
            a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
            // Лёгкий обмен скоростью и небольшая потеря при касании.
            const avg = (a.v + b.v) / 2;
            a.v += (avg - a.v) * 0.04 - a.v * 0.002;
            b.v += (avg - b.v) * 0.04 - b.v * 0.002;
          }
        }
      }
    }

    updatePlaces() {
      const sorted = this.riders.slice().sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return this.progress(b) - this.progress(a);
      });
      sorted.forEach((r, i) => { r.place = i + 1; });
      this.order = sorted;
    }

    updateParticles(dt) {
      for (const p of this.particles) {
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vz -= 1.5 * dt;
        if (p.z < 0) p.z = 0;
        p.r += p.grow * dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
    }

    // Итоги: недоехавшим соперникам оцениваем время по средней скорости.
    computeResults() {
      const total = this.laps * this.track.L;
      const res = this.riders.map((r) => {
        let t = r.finishTime;
        if (!r.finished) {
          const done = Math.max(1, this.progress(r) + this.track.L - (this.track.L - 5));
          const avg = Math.max(4, done / Math.max(1, this.time));
          t = this.time + Math.max(0.5, (total - this.progress(r)) / avg);
        }
        return { rider: r, time: t };
      }).sort((a, b) => a.time - b.time);
      this.results = res;
    }
  }

  window.RaceEngine = { Race, wrapAngle };
})();
