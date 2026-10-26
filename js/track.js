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
    // Открытая трасса (даунхилл: старт наверху, финиш внизу) не замыкается в кольцо.
    const open = !!def.open;
    const dense = [];
    const ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
    const P = (i) => (open ? (i < 0 ? ext(pts[0], pts[1]) : i >= n ? ext(pts[n - 1], pts[n - 2]) : pts[i]) : pts[(i + n) % n]);
    for (let i = 0; i < (open ? n - 1 : n); i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < 40; k++) dense.push(catmullRom(p0, p1, p2, p3, k / 40));
    }
    dense.push(open ? pts[n - 1].slice() : dense[0]);
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
    if (open) samples.push({ x: dense[dense.length - 1][0], y: dense[dense.length - 1][1], z: dense[dense.length - 1][2], s: total });
    const L = total;
    const N = samples.length;
    const hw = def.width / 2;
    // Индекс соседнего сэмпла: на кольце — по кругу, на открытой трассе — с упором в края.
    const W = open ? (i) => (i < 0 ? 0 : i >= N ? N - 1 : i) : (i) => ((i % N) + N) % N;
    const S = (s) => samples[W(Math.floor((open ? Math.max(0, Math.min(L - 1e-6, s)) : (((s % L) + L) % L)) / step))];
    // Финиш открытой трассы — за 25 единиц до конца сплайна (дальше — зона торможения).
    const finishS = open ? L - 25 : 0;
    const finishIdx = W(Math.floor(finishS / step));
    samples.forEach((p, i) => { p.idx = i; });
    // Элементы даунхилла: лестницы, уступы (дропы) и трамплины.
    for (const f of def.features || []) {
      if (f.type === 'stairs') {
        const a = f.a * L, b = f.b * L;
        samples.forEach((p) => {
          p.z -= f.h * Math.max(0, Math.min(1, (p.s - a) / (b - a)));
          if (p.s >= a && p.s < b) p.stairs = true;
        });
      } else if (f.type === 'drop') {
        const a = f.at * L;
        samples.forEach((p) => { if (p.s >= a) p.z -= f.h; });
        S(a).drop = f.h;
        S(a - step).dropLip = true;
      } else if (f.type === 'kicker') {
        S(f.at * L).kicker = true;
      }
    }
    // 3. Направления, нормали, наклон, кривизна, покрытие.
    for (let i = 0; i < N; i++) {
      const a = samples[W(i - 1)], b = samples[W(i + 1)], p = samples[i];
      p.ang = Math.atan2(b.y - a.y, b.x - a.x);
      p.nx = -Math.sin(p.ang); p.ny = Math.cos(p.ang); // нормаль влево
      p.slope = (b.z - a.z) / ((b.s - a.s + L) % L || 2 * step);
      p.surface = surfaceAt(def, p.s / L);
    }
    for (let i = 0; i < N; i++) {
      const k = 4;
      const a = samples[W(i - k)], b = samples[W(i + k)];
      let d = b.ang - a.ang;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      samples[i].curv = Math.abs(d) / (2 * k * step);
      samples[i].turn = Math.sign(d);
    }
    // Сглаженная кривизна (максимум по окрестности) — для ИИ и оценок.
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let k = -3; k <= 3; k++) m = Math.max(m, samples[W(i + k)].curv);
      samples[i].curvMax = m;
    }
    // Средний уклон без учёта дропов (по нему гравитация разгоняет на спуске).
    let dropSum = 0;
    const zg = samples.map((p) => { if (p.drop) dropSum += p.drop; return p.z + dropSum; });
    for (let i = 0; i < N; i++) {
      const a = W(i - 5), b = W(i + 5);
      samples[i].grade = (zg[b] - zg[a]) / ((samples[b].s - samples[a].s + L) % L || step);
    }
    // Рельеф: склон поднимается с одной стороны дороги и уходит вниз с другой.
    const relief = (D.ENVIRONMENTS[def.env].relief || 0) * 7;
    const rs = (hashStr(def.id) % 1000) / 160;
    samples.forEach((p) => {
      const b = relief ? Math.sin(p.s * 0.009 + rs) * 0.75 + Math.sin(p.s * 0.023 + rs * 2) * 0.35 : 0;
      p.bankL = relief * b; p.bankR = -relief * b * 0.8;
    });
    const BANK0 = hw + 2.4, BANKW = 12;
    // Высота склона над полотном на расстоянии lat от оси (lat > 0 — слева).
    const bankZ = (p, lat) => {
      const d = Math.abs(lat) - BANK0;
      if (d <= 0 || !relief) return 0;
      const t = Math.min(1, d / BANKW);
      return (lat > 0 ? p.bankL : p.bankR) * t * t * (3 - 2 * t);
    };

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
          const i = W(hint + k);
          const d = (samples[i].x - x) ** 2 + (samples[i].y - y) ** 2;
          if (d < bd) { bd = d; idx = i; }
        }
        // Если ушли далеко (срезали через газон) — глобальный поиск.
        if (bd > 30 * 30) idx = nearestIndex(x, y).idx;
      }
      const p = samples[idx];
      const lat = (x - p.x) * p.nx + (y - p.y) * p.ny;
      const lon = (x - p.x) * Math.cos(p.ang) + (y - p.y) * Math.sin(p.ang);
      return { idx, lat, s: open ? Math.max(0, Math.min(L, p.s + lon)) : (p.s + lon + L) % L };
    }

    // 5. Декорации и мелкие детали (детерминированно для каждой трассы).
    const env = D.ENVIRONMENTS[def.env];
    const rnd = mulberry32(hashStr(def.id));
    const objects = [];
    const decals = [];
    const clearOf = (x, y, margin) => nearestIndex(x, y).dist > hw + margin;

    // Озёра и море: сначала ставим водоёмы, чтобы декорации их обходили.
    const lakes = [];
    let shore = null;
    const inLake = (x, y, pad) => lakes.some((l) => {
      const dx = x - l.x, dy = y - l.y;
      const c = Math.cos(-l.rot), sn = Math.sin(-l.rot);
      const u = (dx * c - dy * sn) / (l.rx + (pad || 0)), v = (dx * sn + dy * c) / (l.ry + (pad || 0));
      return u * u + v * v < 1;
    });
    const makeLake = (x, y, rx, ry, rot, kind) => {
      const pts = [];
      for (let k = 0; k < 28; k++) {
        const a = k / 28 * Math.PI * 2;
        const wob = 1 + (rnd() - 0.5) * 0.18;
        const lx = Math.cos(a) * rx * wob, ly = Math.sin(a) * ry * wob;
        pts.push([x + lx * Math.cos(rot) - ly * Math.sin(rot), y + lx * Math.sin(rot) + ly * Math.cos(rot)]);
      }
      return { x, y, rx, ry, rot, pts, kind, z: samples[nearestIndex(x, y).idx].z - 0.3 };
    };
    const lakeOk = (l) => l.pts.every(([x, y]) => clearOf(x, y, 4)) && clearOf(l.x, l.y, Math.min(l.rx, l.ry));
    if (env.sea) {
      // Море вдоль одной стороны трассы.
      const b0 = samples.reduce((m, p) => (p.y < m.y ? p : m), samples[0]);
      for (let tries = 0; tries < 6; tries++) {
        const l = makeLake(b0.x, b0.y - 90 - tries * 20, 260, 70, 0, 'sea');
        if (lakeOk(l)) { lakes.push(l); break; }
      }
    }
    for (let k = 0, tries = 0; k < (env.lakes || 0) && tries < 60; tries++) {
      const p = samples[Math.floor(rnd() * N)];
      const side = rnd() < 0.5 ? -1 : 1;
      const rx = 12 + rnd() * 16, ry = rx * (0.5 + rnd() * 0.4);
      const off = hw + rx + 10 + rnd() * 40;
      const l = makeLake(p.x + p.nx * off * side, p.y + p.ny * off * side, rx, ry, rnd() * Math.PI, 'lake');
      if (lakeOk(l) && !inLake(l.x, l.y, Math.max(rx, ry) + 6)) { lakes.push(l); k++; }
    }

    // Пятна и травинки на земле.
    const decalCount = Math.round(L * 3);
    for (let i = 0; i < decalCount; i++) {
      const p = samples[Math.floor(rnd() * N)];
      const side = rnd() < 0.5 ? -1 : 1;
      const off = hw + 0.5 + Math.pow(rnd(), 1.4) * 70;
      const x = p.x + p.nx * off * side + (rnd() - 0.5) * 6;
      const y = p.y + p.ny * off * side + (rnd() - 0.5) * 6;
      if (!clearOf(x, y, 0.3) || inLake(x, y, 1)) continue;
      decals.push({ x, y, z: p.z + bankZ(p, off * side), r: 0.12 + rnd() * rnd() * 0.9, c: env.decal[Math.floor(rnd() * env.decal.length)], k: rnd() });
    }

    // Крупные объекты по обе стороны.
    const stepObj = 7 / (env.density || 1);
    for (let s = 0; s < L && env.scenery.length; s += stepObj * (0.6 + rnd() * 0.8)) {
      const p = samples[Math.floor(s / step) % N];
      for (const side of [-1, 1]) {
        if (rnd() < 0.35) continue;
        const type = env.scenery[Math.floor(rnd() * env.scenery.length)];
        const big = type === 'building' || type === 'house' || type === 'dune';
        const off = hw + (big ? 12 : 4) + Math.pow(rnd(), 1.2) * (big ? 30 : 55);
        const x = p.x + p.nx * off * side, y = p.y + p.ny * off * side;
        const margin = big ? 11 : 3;
        if (!clearOf(x, y, margin) || inLake(x, y, big ? 10 : 2)) continue;
        const o = { type, x, y, z: p.z + bankZ(p, off * side), ang: p.ang, seed: rnd(), r: 1 };
        if (type === 'mesa') { o.w = 6 + rnd() * 8; o.h = 6 + rnd() * 12; o.r = 6; }
        if (type === 'building') { o.w = 9 + rnd() * 8; o.d = 9 + rnd() * 8; o.h = 6 + rnd() * 10; o.r = 8; }
        if (type === 'house') { o.w = 7 + rnd() * 3; o.d = 6 + rnd() * 3; o.h = 4 + rnd() * 1.5; o.r = 6; }
        if (type === 'dune') { o.w = 9 + rnd() * 9; o.r = 8; }
        if (type === 'car') { o.c = ['#c0392b', '#2c3e50', '#ecf0f1', '#2980b9', '#f1c40f', '#7f8c8d'][Math.floor(rnd() * 6)]; }
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
    // Зрители у старта и стартовая арка (на воде зрителей нет).
    for (let i = -14; i <= 14 && !env.water && !open; i++) {
      const p = samples[(i * 2 + N) % N];
      for (const side of [-1, 1]) {
        for (let row = 0; row < 2; row++) {
          if (rnd() < 0.25) continue;
          const off = hw + 2 + row * 1.6 + rnd() * 0.6;
          objects.push({ type: 'fan', x: p.x + p.nx * off * side + (rnd() - 0.5), y: p.y + p.ny * off * side + (rnd() - 0.5), z: p.z, seed: rnd(), c: D.BOT_COLORS[Math.floor(rnd() * D.BOT_COLORS.length)] });
        }
      }
    }
    if (!open) objects.push({ type: 'gantry', x: samples[0].x, y: samples[0].y, z: samples[0].z, idx: 0 });

    const at = (s0, lat) => {
      const p = S(s0);
      return { p, x: p.x + p.nx * lat, y: p.y + p.ny * lat };
    };
    const segObj = (type, s0, lat, len, extra) => {
      const a = at(s0, lat), b = at(s0 + len, lat);
      objects.push(Object.assign({ type, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: a.p.z, x1: a.x, y1: a.y, x2: b.x, y2: b.y, z2: b.p.z }, extra));
    };
    // Даунхилл: стартовая будка наверху, финишная арка и трибуна внизу.
    // В городе — пёстрые дома вплотную к узким улицам, в горах — лента вдоль трассы и тюки в поворотах.
    function buildDhScenery() {
      const cols = ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#6a4c93', '#ffb703', '#118ab2', '#ef476f'];
      const fanAt = (s0, lat) => {
        const a = at(s0, lat);
        objects.push({ type: 'fan', x: a.x + (rnd() - 0.5) * 0.6, y: a.y + (rnd() - 0.5) * 0.6, z: a.p.z + bankZ(a.p, lat), seed: rnd(), c: D.BOT_COLORS[Math.floor(rnd() * D.BOT_COLORS.length)] });
      };
      const p0 = samples[0];
      objects.push({ type: 'starthut', x: p0.x - Math.cos(p0.ang) * 1.2, y: p0.y - Math.sin(p0.ang) * 1.2, z: p0.z, ang: p0.ang, w: 2 * hw + 1.2 });
      objects.push({ type: 'gantry', x: samples[finishIdx].x, y: samples[finishIdx].y, z: samples[finishIdx].z, idx: finishIdx, finish: true });
      // Трамплины — деревянные кикеры поперёк трассы.
      samples.forEach((p) => { if (p.kicker) objects.push({ type: 'kicker', x: p.x, y: p.y, z: p.z, ang: p.ang, w: hw * 1.4 }); });
      // Рекламные щиты у старта и ограждения в финишной зоне.
      const brands = ['VELO RUSH', 'GRAVITY', 'SEND IT', 'ENERGY', 'DOWNHILL', 'PRO TEAM'];
      for (let s0 = 6, k = 0; s0 < 44; s0 += 7, k++) {
        for (const side of [-1, 1]) segObj('banner', s0, side * (hw + 0.9), 6, { text: brands[(k + (side > 0 ? 3 : 0)) % brands.length], c: cols[(k * 3 + (side > 0 ? 1 : 0)) % cols.length] });
      }
      for (let s0 = finishS - 70; s0 < L - 2; s0 += 4) {
        for (const side of [-1, 1]) segObj('barrier', s0, side * (hw + 1.0), 3.8, {});
      }
      segObj('grandstand', finishS - 30, hw + 5.5, 24, { seed: rnd() });
      for (let k = 0; k < 3; k++) {
        const a = at(finishS - 50 + k * 14, -(hw + 8));
        objects.push({ type: 'tent', x: a.x, y: a.y, z: a.p.z + bankZ(a.p, -(hw + 8)), ang: a.p.ang, c: cols[k * 2 % cols.length], seed: rnd() });
      }
      // Зрители: плотная толпа у финиша и у трамплинов, дропов и лестниц.
      const hot = [];
      samples.forEach((p) => { if (p.kicker || p.drop || (p.stairs && !samples[W(p.idx - 1)].stairs)) hot.push(p.s); });
      const crowd = (a, b, dens) => {
        for (let s0 = Math.max(0, a); s0 < Math.min(L, b); s0 += 1.5) {
          for (const side of [-1, 1]) for (let row = 0; row < 2; row++) if (rnd() < dens) fanAt(s0, side * (hw + (env.urban ? 1.2 : 1.8) + row * 1.3));
        }
      };
      crowd(finishS - 68, L - 2, 0.75);
      hot.forEach((s0) => crowd(s0 - 16, s0 + 10, 0.6));
      if (env.urban) {
        // Узкие улочки: дома вплотную, тротуар, фонари; зрители стоят вдоль всей трассы.
        const pal = def.env === 'oldtown'
          ? ['#d9b48f', '#c99a6b', '#e3cfa7', '#b9876a', '#d8c3a0', '#a9825f']
          : ['#e63946', '#f4a261', '#2a9d8f', '#ffb703', '#118ab2', '#ef476f', '#8ecae6', '#90be6d', '#f9c74f', '#577590'];
        const roofed = def.env === 'oldtown';
        for (const side of [-1, 1]) {
          let prev = null;
          for (let s0 = 2; s0 < L - 4;) {
            const w = 4.5 + rnd() * 4, d = 6 + rnd() * 3;
            const lat = side * (hw + 2.3 + d / 2);
            const a = at(s0 + w / 2, lat), e0 = S(s0), e1 = S(s0 + w);
            const ok = clearOf(a.x, a.y, 2.0 + d / 2 - 0.4) && (!prev || Math.hypot(a.x - prev.x, a.y - prev.y) > (w + prev.w) * 0.42);
            if (ok && rnd() > 0.06) {
              const o = { type: roofed ? 'house' : 'building', x: a.x, y: a.y, z: Math.min(e0.z, e1.z) - 0.2, ang: a.p.ang, w, d, h: (roofed ? 4 : 3.5) + rnd() * 3.5, seed: rnd(), col: pal[Math.floor(rnd() * pal.length)], r: 4 };
              objects.push(o); prev = o;
            }
            s0 += w + 0.3 + (rnd() < 0.12 ? 5 + rnd() * 4 : 0);
          }
        }
        for (let s0 = 10; s0 < L - 10; s0 += 22) {
          const side = (Math.floor(s0 / 22) % 2) ? 1 : -1;
          const a = at(s0, side * (hw + 1.9));
          objects.push({ type: 'lamp', x: a.x, y: a.y, z: a.p.z, seed: rnd() });
        }
        crowd(44, finishS - 70, 0.16);
      } else {
        // Сигнальная лента на колышках по обе стороны трассы.
        for (let s0 = 3; s0 < finishS - 70; s0 += 5) {
          for (const side of [-1, 1]) segObj('tape', s0, side * (hw + 0.6), 5, { c: side > 0 ? '#ff5a1f' : '#f2f2f2' });
        }
      }
      // Тюки соломы на внешней стороне крутых поворотов.
      for (let i = 0; i < N; i += 2) {
        const p = samples[i];
        if (p.curvMax > 0.03 && p.s > 10 && p.s < finishS - 70) {
          const a = at(p.s, -p.turn * (hw + 1.2));
          objects.push({ type: 'haybale', x: a.x, y: a.y, z: p.z, seed: rnd() });
        }
      }
    }

    if (open) {
      buildDhScenery();
    } else if (env.water) {
      // Плавательная трасса: линии буйков и большие поворотные буи.
      for (let s0 = 0; s0 < L; s0 += 14) {
        for (const side of [-1, 1]) { const a = at(s0, side * (hw + 1)); objects.push({ type: 'buoy', x: a.x, y: a.y, z: 0, big: false, seed: rnd() }); }
      }
      for (let i = 0; i < N; i += 3) {
        const p = samples[i];
        if (p.curvMax > 0.02 && p.curv === p.curvMax) {
          const a = at(p.s, -p.turn * (hw + 3));
          objects.push({ type: 'buoy', x: a.x, y: a.y, z: 0, big: true, seed: rnd() });
        }
      }
      // Берег: пляж и газон вдоль одной стороны озера, с понтоном до воды.
      let mnX = Infinity, mxX = -Infinity, mnY = Infinity;
      samples.forEach((q) => { mnX = Math.min(mnX, q.x); mxX = Math.max(mxX, q.x); mnY = Math.min(mnY, q.y); });
      const edgeY = mnY - 14;
      const edge = [];
      for (let x = mnX - 280; x <= mxX + 280; x += 10) edge.push([x, edgeY + Math.sin(x * 0.045) * 3 + Math.sin(x * 0.13) * 1.2]);
      shore = { edge, depth: 360 };
      const edgeAt = (x) => edgeY + Math.sin(x * 0.045) * 3 + Math.sin(x * 0.13) * 1.2;
      const landTypes = ['palm', 'tree', 'umbrella', 'tree', 'bench', 'birch', 'flowers', 'umbrella'];
      for (let x = mnX - 240; x < mxX + 240; x += 6) {
        const y = edgeAt(x) - 12 - Math.pow(rnd(), 1.3) * 70;
        objects.push({ type: landTypes[Math.floor(rnd() * landTypes.length)], x, y, z: 0, ang: 0, seed: rnd() });
      }
      // Болельщики и шатры на пляже у старта.
      for (let x = -70; x < 70; x += 1.6) {
        for (let row = 0; row < 3; row++) {
          if (rnd() < 0.3) continue;
          objects.push({ type: 'fan', x: x + (rnd() - 0.5), y: edgeAt(x) - 3 - row * 1.5 - rnd() * 0.5, z: 0, seed: rnd(), c: D.BOT_COLORS[Math.floor(rnd() * D.BOT_COLORS.length)] });
        }
      }
      for (let k = 0; k < 4; k++) objects.push({ type: 'tent', x: -60 + k * 28, y: edgeAt(-60 + k * 28) - 14, z: 0, ang: 0, c: ['#e63946', '#118ab2', '#ffb703', '#2a9d8f'][k], seed: rnd() });
      const pon = at(-14, -14);
      objects.push({ type: 'pontoon', x: pon.x, y: pon.y, z: 0, ang: pon.p.ang, len: 32 });
      lakes.forEach((l) => { if (l.kind === 'sea') objects.push({ type: 'boat', x: l.x, y: l.y, z: 0, seed: rnd() }); });
    } else {
      // Ограждения и рекламные щиты у старта, шатры команд, трибуна.
      for (let s0 = -60; s0 < 40; s0 += 4) {
        for (const side of [-1, 1]) segObj('barrier', s0, side * (hw + 1.3), 3.8, {});
      }
      const brands = ['VELO RUSH', 'ENERGY', 'SPORT', 'CARBON', 'AERO', 'PRO TEAM', 'GO!', 'CHAIN'];
      const cols = ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#6a4c93', '#ffb703', '#118ab2', '#ef476f'];
      for (let s0 = 44, k = 0; s0 < 140; s0 += 9, k++) {
        for (const side of [-1, 1]) segObj('banner', s0, side * (hw + 1.0), 8, { text: brands[(k + (side > 0 ? 3 : 0)) % brands.length], c: cols[(k * 3 + (side > 0 ? 1 : 0)) % cols.length] });
      }
      for (let k = 0; k < 4; k++) {
        const a = at(-34 + k * 10, (k % 2 ? 1 : -1) * (hw + 9));
        objects.push({ type: 'tent', x: a.x, y: a.y, z: a.p.z, ang: a.p.ang, c: cols[k * 2 % cols.length], seed: rnd() });
      }
      segObj('grandstand', -22, hw + 5.5, 26, { seed: rnd() });
      // Километровые столбики.
      for (let s0 = 200, km = 1; s0 < L - 50; s0 += 200, km++) {
        const a = at(s0, -(hw + 1.8));
        objects.push({ type: 'kmsign', x: a.x, y: a.y, z: a.p.z, ang: a.p.ang, n: km });
      }
      // Отбойники/тюки на внешней стороне крутых поворотов.
      for (let i = 0; i < N; i += 2) {
        const p = samples[i];
        if (p.curvMax > 0.03 && def.env !== 'city' && def.env !== 'park') {
          if (def.env === 'mountain') { segObj('guardrail', p.s, -p.turn * (hw + 1.2), 4.2, {}); continue; }
          const a = at(p.s, -p.turn * (hw + 1.6));
          objects.push({ type: def.env === 'forest' || def.env === 'countryside' ? 'haybale' : 'tyres', x: a.x, y: a.y, z: p.z, seed: rnd() });
        }
      }
      // Городские тротуары, пешеходные переходы, припаркованные машины.
      if (def.env === 'city') {
        for (let i = 0; i < N; i += 60) samples[(i + 25) % N].crosswalk = true;
        for (let s0 = 160; s0 < L - 40; s0 += 18 + rnd() * 30) {
          if (samples[Math.floor(s0 / step) % N].curvMax > 0.012) continue;
          const side = rnd() < 0.5 ? -1 : 1;
          const a = at(s0, side * (hw + 5.2));
          objects.push({ type: 'car', x: a.x, y: a.y, z: a.p.z, ang: a.p.ang, c: ['#c0392b', '#2c3e50', '#ecf0f1', '#2980b9', '#f1c40f', '#7f8c8d'][Math.floor(rnd() * 6)], seed: rnd() });
        }
      }
      // Деревянные заборы вдоль полей.
      if (def.env === 'meadow' || def.env === 'countryside' || def.env === 'park') {
        for (let s0 = 120; s0 < L - 120;) {
          const run = 50 + rnd() * 110, side = rnd() < 0.5 ? -1 : 1;
          for (let t = 0; t < run; t += 5) {
            if (samples[Math.floor((s0 + t) / step) % N].curvMax > 0.02) continue;
            segObj('fence', s0 + t, side * (hw + 5.5), 5, { seed: rnd() });
          }
          s0 += run + 60 + rnd() * 120;
        }
      }
      // Линия электропередачи вдоль шоссе.
      if (def.env === 'meadow' || def.env === 'countryside' || def.env === 'desert') {
        const poles = [];
        for (let s0 = 30; s0 < L - 20; s0 += 42) { const a = at(s0, hw + 11); poles.push({ type: 'pole', x: a.x, y: a.y, z: a.p.z }); }
        poles.forEach((pl, i) => { const n = poles[(i + 1) % poles.length]; pl.nx2 = n.x; pl.ny2 = n.y; pl.nz2 = n.z; objects.push(pl); });
      }
      // Сугробы вдоль укатанной снежной трассы.
      if (def.env === 'snow') {
        for (let s0 = 0; s0 < L; s0 += 4.5) {
          for (const side of [-1, 1]) {
            if (rnd() < 0.3) continue;
            const a = at(s0, side * (hw + 1.6 + rnd() * 0.8));
            objects.push({ type: 'snowbank', x: a.x, y: a.y, z: a.p.z, seed: rnd(), ang: a.p.ang });
          }
        }
      }
      // Светофоры у пешеходных переходов.
      if (def.env === 'city') {
        samples.forEach((p) => {
          if (!p.crosswalk) return;
          for (const side of [-1, 1]) { const a = at(p.s - 1, side * (hw + 1.8)); objects.push({ type: 'trafficlight', x: a.x, y: a.y, z: p.z, seed: rnd(), ang: p.ang }); }
        });
      }
      lakes.forEach((l) => { if (rnd() < 0.6) objects.push({ type: 'boat', x: l.x + (rnd() - 0.5) * l.rx * 0.6, y: l.y + (rnd() - 0.5) * l.ry * 0.6, z: l.z, seed: rnd() }); });
    }

    // Крапинки на полотне (гравий, грунт, песок…).
    samples.forEach((p) => {
      p.specks = [];
      const cnt = { asphalt: 1, cobble: 0, gravel: 5, dirt: 4, sand: 4, snow: 3, path: 2, rock: 6 }[p.surface] || 0;
      for (let k = 0; k < cnt; k++) {
        const lat = (rnd() * 2 - 1) * hw * 0.95;
        const lon = (rnd() - 0.5) * step;
        p.specks.push({ lat, lon, r: (0.1 + rnd() * 0.18) * (p.surface === 'rock' ? 2.2 : 1), l: rnd() });
      }
      p.edgeNoise = rnd();
    });

    // Границы для миникарты.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    samples.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });

    const zCache = new Map();
    let climb = 0;
    for (let i = 0; i < N; i++) climb += Math.max(0, samples[W(i + 1)].z - samples[i].z);

    return {
      def, env, samples, N, L, step, hw, objects, decals, lakes, shore, locate, nearestIndex,
      // Высота земли в точке (по ближайшему участку трассы), с кэшем по клеткам.
      groundZ(x, y) {
        const cs = relief ? 4 : 12;
        const k = `${Math.round(x / cs)},${Math.round(y / cs)}`;
        let z = zCache.get(k);
        if (z === undefined) {
          const n = nearestIndex(x, y), p = samples[n.idx];
          z = p.z + (relief ? bankZ(p, (x - p.x) * p.nx + (y - p.y) * p.ny) : 0);
          zCache.set(k, z);
        }
        return z;
      },
      bounds: { minX, minY, maxX, maxY }, climb, finishS, finishIdx, bankZ, relief, BANK0, BANKW,
      descent: samples[0].z - samples[finishIdx].z,
      // Высота кикера под колесом: въезд по деревянной рампе длиной 3 единицы.
      rampAt(s) {
        if (!open) return 0;
        for (let k = 0; k <= 2; k++) {
          const q = S(s + k * step);
          if (q.kicker) return Math.max(0, Math.min(1, 1 - (q.s - s) / 3)) * 0.9;
        }
        return 0;
      },

      sampleAt: S, open,
      // Плавная точка на центральной линии: интерполяция между соседними сэмплами
      // (без неё движение по трассе идёт «ступеньками» по 2 единицы).
      pointAt(s) {
        const u = (open ? Math.max(0, Math.min(L - 1e-6, s)) : (((s % L) + L) % L)) / step;
        const i = W(Math.floor(u)), t = u - Math.floor(u);
        const a = samples[i], b = samples[W(i + 1)];
        let da = b.ang - a.ang;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        const ang = a.ang + da * t;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, ang, nx: -Math.sin(ang), ny: Math.cos(ang), surface: a.surface };
      },
    };
  }

  // Оценка времени круга для данной комбинации велосипеда (используется в меню и для ИИ).
  function estimateLap(track, stats, wheelId) {
    const P = window.GameState.Physics;
    const N = track.N;
    const dh = !!track.def.dh;
    const vmax = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = track.samples[i];
      const grip = P.surfaceGrip(stats, wheelId, p.surface);
      let v = dh ? P.dhVmax(stats, wheelId, p.surface, p.grade)
        : P.topSpeed(stats) * P.surfaceSpeed(stats, wheelId, p.surface) * P.slopeSpeed(stats, p.slope);
      if (p.curvMax > 0.002) v = Math.min(v, Math.sqrt(P.latGrip(stats) * grip / p.curvMax));
      vmax[i] = v;
    }
    // Учёт ограничений разгона/торможения (два прохода; открытая трасса — один проход со старта с места).
    const v = Float32Array.from(vmax);
    const b = P.brake(stats) * 0.7;
    if (dh) {
      v[0] = 0;
      for (let i = 1; i < N; i++) {
        const a = P.accel(stats) * 0.55 + Math.max(0, -track.samples[i].grade) * 14;
        v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * a * track.step));
      }
      for (let i = N - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * b * track.step));
      let t = 0;
      const end = Math.floor(track.finishS / track.step);
      for (let i = 0; i < end; i++) t += track.step / Math.max(1, v[i]);
      return t;
    }
    const a = P.accel(stats) * 0.55;
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
