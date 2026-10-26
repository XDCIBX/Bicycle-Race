// Построение геометрии трассы: сплайн, выборка по длине, покрытия, декорации.
(function () {
  'use strict';
  const D = window.GameData;
  const SPACING = 2; // расстояние между сэмплами центральной линии

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Центростремительный сплайн Катмулла–Рома (без петель на неравномерных точках).
  function catmullRom(p0, p1, p2, p3, t) {
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-4, 0.5);
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const tt = t1 + (t2 - t1) * t;
    const lerp = (a, b, ta, tb) => {
      const k = (tt - ta) / (tb - ta);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    };
    const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
    const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
    return lerp(B1, B2, t1, t2);
  }

  function surfaceAt(def, frac) {
    for (const [a, b, s] of def.surfaces) if (frac >= a && frac < b) return s;
    return def.surfaces[def.surfaces.length - 1][2];
  }

  function build(def) {
    const pts = def.points;
    const n = pts.length;
    // 1. Плотная выборка сплайна.
    const dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let k = 0; k < 40; k++) dense.push(catmullRom(p0, p1, p2, p3, k / 40));
    }
    dense.push(dense[0]);
    // 2. Равномерная перевыборка по длине дуги.
    let total = 0;
    const cum = [0];
    for (let i = 1; i < dense.length; i++) {
      total += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
      cum.push(total);
    }
    const count = Math.round(total / SPACING);
    const step = total / count;
    const samples = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = i * step;
      while (cum[j + 1] < s) j++;
      const k = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      const a = dense[j], b = dense[j + 1];
      samples.push({ x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, z: a[2] + (b[2] - a[2]) * k, s });
    }
    const L = total;
    const N = samples.length;
    const hw = def.width / 2;
    // 3. Направления, нормали, наклон, кривизна, покрытие.
    for (let i = 0; i < N; i++) {
      const a = samples[(i - 1 + N) % N], b = samples[(i + 1) % N], p = samples[i];
      p.ang = Math.atan2(b.y - a.y, b.x - a.x);
      p.nx = -Math.sin(p.ang); p.ny = Math.cos(p.ang); // нормаль влево
      p.slope = (b.z - a.z) / (2 * step);
      p.surface = surfaceAt(def, p.s / L);
    }
    for (let i = 0; i < N; i++) {
      const k = 4;
      const a = samples[(i - k + N) % N], b = samples[(i + k) % N];
      let d = b.ang - a.ang;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      samples[i].curv = Math.abs(d) / (2 * k * step);
      samples[i].turn = Math.sign(d);
    }
    // Сглаженная кривизна (максимум по окрестности) — для ИИ и оценок.
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let k = -3; k <= 3; k++) m = Math.max(m, samples[(i + k + N) % N].curv);
      samples[i].curvMax = m;
    }

    // 4. Пространственная сетка для поиска ближайшей точки.
    const CELL = 24;
    const grid = new Map();
    const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
    samples.forEach((p, i) => {
      const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    function nearestIndex(x, y) {
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      let best = -1, bd = Infinity;
      for (let r = 1; r <= 6 && best < 0; r++) {
        for (let gx = cx - r; gx <= cx + r; gx++) for (let gy = cy - r; gy <= cy + r; gy++) {
          const arr = grid.get(key(gx, gy));
          if (!arr) continue;
          for (const i of arr) {
            const d = (samples[i].x - x) ** 2 + (samples[i].y - y) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (best < 0) { // далеко от трассы — полный перебор
        samples.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
      }
      return { idx: best, dist: Math.sqrt(bd) };
    }
    // Быстрое отслеживание: поиск в окне вокруг предыдущего индекса.
    function locate(x, y, hint) {
      let idx;
      if (hint == null || hint < 0) idx = nearestIndex(x, y).idx;
      else {
        let bd = Infinity;
        idx = hint;
        for (let k = -12; k <= 12; k++) {
          const i = (hint + k + N) % N;
          const d = (samples[i].x - x) ** 2 + (samples[i].y - y) ** 2;
          if (d < bd) { bd = d; idx = i; }
        }
        // Если ушли далеко (срезали через газон) — глобальный поиск.
        if (bd > 30 * 30) idx = nearestIndex(x, y).idx;
      }
      const p = samples[idx];
      const lat = (x - p.x) * p.nx + (y - p.y) * p.ny;
      const lon = (x - p.x) * Math.cos(p.ang) + (y - p.y) * Math.sin(p.ang);
      return { idx, lat, s: (p.s + lon + L) % L };
    }

    // 5. Декорации и мелкие детали (детерминированно для каждой трассы).
    const env = D.ENVIRONMENTS[def.env];
    const rnd = mulberry32(hashStr(def.id));
    const objects = [];
    const decals = [];
    const clearOf = (x, y, margin) => nearestIndex(x, y).dist > hw + margin;

    // Пятна и травинки на земле.
    const decalCount = Math.round(L * 3);
    for (let i = 0; i < decalCount; i++) {
      const p = samples[Math.floor(rnd() * N)];
      const side = rnd() < 0.5 ? -1 : 1;
      const off = hw + 0.5 + Math.pow(rnd(), 1.4) * 70;
      const x = p.x + p.nx * off * side + (rnd() - 0.5) * 6;
      const y = p.y + p.ny * off * side + (rnd() - 0.5) * 6;
      if (!clearOf(x, y, 0.3)) continue;
      decals.push({ x, y, z: p.z, r: 0.12 + rnd() * rnd() * 0.9, c: env.decal[Math.floor(rnd() * env.decal.length)], k: rnd() });
    }

    // Крупные объекты по обе стороны.
    const stepObj = 7 / env.density;
    for (let s = 0; s < L; s += stepObj * (0.6 + rnd() * 0.8)) {
      const p = samples[Math.floor(s / step) % N];
      for (const side of [-1, 1]) {
        if (rnd() < 0.35) continue;
        const type = env.scenery[Math.floor(rnd() * env.scenery.length)];
        const big = type === 'building' || type === 'house' || type === 'dune';
        const off = hw + (big ? 12 : 4) + Math.pow(rnd(), 1.2) * (big ? 30 : 55);
        const x = p.x + p.nx * off * side, y = p.y + p.ny * off * side;
        const margin = big ? 11 : 3;
        if (!clearOf(x, y, margin)) continue;
        const o = { type, x, y, z: p.z, ang: p.ang, seed: rnd(), r: 1 };
        if (type === 'building') { o.w = 9 + rnd() * 8; o.d = 9 + rnd() * 8; o.h = 6 + rnd() * 10; o.r = 8; }
        if (type === 'house') { o.w = 7 + rnd() * 3; o.d = 6 + rnd() * 3; o.h = 4 + rnd() * 1.5; o.r = 6; }
        if (type === 'dune') { o.w = 9 + rnd() * 9; o.r = 8; }
        objects.push(o);
      }
    }
    // Фонари вдоль городских улиц.
    if (def.env === 'city' || def.env === 'coast') {
      for (let s = 0; s < L; s += 28) {
        const p = samples[Math.floor(s / step) % N];
        const side = (Math.floor(s / 28) % 2) ? 1 : -1;
        objects.push({ type: 'lamp', x: p.x + p.nx * (hw + 1.5) * side, y: p.y + p.ny * (hw + 1.5) * side, z: p.z, seed: rnd() });
      }
    }
    // Зрители у старта и стартовая арка.
    for (let i = -14; i <= 14; i++) {
      const p = samples[(i * 2 + N) % N];
      for (const side of [-1, 1]) {
        for (let row = 0; row < 2; row++) {
          if (rnd() < 0.25) continue;
          const off = hw + 2 + row * 1.6 + rnd() * 0.6;
          objects.push({ type: 'fan', x: p.x + p.nx * off * side + (rnd() - 0.5), y: p.y + p.ny * off * side + (rnd() - 0.5), z: p.z, seed: rnd(), c: D.BOT_COLORS[Math.floor(rnd() * D.BOT_COLORS.length)] });
        }
      }
    }
    objects.push({ type: 'gantry', x: samples[0].x, y: samples[0].y, z: samples[0].z, idx: 0 });

    // Крапинки на полотне (гравий, грунт, песок…).
    samples.forEach((p) => {
      p.specks = [];
      const cnt = { asphalt: 1, cobble: 0, gravel: 5, dirt: 4, sand: 4, snow: 3 }[p.surface] || 0;
      for (let k = 0; k < cnt; k++) {
        const lat = (rnd() * 2 - 1) * hw * 0.95;
        const lon = (rnd() - 0.5) * step;
        p.specks.push({ lat, lon, r: 0.1 + rnd() * 0.18, l: rnd() });
      }
      p.edgeNoise = rnd();
    });

    // Границы для миникарты.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    samples.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });

    let climb = 0;
    for (let i = 0; i < N; i++) climb += Math.max(0, samples[(i + 1) % N].z - samples[i].z);

    return {
      def, env, samples, N, L, step, hw, objects, decals, locate, nearestIndex,
      bounds: { minX, minY, maxX, maxY }, climb,
      sampleAt(s) { return samples[Math.floor((((s % L) + L) % L) / step) % N]; },
    };
  }

  // Оценка времени круга для данной комбинации велосипеда (используется в меню и для ИИ).
  function estimateLap(track, stats, wheelId) {
    const P = window.GameState.Physics;
    const N = track.N;
    const vmax = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = track.samples[i];
      const grip = P.surfaceGrip(stats, wheelId, p.surface);
      let v = P.topSpeed(stats) * P.surfaceSpeed(stats, wheelId, p.surface) * P.slopeSpeed(stats, p.slope);
      if (p.curvMax > 0.002) v = Math.min(v, Math.sqrt(P.latGrip(stats) * grip / p.curvMax));
      vmax[i] = v;
    }
    // Учёт ограничений разгона/торможения (два прохода).
    const v = Float32Array.from(vmax);
    const a = P.accel(stats) * 0.55, b = P.brake(stats) * 0.7;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < N * 2; i++) {
        const c = i % N, pr = (i - 1) % N;
        v[c] = Math.min(v[c], Math.sqrt(v[pr] * v[pr] + 2 * a * track.step));
      }
      for (let i = N * 2; i > 0; i--) {
        const c = i % N, nx = (i + 1) % N;
        v[c] = Math.min(v[c], Math.sqrt(v[nx] * v[nx] + 2 * b * track.step));
      }
    }
    let t = 0;
    for (let i = 0; i < N; i++) t += track.step / Math.max(1, v[i]);
    return t;
  }

  const cache = {};
  window.Tracks = {
    get(id) { if (!cache[id]) cache[id] = build(D.trackById(id)); return cache[id]; },
    estimateLap,
    mulberry32,
    hashStr,
  };
})();
