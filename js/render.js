// 2.5D-рендер: камера с наклоном за спиной гонщика, перспективная проекция,
// дорога из полигонов, объекты-«билборды» с настоящей высотой.
(function () {
  'use strict';
  const D = window.GameData;
  const NEAR = 0.6;
  const VIEW = 170;

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
    return `rgb(${r},${g},${b})`;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 0, z: 0, a: 0, B: 18, H: 20, pitch: 0.8 };
      // Качество (доля от devicePixelRatio): снижается автоматически, если кадры не успевают.
      this.quality = 1;
      this.lowDetail = false;
      this.colorCache = {};
    }

    resize() {
      const dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 2) * this.quality);
      this.lowDetail = this.quality < 0.8;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.W = this.canvas.width; this.Hs = this.canvas.height;
      // В портретной ориентации (iPhone) приближаем камеру, чтобы гонщики не были мелкими.
      this.F = Math.min(this.Hs * 1.1, this.W * (this.Hs > this.W ? 1.45 : 0.95));
      this.cx = this.W / 2; this.cy = this.Hs * 0.64;
      this.dpr = dpr;
    }

    // Мировые координаты → координаты камеры [вправо, вверх, глубина].
    toCam(x, y, z) {
      const c = this.cam;
      const dx = x - c.x, dy = y - c.y;
      const f = dx * c.ca + dy * c.sa;
      const r = dx * c.sa - dy * c.ca;
      const u = f + c.B, v = (z - c.z) - c.H;
      return [r, u * c.sp + v * c.cp, u * c.cp - v * c.sp];
    }
    projCam(p) { return [this.cx + p[0] * this.F / p[2], this.cy - p[1] * this.F / p[2], this.F / p[2]]; }
    project(x, y, z) {
      const p = this.toCam(x, y, z);
      if (p[2] < NEAR) return null;
      return this.projCam(p);
    }

    // Полигон в мировых координатах → отсечение по ближней плоскости → заливка.
    poly(worldPts, fill) {
      const cp = worldPts.map((p) => this.toCam(p[0], p[1], p[2]));
      let pts = cp;
      if (cp.some((p) => p[2] < NEAR)) {
        pts = [];
        for (let i = 0; i < cp.length; i++) {
          const a = cp[i], b = cp[(i + 1) % cp.length];
          const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
          if (ain) pts.push(a);
          if (ain !== bin) {
            const t = (NEAR - a[2]) / (b[2] - a[2]);
            pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
          }
        }
        if (pts.length < 3) return;
      }
      const ctx = this.ctx;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const s = this.projCam(pts[i]);
        if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    setupCamera(race) {
      const c = this.cam;
      const t = race.focus;
      c.x = t.x; c.y = t.y;
      c.z += (t.z - c.z) * 0.08;
      // Первый кадр или большой скачок высоты (новая трасса, спуск с горы) — без «подлёта» камеры.
      if (race.firstFrame || Math.abs(t.z - c.z) > 25) { c.z = t.z; c.a = t.heading; }
      let d = t.heading - c.a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      c.a += d * Math.min(1, race.dt * 4.5);
      const sp = Math.min(1, t.v / 28);
      // Камера ближе к участнику: в триатлоне (пловцы и бегуны) — заметно ближе.
      const zoom = race.camZoom || 0.9;
      c.B = (13 + sp * 4) * zoom; c.H = (14.5 + sp * 3) * zoom;
      c.pitch = race.camPitch || 0.8;
      c.ca = Math.cos(c.a); c.sa = Math.sin(c.a);
      c.cp = Math.cos(c.pitch); c.sp = Math.sin(c.pitch);
      // Позиция камеры в мире (для отсечения граней зданий).
      c.wx = c.x - c.ca * c.B; c.wy = c.y - c.sa * c.B;
    }

    roadColor(surface, slope, alt) {
      const k = surface + '|' + Math.round(slope * 40) + '|' + alt;
      let col = this.colorCache[k];
      if (!col) {
        const base = D.SURFACES[surface].color;
        const f = 1 + Math.max(-0.25, Math.min(0.25, slope * 2.2)) + (alt ? 0.04 : 0);
        col = this.colorCache[k] = shade(base, f);
      }
      return col;
    }

    render(race) {
      const ctx = this.ctx;
      const track = race.track;
      this.setupCamera(race);
      const c = this.cam;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.now = performance.now() / 1000;
      if (track.env.water) {
        // Вода: вдали светлее (отражение неба), вблизи глубже и темнее.
        const wg = ctx.createLinearGradient(0, 0, 0, this.Hs);
        wg.addColorStop(0, '#7dbbdc'); wg.addColorStop(0.3, '#3d8fc2'); wg.addColorStop(1, '#17557f');
        ctx.fillStyle = wg;
      } else ctx.fillStyle = track.env.ground;
      ctx.fillRect(0, 0, this.W, this.Hs);

      this.drawBanks(track);
      this.drawGround(track);
      this.drawLakes(track);
      this.drawShore(track);
      this.drawDecals(track);
      this.drawRoad(track, race);
      if (race.groundDecor) race.groundDecor.forEach((g) => this.poly(g.pts, g.fill));
      this.drawParticles(race, true);

      // Объекты и гонщики, отсортированные от дальних к ближним.
      const list = [];
      const R2 = VIEW * VIEW;
      const objs = race.extraObjects && race.extraObjects.length ? track.objects.concat(race.extraObjects) : track.objects;
      for (const o of objs) {
        const dx = o.x - c.x, dy = o.y - c.y;
        if (dx * dx + dy * dy > R2) continue;
        const p = this.toCam(o.x, o.y, o.z);
        if (p[2] < NEAR + 1 && o.type !== 'gantry') continue;
        list.push({ d: p[2], o });
      }
      for (const r of race.riders) {
        const p = this.toCam(r.x, r.y, r.z);
        if (p[2] < NEAR) continue;
        list.push({ d: p[2], rider: r });
      }
      list.sort((a, b) => b.d - a.d);
      for (const it of list) {
        if (it.rider) this.drawRider(it.rider, race);
        else this.drawObject(it.o, track);
      }
      this.drawParticles(race, false);
      this.drawClouds(track);
      if (race.focus && race.focus.sprintHold > 0) this.drawSpeedLines();

      // Дымка вдали (воздушная перспектива).
      const hz = ctx.createLinearGradient(0, 0, 0, this.Hs * 0.35);
      hz.addColorStop(0, track.env.water ? 'rgba(210,235,255,0.35)' : 'rgba(215,228,240,0.32)');
      hz.addColorStop(1, 'rgba(215,228,240,0)');
      ctx.fillStyle = hz;
      ctx.fillRect(0, 0, this.W, this.Hs * 0.35);

      // Лёгкая виньетка.
      const g = ctx.createRadialGradient(this.cx, this.Hs * 0.55, this.Hs * 0.35, this.cx, this.Hs * 0.55, this.Hs * 0.95);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.Hs);
    }

    // Рельеф: склоны по сторонам трассы — с одной стороны гора, с другой обрыв в долину.
    // Полосы склона освещены «солнцем», поэтому форма местности читается сверху.
    drawBanks(track) {
      if (!track.relief) return;
      const c = this.cam, S = track.samples, N = track.N;
      const STEP = 3, R2 = (VIEW + 30) * (VIEW + 30);
      const B0 = track.BANK0, BW = track.BANKW;
      const lats = this.lowDetail ? [0, 0.5, 1, 2.2] : [0, 0.25, 0.5, 0.75, 1, 2.2];
      const list = [];
      for (let i = 0; i < N; i += STEP) {
        if (track.open && i + STEP >= N) break;
        const p = S[i];
        const dx = p.x - c.x, dy = p.y - c.y;
        if (dx * dx + dy * dy > R2) continue;
        const d = this.toCam(p.x, p.y, p.z)[2];
        if (d < -40) continue;
        list.push({ i, d });
      }
      list.sort((a, b) => b.d - a.d);
      const base = track.env.ground;
      const strata = track.def.env === 'canyon';
      for (const q of list) {
        const a = S[q.i], b = S[track.open ? q.i + STEP : (q.i + STEP) % N];
        for (const side of [1, -1]) {
          const hA = side > 0 ? a.bankL : a.bankR;
          for (let k = 0; k < lats.length - 1; k++) {
            const l0 = side * (B0 + lats[k] * BW), l1 = side * (B0 + lats[k + 1] * BW);
            const zA0 = a.z + track.bankZ(a, l0), zA1 = a.z + track.bankZ(a, l1);
            const zB0 = b.z + track.bankZ(b, l0), zB1 = b.z + track.bankZ(b, l1);
            // Нормаль склона в плоскости: противоположна направлению подъёма.
            const g = (zA1 - zA0) / (Math.abs(l1 - l0) || 1);
            const nx = -g * side * a.nx, ny = -g * side * a.ny;
            let f = 1 + (nx * 0.55 - ny * 0.65) * 0.9 - Math.abs(g) * 0.12;
            if (strata && Math.abs(hA) > 1) f *= 1 + ((k + (q.i >> 4)) % 2) * 0.06;
            f = Math.max(0.6, Math.min(1.35, f));
            const col = this.colorCache['b' + base + Math.round(f * 40)] || (this.colorCache['b' + base + Math.round(f * 40)] = shade(base, Math.round(f * 40) / 40));
            this.poly([
              [a.x + a.nx * l0, a.y + a.ny * l0, zA0], [a.x + a.nx * l1, a.y + a.ny * l1, zA1],
              [b.x + b.nx * l1, b.y + b.ny * l1, zB1], [b.x + b.nx * l0, b.y + b.ny * l0, zB0],
            ], col);
          }
        }
      }
    }

    // Неоднородная земля: мягкие пятна светлее/темнее основного цвета; на воде — блики волн.
    drawGround(track) {
      const c = this.cam, ctx = this.ctx;
      const water = track.env.water;
      if (this.lowDetail && !water) return;
      const CELL = water ? 6.5 : 11, R = water ? (this.lowDetail ? 70 : 95) : (this.lowDetail ? 90 : 125);
      const fx = c.x + c.ca * 40, fy = c.y + c.sa * 40;
      const x0 = Math.floor((fx - R) / CELL), x1 = Math.floor((fx + R) / CELL);
      const y0 = Math.floor((fy - R) / CELL), y1 = Math.floor((fy + R) / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          let h = Math.imul(gx * 374761393 + gy * 668265263, 1274126177) >>> 0;
          h = ((h ^ (h >>> 13)) >>> 0) / 4294967296;
          const cx = (gx + 0.5) * CELL + (h - 0.5) * 6, cy = (gy + 0.5) * CELL + ((h * 7) % 1 - 0.5) * 6;
          if ((cx - fx) ** 2 + (cy - fy) ** 2 > R * R) continue;
          if (water) {
            // Гребень волны (светлый) и впадина (тёмная) медленно бегут по ветру; редкие солнечные блики.
            const dist = Math.hypot(cx - fx, cy - fy) / R;
            const fade = Math.max(0, 1 - dist * dist);
            const ph = this.now * 1.4 + h * 30;
            const drift = Math.sin(ph) * 1.1;
            const len = 1.0 + h * 2.4;
            const x0 = cx + drift, y0 = cy + Math.cos(ph * 0.7) * 0.5;
            const a = this.project(x0 - len, y0, 0), m = this.project(x0, y0 - 0.35, 0), b = this.project(x0 + len, y0, 0);
            if (!a || !b || !m) continue;
            const t1 = this.project(x0 - len * 0.8, y0 + 0.45, 0), t2 = this.project(x0 + len * 0.8, y0 + 0.45, 0);
            if (t1 && t2) {
              ctx.strokeStyle = `rgba(8,40,72,${0.22 * fade})`; ctx.lineWidth = Math.max(1, 0.2 * a[2]);
              ctx.beginPath(); ctx.moveTo(t1[0], t1[1]); ctx.quadraticCurveTo(m[0], m[1] + 0.4 * a[2], t2[0], t2[1]); ctx.stroke();
            }
            ctx.strokeStyle = `rgba(235,248,255,${(0.12 + 0.2 * (0.5 + 0.5 * Math.sin(ph))) * fade})`;
            ctx.lineWidth = Math.max(1, 0.13 * a[2]);
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(m[0], m[1], b[0], b[1]); ctx.stroke();
            if (h > 0.8) {
              const gl = Math.pow(Math.max(0, Math.sin(this.now * 3.1 + h * 50)), 10) * fade;
              if (gl > 0.05) {
                const g = this.project(cx - drift, cy, 0);
                if (g) { ctx.fillStyle = `rgba(255,255,255,${gl})`; ctx.beginPath(); ctx.arc(g[0], g[1], Math.max(1, 0.14 * g[2]), 0, 7); ctx.fill(); }
              }
            }
            continue;
          }
          if (h < 0.3) continue;
          const z = track.groundZ(cx, cy);
          const r = 4 + h * 5;
          const pts = [];
          for (let k = 0; k < 7; k++) {
            const a = k / 7 * Math.PI * 2 + h * 3;
            const rr = r * (0.75 + ((h * (k + 3) * 13.7) % 1) * 0.5);
            pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z]);
          }
          this.poly(pts, h > 0.65 ? 'rgba(255,255,240,0.07)' : 'rgba(0,20,0,0.07)');
        }
      }
    }

    drawLakes(track) {
      const c = this.cam, ctx = this.ctx;
      for (const l of track.lakes || []) {
        const dx = l.x - c.x, dy = l.y - c.y, rr = Math.max(l.rx, l.ry) + VIEW;
        if (dx * dx + dy * dy > rr * rr) continue;
        const sc = (k) => l.pts.map(([x, y]) => [l.x + (x - l.x) * k, l.y + (y - l.y) * k, l.z]);
        const sand = track.def.env === 'coast' || l.kind === 'sea';
        this.poly(sc(1.14), sand ? '#e3d3a0' : 'rgba(110,95,60,0.55)');
        this.poly(sc(1.04), sand ? '#7cc6d6' : '#5aa0b8');
        this.poly(sc(0.97), '#2f7fb4');
        this.poly(sc(0.62), '#2a6fa3');
        // Пена у берега.
        const foam = l.pts.map(([x, y]) => this.project(l.x + (x - l.x) * 1.0, l.y + (y - l.y) * 1.0, l.z)).filter(Boolean);
        if (foam.length > 3) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, 0.2 * foam[0][2]);
          ctx.beginPath(); foam.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
        }
        // Блики.
        for (let k = 0; k < 6; k++) {
          const a = k * 1.7 + l.rx, t = this.now * 0.6 + k;
          const px = l.x + Math.cos(a) * l.rx * 0.5 + Math.sin(t) * 1.5, py = l.y + Math.sin(a) * l.ry * 0.5;
          const p1 = this.project(px - 2, py, l.z), p2 = this.project(px + 2, py, l.z);
          if (!p1 || !p2) continue;
          ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = Math.max(1, 0.2 * p1[2]);
          ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
        }
      }
    }

    // Берег у плавательной трассы: газон, пляж, мокрый песок, мелководье и линия прибоя.
    drawShore(track) {
      const sh = track.shore;
      if (!sh) return;
      const c = this.cam, ctx = this.ctx;
      const near = sh.edge.filter(([x, y]) => (x - c.x) ** 2 + (y - c.y) ** 2 < (VIEW + 40) ** 2);
      if (!near.length) return;
      const e = sh.edge;
      const off = (d) => e.map(([x, y]) => [x, y + d, 0]);
      const band = (d0, d1) => off(d0).concat(off(d1).reverse());
      const far = e[0][1] - sh.depth;
      this.poly(off(-14).concat([[e[e.length - 1][0], far, 0], [e[0][0], far, 0]]), '#6aa84f');
      this.poly(band(-14, -1.6), '#e8d6a6');
      this.poly(band(-1.6, 0), '#c9ad7a');
      this.poly(band(0, 4), 'rgba(120,200,215,0.45)');
      // Прибой: пенная линия набегает и откатывается.
      const wv = Math.sin(this.now * 1.3) * 0.7;
      const pts = near.map(([x, y]) => this.project(x, y + 0.6 + wv + Math.sin(this.now * 2 + x * 0.12) * 0.35, 0)).filter(Boolean);
      if (pts.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = Math.max(1.5, 0.3 * pts[0][2]); ctx.lineJoin = 'round';
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
      }
    }

    // Тени облаков медленно плывут по земле.
    drawClouds(track) {
      if (this.lowDetail) return;
      const b = track.bounds, c = this.cam;
      const w = b.maxX - b.minX + 400, h = b.maxY - b.minY + 400;
      for (let k = 0; k < 5; k++) {
        const bx = ((b.minX - 200 + ((k * 211 + this.now * 4) % w)) + w) % w + b.minX - 200;
        const by = ((b.minY - 200 + ((k * 337 + this.now * 1.5) % h)) + h) % h + b.minY - 200;
        if ((bx - c.x) ** 2 + (by - c.y) ** 2 > (VIEW + 60) ** 2) continue;
        const z = track.groundZ(bx, by);
        const pts = [];
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * Math.PI * 2;
          const r = 38 + 10 * Math.sin(a * 3 + k) + 6 * Math.cos(a * 5 + k * 2);
          pts.push([bx + Math.cos(a) * r, by + Math.sin(a) * r * 0.7, z]);
        }
        this.poly(pts, 'rgba(10,25,45,0.09)');
      }
    }

    // Штрихи скорости при спурте: расходятся от точки схода к краям экрана.
    drawSpeedLines() {
      const ctx = this.ctx;
      const vx = this.cx, vy = this.cy - this.Hs * 0.55;
      const maxR = Math.hypot(this.W, this.Hs);
      ctx.lineCap = 'round';
      for (let k = 0; k < 22; k++) {
        const ang = (k * 2.399) % (Math.PI * 2);
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const t = ((this.now * 2.2 + k * 0.137) % 1);
        const r0 = maxR * (0.42 + t * 0.4), r1 = r0 + maxR * 0.07;
        ctx.strokeStyle = `rgba(255,255,255,${0.28 * (1 - t)})`;
        ctx.lineWidth = (1.5 + (k % 3)) * this.dpr;
        ctx.beginPath(); ctx.moveTo(vx + dx * r0, vy + dy * r0); ctx.lineTo(vx + dx * r1, vy + dy * r1); ctx.stroke();
      }
    }

    // Призма (коробка) по центру, размерам и углу: видимые стены + крыша.
    prism(cx, cy, z, w, d, h, ang, col, opt) {
      const c = this.cam, o = opt || {};
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const cs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [cx + u * ca - v * sa, cy + u * sa + v * ca]);
      const z0 = z + (o.lift || 0), z1 = z0 + h;
      const faces = [];
      for (let i = 0; i < 4; i++) {
        const a = cs[i], b = cs[(i + 1) % 4];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if ((c.wx - mx) * (mx - cx) + (c.wy - my) * (my - cy) <= 0) continue;
        faces.push({ a, b, d: this.toCam(mx, my, z0)[2], i });
      }
      faces.sort((p, q) => q.d - p.d);
      faces.forEach((f) => this.poly([[f.a[0], f.a[1], z0], [f.b[0], f.b[1], z0], [f.b[0], f.b[1], z1], [f.a[0], f.a[1], z1]], shade(col, 0.68 + 0.12 * (f.i % 2))));
      this.poly(cs.map((k) => [k[0], k[1], z1]), o.top || shade(col, 1.08));
      return { cs, z0, z1, faces };
    }

    // Текст на вертикальной плоскости (рекламный щит, табличка).
    planeText(x1, y1, x2, y2, z, txt, size, color) {
      const a = this.project(x1, y1, z), b = this.project(x2, y2, z), u = this.project(x1, y1, z + 1);
      if (!a || !b || !u) return;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const U = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], V = [u[0] - a[0], u[1] - a[1]];
      if (U[0] * V[1] - U[1] * V[0] > 0) return; // обратная сторона — текста не видно
      const ctx = this.ctx;
      ctx.setTransform(U[0] / 100, U[1] / 100, -V[0] / 100, -V[1] / 100, a[0], a[1]);
      ctx.fillStyle = color;
      ctx.font = `900 ${Math.round(size * 100)}px 'Arial Black', Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, len * 50, -size * 60);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    drawDecals(track) {
      const ctx = this.ctx, c = this.cam;
      const grassy = ['meadow', 'countryside', 'mountain', 'forest', 'park'].includes(track.def.env);
      const R2 = 120 * 120;
      for (const d of track.decals) {
        const dx = d.x - c.x, dy = d.y - c.y;
        if (dx * dx + dy * dy > R2) continue;
        const p = this.project(d.x, d.y, d.z);
        if (!p) continue;
        const r = d.r * p[2];
        if (p[0] < -r || p[0] > this.W + r || p[1] < -r || p[1] > this.Hs + r) continue;
        if (grassy && d.k > 0.55 && p[2] > 6) {
          // Пучок травы: несколько травинок с наклоном.
          const t = this.project(d.x, d.y, d.z + 0.35 + d.r * 0.3);
          if (t) {
            ctx.strokeStyle = d.k > 0.8 ? '#3f7a2a' : '#5a9a3a'; ctx.lineWidth = Math.max(1, 0.06 * p[2]); ctx.lineCap = 'round';
            ctx.beginPath();
            for (let b = -2; b <= 2; b++) { ctx.moveTo(p[0] + b * 0.08 * p[2], p[1]); ctx.lineTo(t[0] + b * 0.18 * p[2] + Math.sin(this.now * 2 + d.k * 9) * 0.05 * p[2], t[1]); }
            ctx.stroke();
            continue;
          }
        }
        ctx.fillStyle = d.c;
        ctx.beginPath();
        ctx.ellipse(p[0], p[1], r, r * 0.62, d.k * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawRoad(track, race) {
      const c = this.cam;
      const S = track.samples, N = track.N, hw = track.hw;
      const STEP = 2;
      const quads = [];
      const R2 = VIEW * VIEW;
      for (let i = 0; i < N; i += STEP) {
        const p = S[i];
        const dx = p.x - c.x, dy = p.y - c.y;
        if (dx * dx + dy * dy > R2) continue;
        const cp = this.toCam(p.x, p.y, p.z);
        if (cp[2] < -12) continue;
        quads.push({ i, d: cp[2] });
      }
      quads.sort((a, b) => b.d - a.d);
      const env = track.def.env;
      if (track.env.water) {
        // Плавательная трасса: только лёгкая «дорожка» между буйками.
        for (const q of quads) {
          const a = S[q.i], b = S[(q.i + STEP) % N];
          this.poly([[a.x + a.nx * hw, a.y + a.ny * hw, 0], [a.x - a.nx * hw, a.y - a.ny * hw, 0], [b.x - b.nx * hw, b.y - b.ny * hw, 0], [b.x + b.nx * hw, b.y + b.ny * hw, 0]], 'rgba(255,255,255,0.045)');
        }
        return;
      }
      const centerLine = env === 'meadow' || env === 'mountain' || env === 'coast';
      for (const q of quads) {
        if (track.open && q.i + STEP >= N) continue;
        this.drawRoadQuad(track, q.i, (q.i + STEP) % N, q.d, centerLine);
      }
    }

    drawRoadQuad(track, i0, i1, depth, centerLine) {
      const S = track.samples, hw = track.hw;
      const a = S[i0], b = S[i1];
      const strip = (l0, l1, fill, ext) => {
        const e = ext || 0;
        const ax = a.x - Math.cos(a.ang) * e, ay = a.y - Math.sin(a.ang) * e;
        const bx = b.x + Math.cos(b.ang) * e, by = b.y + Math.sin(b.ang) * e;
        this.poly([
          [ax + a.nx * l0, ay + a.ny * l0, a.z], [ax + a.nx * l1, ay + a.ny * l1, a.z],
          [bx + b.nx * l1, by + b.ny * l1, b.z], [bx + b.nx * l0, by + b.ny * l0, b.z],
        ], fill);
      };
      const surf = a.surface;
      const alt = (i0 >> 1) % 2 === 0;
      const env = track.def.env;
      // Тротуар с бордюром в городе, мягкая обочина за городом.
      if (track.env.urban) {
        strip(hw + 0.9, hw + 2.4, alt ? '#a8a197' : '#a29b91', 0.1);
        strip(-hw - 2.4, -hw - 0.9, alt ? '#a8a197' : '#a29b91', 0.1);
        strip(hw + 0.9, hw + 1.2, '#d3cdc3'); strip(-hw - 1.2, -hw - 0.9, '#d3cdc3');
      } else if (env === 'city') {
        strip(hw + 0.9, hw + 4.2, alt ? '#a29c93' : '#9c968d', 0.1);
        strip(-hw - 4.2, -hw - 0.9, alt ? '#a29c93' : '#9c968d', 0.1);
        strip(hw + 0.9, hw + 1.25, '#cfc9bf'); strip(-hw - 1.25, -hw - 0.9, '#cfc9bf');
      } else {
        strip(-hw - 2.4, -hw - 0.8, 'rgba(80,62,35,0.16)', 0.1);
        strip(hw + 0.8, hw + 2.4, 'rgba(80,62,35,0.16)', 0.1);
      }
      // Обочина/кромка.
      const edgeCol = surf === 'asphalt' || surf === 'cobble' ? 'rgba(40,36,30,0.55)' : 'rgba(60,45,25,0.35)';
      strip(-hw - 0.9, hw + 0.9, edgeCol, 0.15);
      strip(-hw, hw, this.roadColor(surf, a.slope, surf === 'cobble' ? alt : false), 0.12);
      // Заплатки и трещины на асфальте.
      if (surf === 'asphalt' && depth < 110) {
        const h = (i0 * 2654435761 >>> 0) % 97;
        if (h < 9) { const l = -hw + 1 + (h / 9) * (2 * hw - 4); strip(l, l + 1.6 + (h % 3), 'rgba(20,22,26,0.28)'); }
        if (h > 90) strip(-hw * 0.3, -hw * 0.3 + 0.06, 'rgba(15,15,15,0.4)');
      }
      // Лестница: ступени поперёк трассы с тенью от каждой кромки.
      if (a.stairs) {
        const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
        for (let o = 0; o < 2; o += 0.5) {
          const e0 = o, e1 = o + 0.14;
          this.poly([[a.x + a.nx * hw + ca * e0, a.y + a.ny * hw + sa * e0, a.z], [a.x - a.nx * hw + ca * e0, a.y - a.ny * hw + sa * e0, a.z],
            [a.x - a.nx * hw + ca * e1, a.y - a.ny * hw + sa * e1, a.z], [a.x + a.nx * hw + ca * e1, a.y + a.ny * hw + sa * e1, a.z]], 'rgba(30,26,22,0.45)');
        }
        strip(hw - 0.35, hw, '#5d5a55'); strip(-hw, -hw + 0.35, '#5d5a55');
      }
      // Уступ (дроп): тёмная кромка и тень под ней.
      if (a.dropLip) strip(-hw, hw, 'rgba(25,18,10,0.55)');
      // Деревянный настил: доски поперёк.
      if (surf === 'wood' && depth < 100) {
        for (let o = 0; o < 2; o += 0.5) {
          const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
          this.poly([[a.x + a.nx * hw + ca * o, a.y + a.ny * hw + sa * o, a.z], [a.x - a.nx * hw + ca * o, a.y - a.ny * hw + sa * o, a.z],
            [a.x - a.nx * hw + ca * (o + 0.06), a.y - a.ny * hw + sa * (o + 0.06), a.z], [a.x + a.nx * hw + ca * (o + 0.06), a.y + a.ny * hw + sa * (o + 0.06), a.z]], 'rgba(60,35,15,0.45)');
        }
      }
      // Пешеходный переход.
      if (a.crosswalk) {
        for (let l = -hw + 0.4; l < hw - 0.4; l += 1.3) {
          const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
          this.poly([[a.x + a.nx * l, a.y + a.ny * l, a.z], [a.x + a.nx * (l + 0.7), a.y + a.ny * (l + 0.7), a.z],
            [a.x + a.nx * (l + 0.7) + ca * 3.2, a.y + a.ny * (l + 0.7) + sa * 3.2, a.z], [a.x + a.nx * l + ca * 3.2, a.y + a.ny * l + sa * 3.2, a.z]], 'rgba(245,245,245,0.9)');
        }
      }

      // Бордюры в крутых поворотах.
      if ((surf === 'asphalt' || surf === 'cobble') && a.curvMax > 0.025) {
        const col = (i0 >> 1) % 2 ? '#d93a32' : '#f1f1f1';
        strip(hw - 0.2, hw + 0.9, col);
        strip(-hw - 0.9, -hw + 0.2, col);
      }
      if (surf === 'asphalt') {
        strip(hw - 0.75, hw - 0.45, 'rgba(240,240,240,0.85)');
        strip(-hw + 0.45, -hw + 0.75, 'rgba(240,240,240,0.85)');
        if (centerLine && (i0 >> 1) % 3 !== 0) strip(-0.14, 0.14, 'rgba(250,215,80,0.9)');
      } else if (surf === 'cobble') {
        if (depth < 90) {
          const m = 0.5;
          this.poly([
            [a.x + a.nx * hw, a.y + a.ny * hw, a.z], [a.x - a.nx * hw, a.y - a.ny * hw, a.z],
            [a.x - a.nx * hw + Math.cos(a.ang) * 0.12, a.y - a.ny * hw + Math.sin(a.ang) * 0.12, a.z],
            [a.x + a.nx * hw + Math.cos(a.ang) * 0.12, a.y + a.ny * hw + Math.sin(a.ang) * 0.12, a.z],
          ], 'rgba(40,32,26,0.45)');
          for (let l = -hw + m; l < hw; l += 1.4) strip(l, l + 0.08, 'rgba(40,32,26,0.25)');
        }
      } else if (surf === 'path') {
        strip(-hw, -hw + 0.25, 'rgba(0,0,0,0.18)'); strip(hw - 0.25, hw, 'rgba(0,0,0,0.18)');
        if ((i0 >> 1) % 4 < 2) strip(-0.08, 0.08, 'rgba(255,255,255,0.7)');
      } else {
        // Колеи на мягком покрытии.
        const rut = surf === 'snow' ? 'rgba(150,175,200,0.3)' : surf === 'rock' ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.1)';
        strip(-1.9, -1.4, rut); strip(1.4, 1.9, rut);
        if (hw > 5) { strip(-hw * 0.65 - 0.25, -hw * 0.65 + 0.25, rut); strip(hw * 0.65 - 0.25, hw * 0.65 + 0.25, rut); }
      }
      // Крапинки.
      if (depth < 80) {
        const ctx = this.ctx;
        const dark = surf === 'snow' ? '#b8c8d8' : surf === 'asphalt' ? '#5c6068' : shade(D.SURFACES[surf].color, 0.72);
        const light = surf === 'snow' ? '#ffffff' : shade(D.SURFACES[surf].color, 1.25);
        for (const p of [a, S[(i0 + 1) % track.N]]) {
          for (const sp of p.specks) {
            const x = p.x + p.nx * sp.lat + Math.cos(p.ang) * sp.lon;
            const y = p.y + p.ny * sp.lat + Math.sin(p.ang) * sp.lon;
            const pr = this.project(x, y, p.z);
            if (!pr) continue;
            const r = Math.max(1, sp.r * pr[2]);
            ctx.fillStyle = sp.l > 0.5 ? light : dark;
            ctx.fillRect(pr[0] - r / 2, pr[1] - r / 3, r, r * 0.66);
          }
        }
      }
      // Стартовая клетка (на даунхилле — ещё и финишная линия внизу).
      if (i0 === 0 || (track.open && i0 === (track.finishIdx & ~1))) {
        const cells = 10, cw = (2 * hw) / cells;
        for (let row = 0; row < 2; row++) {
          for (let k = 0; k < cells; k++) {
            const l0 = -hw + k * cw, l1 = l0 + cw;
            const o0 = row * 0.9, o1 = o0 + 0.9;
            const col = (k + row) % 2 ? '#111' : '#f4f4f4';
            const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
            this.poly([
              [a.x + a.nx * l0 + ca * o0, a.y + a.ny * l0 + sa * o0, a.z],
              [a.x + a.nx * l1 + ca * o0, a.y + a.ny * l1 + sa * o0, a.z],
              [a.x + a.nx * l1 + ca * o1, a.y + a.ny * l1 + sa * o1, a.z],
              [a.x + a.nx * l0 + ca * o1, a.y + a.ny * l0 + sa * o1, a.z],
            ], col);
          }
        }
      }
    }

    drawParticles(race, ground) {
      const ctx = this.ctx;
      for (const p of race.particles) {
        if (!!p.ground !== ground) continue;
        const pr = this.project(p.x, p.y, p.z);
        if (!pr) continue;
        ctx.globalAlpha = Math.max(0, p.life / p.max) * p.alpha;
        if (p.ring) {
          ctx.strokeStyle = p.c; ctx.lineWidth = Math.max(1, 0.08 * pr[2]);
          ctx.beginPath(); ctx.ellipse(pr[0], pr[1], Math.max(0.5, p.r * pr[2]), Math.max(0.5, p.r * pr[2] * 0.7), 0, 0, Math.PI * 2); ctx.stroke();
          continue;
        }
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(pr[0], pr[1], Math.max(0.5, p.r * pr[2]), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    shadow(x, y, z, rx, ry) {
      const p = this.project(x + 0.5, y - 0.4, z);
      if (!p) return;
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(p[0], p[1], rx * p[2], ry * p[2], 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawObject(o, track) {
      const ctx = this.ctx;
      const base = this.project(o.x, o.y, o.z);
      if (!base) return;
      const s = base[2];
      if (base[0] < -30 * s || base[0] > this.W + 30 * s) return;
      switch (o.type) {
        case 'tree': {
          this.shadow(o.x, o.y, o.z, 2.6, 1.6);
          const h = 4 + o.seed * 3;
          const top = this.project(o.x, o.y, o.z + h);
          if (!top) return;
          ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = Math.max(1, 0.45 * s); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          const r = (2.2 + o.seed * 1.4) * top[2];
          const autumn = o.seed > 0.86;
          if (r > 14 && !this.lowDetail) {
            const g = ctx.createRadialGradient(top[0] - r * 0.4, top[1] - r * 0.45, r * 0.1, top[0], top[1], r * 1.1);
            g.addColorStop(0, autumn ? '#ffd166' : '#7cc95a'); g.addColorStop(0.55, autumn ? '#e07a2f' : '#3f8a35'); g.addColorStop(1, autumn ? '#9a4b1c' : '#24561f');
            ctx.fillStyle = g;
          } else ctx.fillStyle = autumn ? '#d0702a' : '#3f8a35';
          ctx.beginPath();
          for (let k = 0; k < 7; k++) {
            const a = k / 7 * Math.PI * 2 + o.seed * 4;
            ctx.moveTo(top[0] + Math.cos(a) * r * 0.45 + r * 0.55, top[1] + Math.sin(a) * r * 0.45);
            ctx.arc(top[0] + Math.cos(a) * r * 0.45, top[1] + Math.sin(a) * r * 0.45, r * 0.55, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(top[0] - r * 0.35, top[1] - r * 0.4, r * 0.3, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'pine':
        case 'snowpine': {
          this.shadow(o.x, o.y, o.z, 2, 1.3);
          const h = 6 + o.seed * 5;
          const snow = o.type === 'snowpine';
          const tiers = 3;
          for (let k = 0; k < tiers; k++) {
            const z0 = o.z + 1 + k * h * 0.26, z1 = z0 + h * 0.42;
            const b0 = this.project(o.x, o.y, z0), t0 = this.project(o.x, o.y, z1);
            if (!b0 || !t0) continue;
            const r = (2.4 - k * 0.6) * (1 + o.seed * 0.3) * b0[2];
            ctx.fillStyle = snow ? (k % 2 ? '#e9f3fb' : '#2d5546') : (k % 2 ? '#2f6e45' : '#245a38');
            ctx.beginPath(); ctx.moveTo(b0[0] - r, b0[1]); ctx.lineTo(t0[0], t0[1]); ctx.lineTo(b0[0] + r, b0[1]);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = snow ? '#ffffff' : 'rgba(255,255,255,0.08)';
            ctx.beginPath(); ctx.moveTo(b0[0] - r * 0.2, b0[1]); ctx.lineTo(t0[0], t0[1]); ctx.lineTo(b0[0] - r, b0[1]);
            ctx.closePath(); ctx.fill();
          }
          break;
        }
        case 'bush': {
          this.shadow(o.x, o.y, o.z, 1.5, 0.9);
          const top = this.project(o.x, o.y, o.z + 0.9);
          if (!top) return;
          const r = (1 + o.seed) * top[2];
          ctx.fillStyle = '#3d7a2e'; ctx.beginPath(); ctx.ellipse(top[0], top[1], r * 1.3, r, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#4f9a3b'; ctx.beginPath(); ctx.ellipse(top[0] - r * 0.3, top[1] - r * 0.3, r * 0.7, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
          if (o.seed > 0.6) { ctx.fillStyle = '#e74c6f'; ctx.beginPath(); ctx.arc(top[0] + r * 0.4, top[1] - r * 0.1, r * 0.16, 0, 7); ctx.fill(); }
          break;
        }
        case 'rock': {
          const top = this.project(o.x, o.y, o.z + 0.8 + o.seed);
          if (!top) return;
          const r = (1 + o.seed * 1.6) * s;
          const col = track.def.env === 'desert' ? '#a5784c' : track.def.env === 'snow' ? '#8c97a3' : '#82807a';
          ctx.fillStyle = shade(col, 0.75);
          ctx.beginPath(); ctx.ellipse(base[0], base[1], r * 1.2, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.ellipse((base[0] + top[0]) / 2, (base[1] + top[1]) / 2, r, r * 0.65, o.seed, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = track.def.env === 'snow' ? '#f4f8fc' : shade(col, 1.2);
          ctx.beginPath(); ctx.ellipse(top[0] - r * 0.2, top[1], r * 0.55, r * 0.3, o.seed, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'cactus': {
          this.shadow(o.x, o.y, o.z, 1, 0.6);
          const h = 3 + o.seed * 2.5;
          const top = this.project(o.x, o.y, o.z + h);
          if (!top) return;
          ctx.strokeStyle = '#3f7d3a'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2, 0.7 * s);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          const m1 = this.project(o.x, o.y, o.z + h * 0.45), a1 = this.project(o.x + 0.9, o.y + 0.9, o.z + h * 0.75);
          const m2 = this.project(o.x, o.y, o.z + h * 0.6), a2 = this.project(o.x - 0.8, o.y - 0.8, o.z + h * 0.85);
          ctx.lineWidth = Math.max(1.5, 0.5 * s);
          if (m1 && a1) { ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.quadraticCurveTo(a1[0], m1[1], a1[0], a1[1]); ctx.stroke(); }
          if (m2 && a2 && o.seed > 0.3) { ctx.beginPath(); ctx.moveTo(m2[0], m2[1]); ctx.quadraticCurveTo(a2[0], m2[1], a2[0], a2[1]); ctx.stroke(); }
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(1, 0.15 * s);
          ctx.beginPath(); ctx.moveTo(base[0] - 0.15 * s, base[1]); ctx.lineTo(top[0] - 0.15 * s, top[1]); ctx.stroke();
          break;
        }
        case 'palm': {
          this.shadow(o.x + 1, o.y, o.z, 2.5, 1.5);
          const h = 6 + o.seed * 3;
          const top = this.project(o.x + 0.8, o.y, o.z + h);
          const mid = this.project(o.x + 0.1, o.y, o.z + h * 0.5);
          if (!top || !mid) return;
          ctx.strokeStyle = '#8a6a43'; ctx.lineWidth = Math.max(1.5, 0.45 * s); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.quadraticCurveTo(mid[0], mid[1], top[0], top[1]); ctx.stroke();
          ctx.fillStyle = '#2f8a3a';
          const r = 3 * top[2];
          for (let k = 0; k < 6; k++) {
            const a = k / 6 * Math.PI * 2 + o.seed * 3;
            ctx.beginPath();
            ctx.ellipse(top[0] + Math.cos(a) * r * 0.55, top[1] + Math.sin(a) * r * 0.3, r * 0.6, r * 0.16, a, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#5b3d1e'; ctx.beginPath(); ctx.arc(top[0], top[1], r * 0.12, 0, 7); ctx.fill();
          break;
        }
        case 'umbrella': {
          this.shadow(o.x, o.y, o.z, 1.8, 1.2);
          const top = this.project(o.x, o.y, o.z + 2.4);
          if (!top) return;
          ctx.strokeStyle = '#eee'; ctx.lineWidth = Math.max(1, 0.12 * s);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          const r = 1.6 * top[2];
          const cols = ['#e74c3c', '#f1f1f1'];
          for (let k = 0; k < 8; k++) {
            ctx.fillStyle = cols[k % 2];
            ctx.beginPath(); ctx.moveTo(top[0], top[1]);
            ctx.ellipse(top[0], top[1], r, r * 0.6, 0, k / 8 * Math.PI * 2, (k + 1) / 8 * Math.PI * 2);
            ctx.closePath(); ctx.fill();
          }
          break;
        }
        case 'haybale': {
          this.shadow(o.x, o.y, o.z, 1.4, 0.9);
          const top = this.project(o.x, o.y, o.z + 1.2);
          if (!top) return;
          const r = 1.1 * top[2];
          ctx.fillStyle = '#c99a3d'; ctx.beginPath(); ctx.ellipse(base[0], (base[1] + top[1]) / 2, r, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#e2b955'; ctx.beginPath(); ctx.ellipse(top[0], top[1], r * 0.9, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#b5852c'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(top[0], top[1], r * 0.5, r * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'dune': {
          const top = this.project(o.x, o.y, o.z + 2.5);
          if (!top) return;
          const r = o.w * 0.5 * s;
          ctx.fillStyle = '#d2b06e';
          ctx.beginPath(); ctx.ellipse(base[0], base[1], r, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#e9cf92';
          ctx.beginPath(); ctx.ellipse(top[0] - r * 0.15, top[1], r * 0.7, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'lamp': {
          const top = this.project(o.x, o.y, o.z + 5);
          if (!top) return;
          ctx.strokeStyle = '#2d3036'; ctx.lineWidth = Math.max(1, 0.18 * s);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(top[0], top[1], Math.max(2, 0.35 * top[2]), 0, 7); ctx.fill();
          break;
        }
        case 'fan': {
          const top = this.project(o.x, o.y, o.z + 1.5 + o.seed * 0.25);
          if (!top) return;
          const bob = Math.sin(performance.now() / 160 + o.seed * 20) * 0.12 * top[2];
          ctx.fillStyle = o.c;
          ctx.beginPath(); ctx.ellipse(top[0], top[1] + 0.3 * top[2], 0.24 * top[2], 0.34 * top[2], 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#f0c8a0';
          ctx.beginPath(); ctx.arc(top[0], top[1] - 0.12 * top[2] + bob, 0.15 * top[2], 0, 7); ctx.fill();
          if (o.seed > 0.55) {
            ctx.strokeStyle = o.c; ctx.lineWidth = Math.max(1, 0.1 * top[2]);
            ctx.beginPath(); ctx.moveTo(top[0] + 0.25 * top[2], top[1] + 0.2 * top[2]);
            ctx.lineTo(top[0] + 0.45 * top[2], top[1] - 0.5 * top[2] + bob * 2); ctx.stroke();
          }
          break;
        }
        case 'birch': {
          this.shadow(o.x, o.y, o.z, 2.2, 1.4);
          const h = 6 + o.seed * 3;
          const top = this.project(o.x, o.y, o.z + h);
          if (!top) return;
          ctx.strokeStyle = '#efeee8'; ctx.lineWidth = Math.max(1, 0.32 * s); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(1, 0.12 * s);
          for (let k = 1; k < 5; k++) {
            const m = [base[0] + (top[0] - base[0]) * k / 5.5, base[1] + (top[1] - base[1]) * k / 5.5];
            ctx.beginPath(); ctx.moveTo(m[0] - 0.12 * s, m[1]); ctx.lineTo(m[0] + 0.05 * s, m[1]); ctx.stroke();
          }
          const r = (1.7 + o.seed) * top[2];
          [['#5e9e3a', 0, 0, 1], ['#77b84a', -0.3, -0.3, 0.7], ['#a8cf5a', -0.45, -0.5, 0.35]].forEach(([col, ox, oy, k]) => {
            ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(top[0] + ox * r, top[1] + oy * r, r * k, r * k * 1.25, 0, 0, Math.PI * 2); ctx.fill();
          });
          break;
        }
        case 'flowers': {
          const cols = ['#ff5c8a', '#ffd400', '#ffffff', '#b46cff', '#ff8a00'];
          for (let k = 0; k < 9; k++) {
            const a = k * 2.4 + o.seed * 6, rr = 0.4 + (k % 3) * 0.45;
            const q = this.project(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr, o.z + 0.25);
            if (!q) continue;
            ctx.fillStyle = '#3f7d2e'; ctx.beginPath(); ctx.arc(q[0], q[1] + 0.12 * q[2], 0.18 * q[2], 0, 7); ctx.fill();
            ctx.fillStyle = cols[(k + Math.floor(o.seed * 5)) % cols.length];
            ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1, 0.13 * q[2]), 0, 7); ctx.fill();
          }
          break;
        }
        case 'bench': {
          this.prism(o.x, o.y, o.z + 0.45, 1.8, 0.5, 0.08, o.ang, '#8a5a2b');
          this.prism(o.x + Math.sin(o.ang) * 0.25, o.y - Math.cos(o.ang) * 0.25, o.z + 0.55, 1.8, 0.08, 0.45, o.ang, '#7a4e25');
          break;
        }
        case 'log': {
          const a = this.project(o.x - 1.6 * Math.cos(o.seed * 6), o.y - 1.6 * Math.sin(o.seed * 6), o.z + 0.3);
          const b = this.project(o.x + 1.6 * Math.cos(o.seed * 6), o.y + 1.6 * Math.sin(o.seed * 6), o.z + 0.3);
          if (!a || !b) return;
          ctx.strokeStyle = '#5b3d22'; ctx.lineWidth = 0.6 * a[2]; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
          ctx.strokeStyle = '#7a5532'; ctx.lineWidth = 0.18 * a[2];
          ctx.beginPath(); ctx.moveTo(a[0], a[1] - 0.15 * a[2]); ctx.lineTo(b[0], b[1] - 0.15 * b[2]); ctx.stroke();
          ctx.fillStyle = '#c9a074'; ctx.beginPath(); ctx.arc(b[0], b[1], 0.28 * b[2], 0, 7); ctx.fill();
          ctx.strokeStyle = '#8a6440'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(b[0], b[1], 0.14 * b[2], 0, 7); ctx.stroke();
          break;
        }
        case 'snowman': {
          this.shadow(o.x, o.y, o.z, 1, 0.7);
          [[0.5, 0.55], [1.25, 0.4], [1.85, 0.28]].forEach(([h, r]) => {
            const q = this.project(o.x, o.y, o.z + h);
            if (!q) return;
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(q[0], q[1], r * q[2], 0, 7); ctx.fill();
            ctx.fillStyle = 'rgba(150,170,195,0.35)'; ctx.beginPath(); ctx.arc(q[0] + r * 0.25 * q[2], q[1] + r * 0.2 * q[2], r * 0.75 * q[2], 0, 7); ctx.fill();
          });
          const hq = this.project(o.x, o.y, o.z + 2.2);
          if (hq) { ctx.fillStyle = '#1b1b1b'; ctx.fillRect(hq[0] - 0.22 * hq[2], hq[1] - 0.3 * hq[2], 0.44 * hq[2], 0.3 * hq[2]); ctx.fillStyle = '#ff7a00'; ctx.beginPath(); ctx.arc(hq[0], hq[1] + 0.3 * hq[2], 0.07 * hq[2], 0, 7); ctx.fill(); }
          break;
        }
        case 'barrier': {
          const ok = this.project(o.x1, o.y1, o.z);
          if (!ok) return;
          this.poly([[o.x1, o.y1, o.z + 0.15], [o.x2, o.y2, o.z2 + 0.15], [o.x2, o.y2, o.z2 + 1.1], [o.x1, o.y1, o.z + 1.1]], 'rgba(205,212,220,0.32)');
          const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => [o.x1 + (o.x2 - o.x1) * t, o.y1 + (o.y2 - o.y1) * t]);
          ctx.strokeStyle = '#b9c0c8'; ctx.lineWidth = Math.max(1, 0.06 * ok[2]);
          pts.forEach(([x, y]) => { const a = this.project(x, y, o.z), b = this.project(x, y, o.z + 1.1); if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } });
          const t1 = this.project(o.x1, o.y1, o.z + 1.1), t2 = this.project(o.x2, o.y2, o.z2 + 1.1);
          if (t1 && t2) { ctx.strokeStyle = '#e4e8ec'; ctx.lineWidth = Math.max(1.5, 0.1 * ok[2]); ctx.beginPath(); ctx.moveTo(t1[0], t1[1]); ctx.lineTo(t2[0], t2[1]); ctx.stroke(); }
          break;
        }
        case 'banner': {
          this.poly([[o.x1, o.y1, o.z], [o.x2, o.y2, o.z2], [o.x2, o.y2, o.z2 + 1.0], [o.x1, o.y1, o.z + 1.0]], o.c);
          this.poly([[o.x1, o.y1, o.z + 0.85], [o.x2, o.y2, o.z2 + 0.85], [o.x2, o.y2, o.z2 + 1.0], [o.x1, o.y1, o.z + 1.0]], 'rgba(255,255,255,0.25)');
          if (base[2] > 7) this.planeText(o.x1, o.y1, o.x2, o.y2, o.z, o.text, 0.62, '#ffffff');
          break;
        }
        case 'tent': {
          const legs = [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]].map(([u, v]) => [o.x + u * Math.cos(o.ang) - v * Math.sin(o.ang), o.y + u * Math.sin(o.ang) + v * Math.cos(o.ang)]);
          this.shadow(o.x, o.y, o.z, 3, 2.2);
          ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = Math.max(1, 0.1 * s);
          legs.forEach(([x, y]) => { const a = this.project(x, y, o.z), b = this.project(x, y, o.z + 2.1); if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } });
          const apex = [o.x, o.y, o.z + 3.1];
          const tris = legs.map((p, i) => { const q = legs[(i + 1) % 4]; return { pts: [[p[0], p[1], o.z + 2.1], [q[0], q[1], o.z + 2.1], apex], d: this.toCam((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, o.z + 2.1)[2], i }; });
          tris.sort((a, b) => b.d - a.d);
          tris.forEach((t) => this.poly(t.pts, t.i % 2 ? o.c : shade(o.c, 1.25)));
          legs.forEach((p, i) => { const q = legs[(i + 1) % 4]; this.poly([[p[0], p[1], o.z + 1.8], [q[0], q[1], o.z + 1.8], [q[0], q[1], o.z + 2.1], [p[0], p[1], o.z + 2.1]], '#ffffff'); });
          break;
        }
        case 'grandstand': {
          const dx = o.x2 - o.x1, dy = o.y2 - o.y1, L = Math.hypot(dx, dy);
          const nx = -dy / L, ny = dx / L; // наружу от трассы (трибуна стоит с положительной стороны нормали)
          const p0 = this.project(o.x, o.y, o.z);
          for (let row = 3; row >= 0; row--) {
            const off = row * 1.5, h = row * 0.9;
            const A = [o.x1 + nx * off, o.y1 + ny * off], B = [o.x2 + nx * off, o.y2 + ny * off];
            this.poly([[A[0], A[1], o.z + h], [B[0], B[1], o.z + h], [B[0], B[1], o.z + h + 0.9], [A[0], A[1], o.z + h + 0.9]], '#5d6670');
            this.poly([[A[0], A[1], o.z + h + 0.9], [B[0], B[1], o.z + h + 0.9], [B[0] + nx * 1.5, B[1] + ny * 1.5, o.z + h + 0.9], [A[0] + nx * 1.5, A[1] + ny * 1.5, o.z + h + 0.9]], '#8c96a1');
            if (p0 && p0[2] > 5) {
              for (let k = 0; k < 22; k++) {
                const t = (k + 0.5) / 22;
                const q = this.project(A[0] + (B[0] - A[0]) * t + nx * 0.7, A[1] + (B[1] - A[1]) * t + ny * 0.7, o.z + h + 1.4 + Math.sin(this.now * 6 + k + row) * 0.05);
                if (!q) continue;
                ctx.fillStyle = D.BOT_COLORS[(k * 7 + row * 3) % D.BOT_COLORS.length];
                ctx.beginPath(); ctx.arc(q[0], q[1], 0.28 * q[2], 0, 7); ctx.fill();
                ctx.fillStyle = '#f0c8a0'; ctx.beginPath(); ctx.arc(q[0], q[1] - 0.35 * q[2], 0.16 * q[2], 0, 7); ctx.fill();
              }
            }
          }
          const R1 = [o.x1 + nx * 6.5, o.y1 + ny * 6.5], R2 = [o.x2 + nx * 6.5, o.y2 + ny * 6.5];
          this.poly([[o.x1, o.y1, o.z + 5.2], [o.x2, o.y2, o.z2 + 5.2], [R2[0], R2[1], o.z + 6], [R1[0], R1[1], o.z + 6]], 'rgba(230,57,70,0.75)');
          break;
        }
        case 'kmsign': {
          const top = this.project(o.x, o.y, o.z + 1.6);
          if (!top) return;
          ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(1, 0.1 * s);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
          this.poly([[o.x - ca * 0.6, o.y - sa * 0.6, o.z + 1.2], [o.x + ca * 0.6, o.y + sa * 0.6, o.z + 1.2], [o.x + ca * 0.6, o.y + sa * 0.6, o.z + 2], [o.x - ca * 0.6, o.y - sa * 0.6, o.z + 2]], '#f5f5f5');
          const dist = o.n * 200;
          const txt = o.label || (dist >= 1000 ? `${(dist / 1000).toFixed(1).replace('.0', '')} км` : `${dist} м`);
          if (s > 10) this.planeText(o.x - ca * 0.6, o.y - sa * 0.6, o.x + ca * 0.6, o.y + sa * 0.6, o.z + 1.2, txt, 0.42, '#1b1b1b');
          break;
        }
        case 'car': {
          this.shadow(o.x, o.y, o.z, 2.6, 1.4);
          this.prism(o.x, o.y, o.z, 4.2, 1.8, 0.75, o.ang, o.c, { lift: 0.3 });
          const off = -0.2;
          const cxp = o.x + Math.cos(o.ang) * off, cyp = o.y + Math.sin(o.ang) * off;
          this.prism(cxp, cyp, o.z + 1.05, 2.2, 1.6, 0.55, o.ang, '#2d3a48', { top: shade(o.c, 0.95) });
          break;
        }
        case 'tyres': {
          for (let k = 0; k < 3; k++) {
            const q = this.project(o.x, o.y, o.z + 0.15 + k * 0.32);
            if (!q) continue;
            ctx.fillStyle = '#1a1a1c'; ctx.beginPath(); ctx.ellipse(q[0], q[1], 0.6 * q[2], 0.42 * q[2], 0, 0, 7); ctx.fill();
            ctx.strokeStyle = k % 2 ? '#e63946' : '#f1f1f1'; ctx.lineWidth = Math.max(1, 0.1 * q[2]);
            ctx.beginPath(); ctx.ellipse(q[0], q[1], 0.6 * q[2], 0.42 * q[2], 0, Math.PI, Math.PI * 2); ctx.stroke();
          }
          break;
        }
        case 'buoy': {
          const bob = Math.sin(this.now * 2 + o.seed * 10) * 0.08;
          const r = o.big ? 1.0 : 0.38;
          const q = this.project(o.x, o.y, r * 0.7 + bob);
          if (!q) return;
          ctx.fillStyle = 'rgba(0,30,60,0.3)'; ctx.beginPath(); ctx.ellipse(base[0], base[1], r * 1.3 * s, r * 0.6 * s, 0, 0, 7); ctx.fill();
          ctx.fillStyle = o.big ? '#f26b00' : '#e8c400'; ctx.beginPath(); ctx.arc(q[0], q[1], r * q[2], 0, 7); ctx.fill();
          ctx.fillStyle = o.big ? '#ffd2a0' : '#fff6b0'; ctx.beginPath(); ctx.arc(q[0] - r * 0.3 * q[2], q[1] - r * 0.3 * q[2], r * 0.45 * q[2], 0, 7); ctx.fill();
          if (o.big) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(q[0] - r * q[2], q[1] - 0.1 * q[2], 2 * r * q[2], 0.2 * q[2]); }
          break;
        }
        case 'pontoon': {
          this.prism(o.x, o.y, 0, 6, o.len || 16, 0.35, o.ang, '#a0744a');
          const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
          ctx.strokeStyle = 'rgba(60,35,15,0.5)'; ctx.lineWidth = 1;
          const half = Math.floor((o.len || 16) / 2) - 1;
          for (let k = -half; k <= half; k += 1) {
            const a = this.project(o.x - ca * 3 - sa * k, o.y - sa * 3 + ca * k, 0.36), b = this.project(o.x + ca * 3 - sa * k, o.y + sa * 3 + ca * k, 0.36);
            if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
          }
          break;
        }
        case 'boat':
        case 'kayak': {
          const kayak = o.type === 'kayak';
          const ang = o.seed * 6 + Math.sin(this.now * 0.3 + o.seed) * 0.1;
          const Lh = kayak ? 2.6 : 6, Wh = kayak ? 0.35 : 1.3;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const P = (u, v, h) => [o.x + u * ca - v * sa, o.y + u * sa + v * ca, (o.z || 0) + h];
          this.poly([P(-Lh / 2, -Wh, 0), P(Lh * 0.3, -Wh, 0), P(Lh / 2, 0, 0), P(Lh * 0.3, Wh, 0), P(-Lh / 2, Wh, 0)], 'rgba(0,30,60,0.25)');
          this.poly([P(-Lh / 2, -Wh, 0.4), P(Lh * 0.3, -Wh, 0.4), P(Lh / 2, 0, 0.5), P(Lh * 0.3, Wh, 0.4), P(-Lh / 2, Wh, 0.4)], kayak ? '#e63946' : '#f4f4f4');
          if (!kayak) {
            this.poly([P(-Lh / 2 + 0.2, -Wh + 0.2, 0.42), P(Lh * 0.25, -Wh + 0.2, 0.42), P(Lh * 0.25, Wh - 0.2, 0.42), P(-Lh / 2 + 0.2, Wh - 0.2, 0.42)], '#1d6fa5');
            this.prism(o.x - ca * 0.6, o.y - sa * 0.6, (o.z || 0) + 0.42, 1.6, 1.2, 0.8, ang, '#eaeaea');
          } else {
            const q = this.project(...P(0, 0, 0.9));
            if (q) { ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(q[0], q[1], 0.3 * q[2], 0, 7); ctx.fill(); }
          }
          break;
        }
        case 'rack': {
          // Велостойка транзитной зоны: перекладина и велосипеды, подвешенные за седло.
          const dx = o.x2 - o.x1, dy = o.y2 - o.y1, L = Math.hypot(dx, dy);
          const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
          const n = Math.floor(L / 1.3);
          for (let i = 0; i <= n; i++) {
            const t = i / n, bx = o.x1 + dx * t, by = o.y1 + dy * t;
            const side = i % 2 ? 1 : -1;
            const col = o.cols[(i * 3 + Math.floor(o.seed * 10)) % o.cols.length];
            const w = (u, h) => this.project(bx + nx * u * side, by + ny * u * side, o.z + h);
            const wa = w(-0.15, 0.35), wb2 = w(-0.85, 0.35), wc = w(0.55, 0.35), wd = w(-0.1, 1.15), we = w(0.5, 0.95);
            if (!wa || !wb2 || !wc || !wd || !we) continue;
            ctx.lineCap = 'round';
            ctx.strokeStyle = '#141416'; ctx.lineWidth = Math.max(1.5, 0.07 * wa[2]);
            ctx.beginPath(); ctx.moveTo(w(-1.2, 0.35)[0], w(-1.2, 0.35)[1]); ctx.lineTo(wb2[0], wb2[1]); ctx.moveTo(w(0.25, 0.35)[0], w(0.25, 0.35)[1]); ctx.lineTo(w(0.9, 0.35)[0], w(0.9, 0.35)[1]); ctx.stroke();
            ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 0.05 * wa[2]);
            ctx.beginPath(); ctx.moveTo(wb2[0], wb2[1]); ctx.lineTo(wd[0], wd[1]); ctx.lineTo(we[0], we[1]); ctx.lineTo(wc[0], wc[1]); ctx.stroke();
          }
          const p1 = this.project(o.x1, o.y1, o.z + 1.15), p2 = this.project(o.x2, o.y2, o.z + 1.15);
          const q1 = this.project(o.x1, o.y1, o.z), q2 = this.project(o.x2, o.y2, o.z);
          if (p1 && p2 && q1 && q2) {
            ctx.strokeStyle = '#b8bec6'; ctx.lineWidth = Math.max(1.5, 0.08 * q1[2]);
            ctx.beginPath(); ctx.moveTo(q1[0], q1[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(q2[0], q2[1]); ctx.stroke();
          }
          break;
        }
        case 'fence': {
          // Деревянный забор: столбики и две жерди.
          const P = (t, h) => this.project(o.x1 + (o.x2 - o.x1) * t, o.y1 + (o.y2 - o.y1) * t, o.z + (o.z2 - o.z) * t + h);
          ctx.strokeStyle = '#8a6440'; ctx.lineCap = 'round';
          for (const t of [0, 0.5]) { const a = P(t, 0), b = P(t, 1.2); if (a && b) { ctx.lineWidth = Math.max(1.5, 0.12 * a[2]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
          for (const h of [0.55, 1.0]) { const a = P(0, h), b = P(1, h); if (a && b) { ctx.strokeStyle = '#a07a52'; ctx.lineWidth = Math.max(1, 0.09 * a[2]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
          break;
        }
        case 'guardrail': {
          const P = (t, h) => this.project(o.x1 + (o.x2 - o.x1) * t, o.y1 + (o.y2 - o.y1) * t, o.z + (o.z2 - o.z) * t + h);
          for (const t of [0, 0.5]) { const a = P(t, 0), b = P(t, 0.75); if (a && b) { ctx.strokeStyle = '#6b7178'; ctx.lineWidth = Math.max(1.5, 0.1 * a[2]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
          this.poly([[o.x1, o.y1, o.z + 0.45], [o.x2, o.y2, o.z2 + 0.45], [o.x2, o.y2, o.z2 + 0.75], [o.x1, o.y1, o.z + 0.75]], '#c3c9d0');
          this.poly([[o.x1, o.y1, o.z + 0.58], [o.x2, o.y2, o.z2 + 0.58], [o.x2, o.y2, o.z2 + 0.62], [o.x1, o.y1, o.z + 0.62]], '#8d949c');
          break;
        }
        case 'pole': {
          // Деревянная опора ЛЭП с траверсой и провисающими проводами до следующей опоры.
          const top = this.project(o.x, o.y, o.z + 8);
          if (!top) return;
          ctx.strokeStyle = '#6b4f33'; ctx.lineWidth = Math.max(1.5, 0.22 * s); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          const dx = o.nx2 - o.x, dy = o.ny2 - o.y, L2 = Math.hypot(dx, dy) || 1;
          const px = -dy / L2, py = dx / L2;
          ctx.strokeStyle = '#4e3a26'; ctx.lineWidth = Math.max(1, 0.12 * top[2]);
          const c1 = this.project(o.x + px * 1.2, o.y + py * 1.2, o.z + 7.6), c2 = this.project(o.x - px * 1.2, o.y - py * 1.2, o.z + 7.6);
          if (c1 && c2) { ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke(); }
          ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 1;
          for (const k of [-1, 0, 1]) {
            const a = this.project(o.x + px * k, o.y + py * k, o.z + 7.6), b = this.project(o.nx2 + px * k, o.ny2 + py * k, o.nz2 + 7.6);
            const m = this.project((o.x + o.nx2) / 2 + px * k, (o.y + o.ny2) / 2 + py * k, (o.z + o.nz2) / 2 + 6.4);
            if (a && b && m) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2, b[0], b[1]); ctx.stroke(); }
          }
          break;
        }
        case 'snowbank': {
          const top = this.project(o.x, o.y, o.z + 0.35 + o.seed * 0.3);
          if (!top) return;
          const r = (1.2 + o.seed * 0.8) * s;
          ctx.fillStyle = '#c9d6e2'; ctx.beginPath(); ctx.ellipse(base[0], base[1], r, r * 0.42, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#f4f8fc'; ctx.beginPath(); ctx.ellipse(top[0], top[1], r * 0.85, r * 0.32, 0, 0, 7); ctx.fill();
          break;
        }
        case 'fern': {
          ctx.strokeStyle = o.seed > 0.5 ? '#3f8a35' : '#4f9a3a'; ctx.lineCap = 'round';
          for (let k = 0; k < 7; k++) {
            const a = k / 7 * Math.PI * 2 + o.seed * 3;
            const tip = this.project(o.x + Math.cos(a) * 1.1, o.y + Math.sin(a) * 1.1, o.z + 0.35);
            const mid = this.project(o.x + Math.cos(a) * 0.5, o.y + Math.sin(a) * 0.5, o.z + 0.55);
            if (!tip || !mid) continue;
            ctx.lineWidth = Math.max(1, 0.12 * s);
            ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.quadraticCurveTo(mid[0], mid[1], tip[0], tip[1]); ctx.stroke();
          }
          break;
        }
        case 'trafficlight': {
          const top = this.project(o.x, o.y, o.z + 3.4);
          if (!top) return;
          ctx.strokeStyle = '#2d3036'; ctx.lineWidth = Math.max(1.5, 0.14 * s);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          const w = 0.3 * top[2];
          ctx.fillStyle = '#1b1c1f'; ctx.fillRect(top[0] - w / 2, top[1] - w * 2.6, w, w * 2.8);
          const lit = Math.floor((this.now + o.seed * 10) / 3) % 3;
          ['#ff3b30', '#ffcc00', '#34c759'].forEach((col, i) => {
            ctx.fillStyle = i === lit ? col : 'rgba(80,80,80,0.9)';
            ctx.beginPath(); ctx.arc(top[0], top[1] - w * 2.2 + i * w * 0.85, w * 0.32, 0, 7); ctx.fill();
          });
          break;
        }
        case 'gantry': this.drawGantry(track, o); break;
        case 'kicker': {
          // Деревянный трамплин: наклонная рампа и боковые стенки.
          const ca = Math.cos(o.ang), sa = Math.sin(o.ang), w = o.w / 2;
          const P = (lon, lat, h) => [o.x + ca * lon - sa * lat, o.y + sa * lon + ca * lat, o.z + h];
          this.poly([P(-3, w, 0), P(0, w, 0.9), P(0, -w, 0.9), P(-3, -w, 0)], '#b48450');
          for (let k = 1; k < 6; k++) { const l = -3 + k * 0.5; this.poly([P(l, w, (l + 3) * 0.3), P(l + 0.05, w, (l + 3.05) * 0.3), P(l + 0.05, -w, (l + 3.05) * 0.3), P(l, -w, (l + 3) * 0.3)], 'rgba(70,40,15,0.5)'); }
          this.poly([P(0, w, 0), P(0, w, 0.9), P(0, -w, 0.9), P(0, -w, 0)], '#7a5430');
          for (const sd of [w, -w]) this.poly([P(-3, sd, 0), P(0, sd, 0.9), P(0, sd, 0)], '#8e6439');
          this.poly([P(-0.25, w, 0.82), P(0, w, 0.9), P(0, -w, 0.9), P(-0.25, -w, 0.82)], '#f2c230');
          break;
        }
        case 'starthut': {
          // Стартовые ворота: деревянная рампа, стойки и баннер START над трассой
          // (без крыши — камера стоит позади и смотрит сквозь ворота).
          const ca = Math.cos(o.ang), sa = Math.sin(o.ang), w = o.w / 2;
          const P = (lon, lat, h) => [o.x + ca * lon - sa * lat, o.y + sa * lon + ca * lat, o.z + h];
          this.poly([P(-3, w, 0.05), P(0.8, w, 0.05), P(0.8, -w, 0.05), P(-3, -w, 0.05)], '#9b7748');
          for (let k = 0; k < 7; k++) { const l = -3 + k * 0.6; this.poly([P(l, w, 0.06), P(l + 0.06, w, 0.06), P(l + 0.06, -w, 0.06), P(l, -w, 0.06)], 'rgba(60,35,15,0.5)'); }
          for (const sd of [w, -w]) {
            this.poly([P(-3, sd, 0), P(0.8, sd, 0), P(0.8, sd, 1.0), P(-3, sd, 1.0)], '#2f343c');
            const a = this.project(...P(0.6, sd, 0)), b = this.project(...P(0.6, sd, 4.2));
            if (a && b) { ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = Math.max(2, 0.3 * a[2]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
          }
          this.poly([P(0.6, w, 3.4), P(0.6, -w, 3.4), P(0.6, -w, 4.2), P(0.6, w, 4.2)], '#e63946');
          const a = P(0.6, -w, 3.4), b = P(0.6, w, 3.4);
          if (base[2] > 4) this.planeText(a[0], a[1], b[0], b[1], a[2] + 0.05, 'START', 0.6, '#ffffff');
          break;
        }
        case 'tape': {
          // Колышки и сигнальная лента вдоль трассы.
          const a = this.project(o.x1, o.y1, o.z), a2 = this.project(o.x1, o.y1, o.z + 0.85);
          if (!a || !a2) return;
          ctx.strokeStyle = '#e8e2d4'; ctx.lineWidth = Math.max(1, 0.06 * a[2]);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a2[0], a2[1]); ctx.stroke();
          const b2 = this.project(o.x2, o.y2, o.z2 + 0.85), m = this.project((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, (o.z + o.z2) / 2 + 0.72);
          if (b2 && m) {
            ctx.strokeStyle = o.c; ctx.lineWidth = Math.max(1, 0.07 * a[2]);
            ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.quadraticCurveTo(m[0], m[1], b2[0], b2[1]); ctx.stroke();
          }
          break;
        }
        case 'mesa': {
          // Столовая гора из песчаника со слоями.
          const ang = o.seed * 3;
          const layers = 4;
          for (let k = 0; k < layers; k++) {
            const z0 = o.z + (o.h / layers) * k;
            const ww = o.w * (1 - k * 0.12);
            this.prism(o.x, o.y, z0, ww, ww * 0.8, o.h / layers, ang, k % 2 ? '#c4693d' : '#b45a33');
          }
          break;
        }
        case 'snowpatch': {
          const pts = [];
          for (let k = 0; k < 9; k++) {
            const a = k / 9 * Math.PI * 2;
            const rr = (2 + o.seed * 3) * (0.7 + ((o.seed * (k + 2) * 17.3) % 1) * 0.5);
            pts.push([o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr * 0.8, o.z + 0.02]);
          }
          this.poly(pts, 'rgba(245,249,252,0.92)');
          break;
        }
        case 'building': this.drawBox(o, track, false); break;
        case 'house': this.drawBox(o, track, true); break;
        default: break;
      }
    }

    drawGantry(track, o) {
      const p = track.samples[(o && o.idx) || 0], hw = track.hw + 1.4;
      const L = [p.x + p.nx * hw, p.y + p.ny * hw], R = [p.x - p.nx * hw, p.y - p.ny * hw];
      const ctx = this.ctx;
      const z = p.z;
      const pts = [this.project(L[0], L[1], z), this.project(L[0], L[1], z + 6.5), this.project(R[0], R[1], z), this.project(R[0], R[1], z + 6.5)];
      if (pts.some((q) => !q)) return;
      ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = Math.max(2, 0.35 * pts[0][2]);
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); ctx.stroke();
      this.poly([[L[0], L[1], z + 5], [R[0], R[1], z + 5], [R[0], R[1], z + 6.6], [L[0], L[1], z + 6.6]], '#c62828');
      // Шашечки на баннере.
      const n = 12;
      for (let k = 0; k < n; k++) {
        if (k % 2) continue;
        const t0 = k / n, t1 = (k + 1) / n;
        const lx = (t) => L[0] + (R[0] - L[0]) * t, ly = (t) => L[1] + (R[1] - L[1]) * t;
        this.poly([[lx(t0), ly(t0), z + 5.3], [lx(t1), ly(t1), z + 5.3], [lx(t1), ly(t1), z + 5.8], [lx(t0), ly(t0), z + 5.8]], '#fff');
        this.poly([[lx(t1), ly(t1), z + 5.8], [lx(Math.min(1, t1 + 1 / n)), ly(Math.min(1, t1 + 1 / n)), z + 5.8], [lx(Math.min(1, t1 + 1 / n)), ly(Math.min(1, t1 + 1 / n)), z + 6.3], [lx(t1), ly(t1), z + 6.3]], '#fff');
      }
    }

    // Здание (коробка) или домик с крышей: рисуем только видимые грани.
    drawBox(o, track, house) {
      const c = this.cam;
      const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
      const hw = o.w / 2, hd = o.d / 2;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [o.x + u * ca - v * sa, o.y + u * sa + v * ca]);
      for (const k of corners) if (this.toCam(k[0], k[1], o.z)[2] < NEAR + 0.5) return;
      const palette = house ? ['#e8d9b5', '#d7c49a', '#f1e5c6'] : ['#8d99a6', '#a3aeb9', '#7a8794', '#b59f86', '#9c7f6a', '#c7b8a3'];
      const col = o.col || palette[Math.floor(o.seed * palette.length)];
      const z0 = o.z, z1 = o.z + o.h;
      const faces = [];
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        // внешняя нормаль
        const nx = mx - o.x, ny = my - o.y;
        if ((c.wx - mx) * nx + (c.wy - my) * ny <= 0) continue;
        faces.push({ a, b, d: this.toCam(mx, my, z0)[2], i });
      }
      faces.sort((p, q) => q.d - p.d);
      for (const f of faces) {
        const light = 0.72 + 0.22 * Math.abs(Math.sin(o.ang + f.i * Math.PI / 2));
        this.poly([[f.a[0], f.a[1], z0], [f.b[0], f.b[1], z0], [f.b[0], f.b[1], z1], [f.a[0], f.a[1], z1]], shade(col, light));
        if (f.d < 110) {
          // Окна.
          const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
          const cols = Math.max(1, Math.floor(len / 3)), rows = Math.max(1, Math.floor(o.h / 3.2));
          for (let r = 0; r < rows; r++) {
            for (let k = 0; k < cols; k++) {
              const t0 = (k + 0.3) / cols, t1 = (k + 0.7) / cols;
              const zA = z0 + (r + 0.35) * (o.h / rows), zB = zA + (o.h / rows) * 0.4;
              const P = (t) => [f.a[0] + (f.b[0] - f.a[0]) * t, f.a[1] + (f.b[1] - f.a[1]) * t];
              const p0 = P(t0), p1 = P(t1);
              const lit = ((k * 7 + r * 3 + Math.floor(o.seed * 10)) % 5) === 0;
              this.poly([[p0[0], p0[1], zA], [p1[0], p1[1], zA], [p1[0], p1[1], zB], [p0[0], p0[1], zB]], lit ? '#ffe7a3' : 'rgba(40,60,85,0.75)');
            }
          }
        }
      }
      if (!house) {
        this.poly(corners.map((k) => [k[0], k[1], z1]), shade(col, 1.12));
        const inset = corners.map((k) => [o.x + (k[0] - o.x) * 0.85, o.y + (k[1] - o.y) * 0.85, z1]);
        this.poly(inset, shade(col, 0.95));
      } else {
        const apex = [o.x, o.y, z1 + 2.6];
        const tris = [];
        for (let i = 0; i < 4; i++) {
          const a = corners[i], b = corners[(i + 1) % 4];
          tris.push({ pts: [[a[0], a[1], z1], [b[0], b[1], z1], apex], d: this.toCam((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z1)[2], i });
        }
        tris.sort((p, q) => q.d - p.d);
        for (const t of tris) this.poly(t.pts, shade('#b5452f', 0.8 + 0.12 * t.i));
      }
    }

    // ══ Спрайты участников ══════════════════════════════════════════
    // Локальная система координат участника: x — вправо, y — назад, h — высота (метры).
    // Проекция аффинная по трём осям, поэтому фигура корректно «стоит» на дороге в перспективе.
    spriteFrame(r, scale) {
      const ctx = this.ctx;
      const base = this.project(r.x, r.y, r.z);
      if (!base) return null;
      const fx = Math.cos(r.heading), fy = Math.sin(r.heading);
      const pf = this.project(r.x + fx, r.y + fy, r.z);
      const pr = this.project(r.x + fy, r.y - fx, r.z);
      const pu = this.project(r.x, r.y, r.z + 1);
      if (!pf || !pr || !pu) return null;
      const sc = scale || 1;
      const F = [(pf[0] - base[0]) * sc, (pf[1] - base[1]) * sc], R = [(pr[0] - base[0]) * sc, (pr[1] - base[1]) * sc], U = [(pu[0] - base[0]) * sc, (pu[1] - base[1]) * sc];
      const k = Math.hypot(R[0], R[1]);
      const rot = Math.atan2(-F[0], F[1]);
      // tilt — наклон вбок (крен), dx — сдвиг всей фигуры вбок.
      const make = (tilt, dx) => (x, y, h) => {
        const xx = x + (dx || 0) + h * (tilt || 0);
        return [base[0] + R[0] * xx - F[0] * y + U[0] * h, base[1] + R[1] * xx - F[1] * y + U[1] * h];
      };
      const seg = (a, b, w, col) => {
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * k);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      };
      const path = (pts, w, col) => {
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * k);
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
      };
      const blob = (c, rx, ry, col) => {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.ellipse(c[0], c[1], Math.max(0.5, rx * k), Math.max(0.5, ry * k), rot, 0, Math.PI * 2); ctx.fill();
      };
      const poly = (pts, col) => {
        ctx.fillStyle = col; ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath(); ctx.fill();
      };
      // Объёмная конечность: тёмный контур, основной цвет и блик сверху.
      const limb = (a, b, w, col) => {
        seg(a, b, w * 1.28, 'rgba(0,0,0,0.32)');
        seg(a, b, w, col);
        const dx = (b[0] - a[0]), dy = (b[1] - a[1]), L = Math.hypot(dx, dy) || 1;
        const ox = -dy / L * w * k * 0.22, oy = dx / L * w * k * 0.22;
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = Math.max(0.6, w * k * 0.3);
        ctx.beginPath(); ctx.moveTo(a[0] - ox, a[1] - oy); ctx.lineTo(b[0] - ox, b[1] - oy); ctx.stroke();
      };
      const polyO = (pts, col) => {
        poly(pts, col);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(0.8, 0.025 * k);
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.stroke();
      };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      return { ctx, base, k, make, pt: make(0, 0), seg, path, blob, poly, limb, polyO };
    }

    // Оттенок кожи — свой у каждого спортсмена (по имени).
    skinOf(r) {
      const tones = ['#f1c7a5', '#e2b391', '#d39b6f', '#b97a4f', '#8d5a3b'];
      let h = 0;
      const n = r.name || '';
      for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
      return tones[h % tones.length];
    }

    // Двухзвенная кинематика (бедро→колено→стопа) в плоскости «вперёд-вверх»: колено выводится вперёд.
    static ik(hy, hh, fy, fh, L1, L2) {
      let dy = fy - hy, dh = fh - hh;
      let d = Math.hypot(dy, dh);
      const maxD = L1 + L2 - 0.002;
      if (d > maxD) { dy *= maxD / d; dh *= maxD / d; d = maxD; }
      d = Math.max(d, 0.05);
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
      const hgt = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      let ny = -dh / d, nh = dy / d;
      if (ny > 0) { ny = -ny; nh = -nh; } // колено всегда спереди (y < 0)
      return [hy + dy * a / d + ny * hgt, hh + dh * a / d + nh * hgt];
    }

    // Велосипед (без гонщика). Возвращает точки посадки: педали, седло, руль.
    drawBikeSprite(S, r, bike, tilt, dx) {
      const t = bike.type;
      const pt = S.make(tilt, dx);
      const { seg, blob, poly } = S;
      const mtbLike = ['mtb', 'enduro', 'xc', 'fat', 'bmx', 'dh'].includes(t);
      const tw = t === 'fat' ? 0.11 : t === 'dh' ? 0.072 : mtbLike ? 0.06 : t === 'gravel' ? 0.042 : 0.03;
      const wheelR = t === 'folding' ? 0.21 : t === 'bmx' ? 0.26 : 0.35;
      const wb = t === 'folding' ? 0.52 : t === 'bmx' ? 0.48 : t === 'dh' ? 0.68 : t === 'enduro' ? 0.62 : 0.5;
      const rims = (bike.look && bike.look.rims) || 'alu';
      const rimCol = rims === 'alu' ? '#c3c8cf' : '#2f3136';
      const odo = r.odo || 0;
      // Тень (наклоняется вместе с велосипедом).
      if (!(r.airH > 0.05)) blob(S.make(0, dx)(0.3 + (tilt || 0) * 0.5, 0.2, 0), 0.3, 1.0, 'rgba(0,0,0,0.24)');
      // Колёса: покрышка, обод и бегущие по протектору метки — видно вращение.
      for (const wy of [-wb, wb]) {
        seg(pt(0, wy - wheelR, wheelR * 0.4), pt(0, wy + wheelR, wheelR * 0.4), tw * 2.4, '#111214');
        seg(pt(0, wy - wheelR * 0.86, wheelR * 0.5), pt(0, wy + wheelR * 0.86, wheelR * 0.5), tw * (rims === 'alu' ? 0.8 : 1.3), rimCol);
        for (let i = 0; i < 6; i++) {
          const th = odo / wheelR + i * Math.PI / 3;
          if (Math.sin(th) < -0.1) continue;
          const y = wy + wheelR * Math.cos(th), h = wheelR + wheelR * Math.sin(th);
          seg(pt(-tw * 1.1, y, h), pt(tw * 1.1, y, h), 0.022, 'rgba(255,255,255,0.32)');
        }
      }
      // Задние перья, рама, вилка.
      const frame = bike.color, frameD = window.Render.shade(bike.color, 0.65);
      seg(pt(-0.06, wb, 0.35), pt(-0.03, 0.02, 0.3), 0.035, frameD);
      seg(pt(0.06, wb, 0.35), pt(0.03, 0.02, 0.3), 0.035, frameD);
      seg(pt(-0.05, wb, 0.37), pt(0, 0.12, 0.64), 0.03, frame);
      seg(pt(0.05, wb, 0.37), pt(0, 0.12, 0.64), 0.03, frame);
      seg(pt(0, 0.02, 0.3), pt(0, -wb + 0.12, 0.62), t === 'aero' || t === 'tt' || t === 'enduro' || t === 'dh' ? 0.075 : 0.06, frameD);
      seg(pt(0, 0.14, 0.66), pt(0, -wb + 0.1, 0.68), mtbLike ? 0.06 : 0.05, frame);
      seg(pt(0, 0.14, 0.66), pt(0, -wb + 0.1, 0.68), 0.015, 'rgba(255,255,255,0.35)');
      const forkCol = mtbLike && t !== 'fat' && t !== 'bmx' ? '#1a1a1d' : frame;
      seg(pt(-0.05, -wb, 0.37), pt(0, -wb + 0.08, 0.62), 0.03, forkCol);
      seg(pt(0.05, -wb, 0.37), pt(0, -wb + 0.08, 0.62), 0.03, forkCol);
      if (t === 'dh') {
        // Двухкоронная вилка: ноги до самого руля, верхняя корона и задний амортизатор.
        seg(pt(-0.07, -wb + 0.02, 0.4), pt(-0.06, -wb + 0.1, 0.84), 0.045, '#1a1a1d');
        seg(pt(0.07, -wb + 0.02, 0.4), pt(0.06, -wb + 0.1, 0.84), 0.045, '#1a1a1d');
        seg(pt(-0.07, -wb + 0.04, 0.5), pt(-0.065, -wb + 0.07, 0.68), 0.05, '#e8a33a');
        seg(pt(0.07, -wb + 0.04, 0.5), pt(0.065, -wb + 0.07, 0.68), 0.05, '#e8a33a');
        seg(pt(-0.09, -wb + 0.1, 0.8), pt(0.09, -wb + 0.1, 0.8), 0.035, '#2b2c30');
        seg(pt(0, 0.05, 0.4), pt(0, 0.2, 0.6), 0.06, '#e8a33a');
        seg(pt(0, 0.05, 0.4), pt(0, 0.2, 0.6), 0.025, '#2b2c30');
      }
      // Звезда, шатуны и педали вращаются с каденсом.
      const ph = r.pedal || 0;
      blob(pt(0.09, 0, 0.3), 0.025, 0.11, '#4d5157');
      const pedal = (sgn) => [0.14 * sgn, -Math.cos(ph) * 0.17 * sgn, 0.3 + Math.sin(ph) * 0.17 * sgn];
      const pL = pedal(-1), pR = pedal(1);
      seg(pt(-0.1, 0, 0.3), pt(pL[0], pL[1], pL[2]), 0.028, '#2a2b2f');
      seg(pt(0.1, 0, 0.3), pt(pR[0], pR[1], pR[2]), 0.028, '#2a2b2f');
      seg(pt(pL[0] - 0.05, pL[1], pL[2]), pt(pL[0] + 0.03, pL[1], pL[2]), 0.04, '#111');
      seg(pt(pR[0] - 0.03, pR[1], pR[2]), pt(pR[0] + 0.05, pR[1], pR[2]), 0.04, '#111');
      // Седло и руль.
      const sadH = 0.96;
      poly([pt(-0.07, 0.3, sadH), pt(0.07, 0.3, sadH), pt(0.025, 0.06, sadH), pt(-0.025, 0.06, sadH)], '#151517');
      const barY = -wb + 0.06, barH = t === 'bmx' ? 1.05 : t === 'folding' ? 1.0 : t === 'dh' ? 0.95 : mtbLike ? 0.92 : 0.88;
      seg(pt(0, -wb + 0.12, 0.68), pt(0, barY, barH), 0.04, '#1b1c1f');
      let hands;
      if (t === 'tt') {
        seg(pt(-0.2, barY, barH), pt(0.2, barY, barH), 0.032, '#1b1c1f');
        seg(pt(-0.06, barY + 0.15, barH + 0.05), pt(-0.05, barY - 0.2, barH + 0.06), 0.03, '#1b1c1f');
        seg(pt(0.06, barY + 0.15, barH + 0.05), pt(0.05, barY - 0.2, barH + 0.06), 0.03, '#1b1c1f');
        hands = [[-0.05, barY - 0.15, barH + 0.07], [0.05, barY - 0.15, barH + 0.07]];
      } else if (mtbLike || t === 'hybrid' || t === 'folding') {
        const bw = t === 'bmx' ? 0.34 : t === 'folding' ? 0.28 : t === 'hybrid' ? 0.31 : t === 'dh' ? 0.42 : 0.39;
        seg(pt(-bw, barY + 0.03, barH), pt(bw, barY + 0.03, barH), 0.032, '#1b1c1f');
        seg(pt(-bw, barY + 0.03, barH), pt(-bw + 0.12, barY + 0.03, barH), 0.045, '#0d0d0f');
        seg(pt(bw - 0.12, barY + 0.03, barH), pt(bw, barY + 0.03, barH), 0.045, '#0d0d0f');
        if (t === 'bmx') seg(pt(-0.12, barY + 0.06, barH - 0.12), pt(0.12, barY + 0.06, barH - 0.12), 0.02, '#c9ccd1');
        hands = [[-bw + 0.06, barY + 0.03, barH + 0.02], [bw - 0.06, barY + 0.03, barH + 0.02]];
      } else {
        seg(pt(-0.2, barY + 0.04, barH), pt(0.2, barY + 0.04, barH), 0.032, '#151515');
        seg(pt(-0.2, barY + 0.04, barH), pt(-0.21, barY - 0.1, barH - 0.02), 0.032, '#151515');
        seg(pt(0.2, barY + 0.04, barH), pt(0.21, barY - 0.1, barH - 0.02), 0.032, '#151515');
        blob(pt(-0.21, barY - 0.08, barH + 0.02), 0.025, 0.05, '#2b2c30');
        blob(pt(0.21, barY - 0.08, barH + 0.02), 0.025, 0.05, '#2b2c30');
        hands = [[-0.21, barY - 0.07, barH + 0.04], [0.21, barY - 0.07, barH + 0.04]];
      }
      return { pL, pR, sadH, hands, wb };
    }

    // Велогонщик: педалирование с кинематикой ног, крен в поворотах, «танцовщица» при спурте.
    drawCyclist(r) {
      const S = this.spriteFrame(r, 1.08);
      if (!S) return null;
      const bike = D.bikeById(r.bikeId);
      const t = bike.type;
      const ph = r.pedal || 0;
      const attack = t === 'dh' && r.standing && !(r.sprintHold > 0);
      const standing = r.sprintHold > 0 || (r.climbing && r.v < 9) || attack;
      const lean = Math.max(-1, Math.min(1, r.lean || 0));
      // Велосипед раскачивается под гонщиком при работе стоя, весь корпус кренится в повороте.
      const sway = standing && !attack ? Math.sin(ph) * 0.13 : 0;
      const bikeTilt = lean * 0.32 + sway;
      const g = this.drawBikeSprite(S, r, bike, bikeTilt, 0);
      const riderTilt = lean * 0.3 - sway * 0.35;
      const pt = S.make(riderTilt, 0);
      const bikePt = S.make(bikeTilt, 0);
      const { seg, blob, poly, limb, polyO } = S;
      const tuck = t === 'tt' || t === 'aero' ? 0.14 : t === 'road' ? 0.06 : 0;
      const bob = Math.abs(Math.sin(ph)) * (standing ? 0.05 : 0.012);
      // Даунхилл: «атакующая стойка» — стоя на педалях, таз отведён назад, локти в стороны.
      const absorb = attack ? Math.sin((r.odo || 0) * 2.3) * 0.025 + (r.airH > 0.05 ? -0.06 : 0) : 0;
      const hipH = attack ? 1.0 + absorb : standing ? 1.13 + bob : 0.98 - tuck * 0.3 + bob;
      const hipY = attack ? 0.16 : standing ? -0.02 : 0.2;
      const skin = this.skinOf(r), shorts = '#17181b';
      // Ноги: дальняя (по фазе ниже) первой, чтобы правильно перекрывалась.
      const leg = (sgn) => {
        const p = sgn < 0 ? g.pL : g.pR;
        const hip = [0.09 * sgn, hipY, hipH];
        const [ky, kh] = Renderer.ik(hip[1], hip[2], p[1], p[2], 0.46, 0.5);
        const kx = 0.12 * sgn + (standing ? sway * -0.3 : 0);
        const H = pt(hip[0], hip[1], hip[2]), K = pt(kx, ky, kh);
        const Fo = bikePt(p[0], p[1], p[2] + 0.03);
        limb(H, K, 0.14, shorts);
        limb(K, Fo, 0.1, skin);
        seg(pt(kx * 0.6 + p[0] * 0.4, ky * 0.25 + p[1] * 0.75, kh * 0.25 + p[2] * 0.75), Fo, 0.085, '#f4f4f4');
        blob(Fo, 0.055, 0.125, '#111214');
        blob(Fo, 0.03, 0.08, r.jersey);
        blob(K, 0.06, 0.06, shorts);
      };
      if (Math.sin(ph) > 0) { leg(1); leg(-1); } else { leg(-1); leg(1); }
      // Корпус.
      const shH = attack ? 1.26 + absorb : (standing ? 1.38 : 1.2 - tuck) + bob, shY = attack ? -0.3 : standing ? -0.33 : -0.24 - tuck * 0.6;
      const twist = standing ? Math.sin(ph) * 0.05 : Math.sin(ph) * 0.012;
      const jersey = r.jersey, jerseyD = window.Render.shade(r.jersey, 0.7);
      polyO([pt(-0.15, hipY + 0.04, hipH + 0.02), pt(0.15, hipY + 0.04, hipH + 0.02), pt(0.2 + twist, shY, shH), pt(-0.2 + twist, shY, shH)], jersey);
      poly([pt(0.06, hipY + 0.02, hipH + 0.04), pt(0.15, hipY + 0.02, hipH + 0.03), pt(0.2 + twist, shY + 0.02, shH), pt(0.11 + twist, shY + 0.02, shH + 0.01)], jerseyD);
      seg(pt(0, hipY - 0.04, hipH + 0.08), pt(twist, shY + 0.05, shH + 0.02), 0.04, 'rgba(255,255,255,0.55)');
      poly([pt(-0.15, hipY + 0.04, hipH + 0.02), pt(0.15, hipY + 0.04, hipH + 0.02), pt(0.155, hipY - 0.06, hipH + 0.06), pt(-0.155, hipY - 0.06, hipH + 0.06)], jerseyD);
      // Стартовый номер на спине.
      poly([pt(-0.08, hipY - 0.07, hipH + 0.08), pt(0.08, hipY - 0.07, hipH + 0.08), pt(0.085, hipY - 0.2, hipH + 0.15), pt(-0.085, hipY - 0.2, hipH + 0.15)], '#f7f7f7');
      seg(pt(-0.035, hipY - 0.11, hipH + 0.1), pt(-0.035, hipY - 0.17, hipH + 0.13), 0.02, '#222');
      seg(pt(0.02, hipY - 0.11, hipH + 0.1), pt(0.04, hipY - 0.17, hipH + 0.13), 0.02, '#222');
      // Руки к рулю (руль качается вместе с велосипедом).
      g.hands.forEach((h, i) => {
        const sgn = i ? 1 : -1;
        const sh = pt(0.19 * sgn + twist, shY + 0.03, shH - 0.02);
        const hand = bikePt(h[0], h[1], h[2]);
        const el = pt((attack ? 0.36 : 0.25) * sgn, (shY + h[1]) / 2 + 0.04, (shH + h[2]) / 2 - (attack ? 0.02 : 0.06));
        limb(sh, el, 0.085, jersey);
        seg(el, pt(0.25 * sgn, (shY + h[1]) / 2 + 0.06, (shH + h[2]) / 2 - 0.05), 0.09, '#f7f7f7');
        limb(el, hand, 0.065, skin);
        blob(hand, 0.04, 0.05, '#111214');
      });
      // Голова и шлем (слегка покачивается).
      const hx = twist * 1.2;
      blob(pt(hx, shY - 0.06, shH + 0.04), 0.05, 0.05, skin);
      const aero = t === 'tt';
      blob(aero ? pt(hx, shY - 0.05, shH + 0.1) : pt(hx, shY - 0.13, shH + 0.08), 0.12, aero ? 0.24 : 0.16, r.helmet);
      S.ctx.strokeStyle = 'rgba(0,0,0,0.3)'; S.ctx.lineWidth = Math.max(0.5, 0.018 * S.k);
      for (const vx of [-0.05, 0, 0.05]) {
        const a = pt(hx + vx, shY - 0.22, shH + 0.1), b = pt(hx + vx, shY - 0.03, shH + 0.1);
        S.ctx.beginPath(); S.ctx.moveTo(a[0], a[1]); S.ctx.lineTo(b[0], b[1]); S.ctx.stroke();
      }
      blob(pt(hx, shY - 0.26, shH + 0.06), 0.09, 0.03, '#0d0f12');
      if (t === 'dh') {
        // Фулфейс: подбородочная дуга и маска-очки.
        blob(pt(hx, shY - 0.25, shH - 0.02), 0.09, 0.06, r.helmet);
        blob(pt(hx, shY - 0.22, shH + 0.05), 0.1, 0.035, '#ffb703');
        blob(pt(hx, shY - 0.23, shH + 0.05), 0.07, 0.022, '#1d2b3a');
      }
      blob(pt(hx - 0.04, shY - 0.17, shH + 0.15), 0.045, 0.07, 'rgba(255,255,255,0.35)');
      return S;
    }

    // Бегун: фаза опоры и маха, подъём пятки, вертикальные колебания, работа рук.
    // opts.idle — стоит (в транзитной зоне), opts.pushBike — катит велосипед правой рукой.
    drawRunnerSprite(r, opts) {
      const o = opts || {};
      const S = this.spriteFrame(r, 1.22);
      if (!S) return null;
      const { seg, blob, poly, limb, polyO } = S;
      const ph = r.phase || 0;
      const skin = this.skinOf(r);
      const jersey = r.jersey, dark = window.Render.shade(r.jersey, 0.6);
      if (o.pushBike) this.drawBikeSprite(S, Object.assign({}, r, { pedal: 0.6 }), D.bikeById(r.bikeId), 0, 0.62);
      const bob = o.idle ? 0 : 0.045 * Math.cos(2 * ph);
      const leanF = o.idle ? 0 : 0.1;
      const pt = S.pt;
      blob(pt(0.22, 0.1, 0), 0.26, 0.5, 'rgba(0,0,0,0.24)');
      const legPose = (sgn) => {
        const a = ph + (sgn > 0 ? 0 : Math.PI);
        if (o.idle) return [0.11 * sgn, 0.02, 0.04];
        const fy = -Math.sin(a) * 0.46;
        const fh = 0.04 + Math.max(0, Math.cos(a)) * 0.38; // мах: пятка к ягодице
        return [0.1 * sgn, fy + 0.05, fh];
      };
      const leg = (sgn) => {
        const [fx, fy, fh] = legPose(sgn);
        const hip = [0.1 * sgn, 0.04, 0.95 + bob];
        const [ky, kh] = Renderer.ik(hip[1], hip[2], fy, fh, 0.47, 0.5);
        const H = pt(hip[0], hip[1], hip[2]), K = pt(0.11 * sgn, ky, kh), Fo = pt(fx, fy, fh);
        limb(H, K, 0.13, skin);
        limb(K, Fo, 0.095, skin);
        seg(pt(fx, fy + 0.02, fh + 0.12), Fo, 0.09, '#f2f2f2');
        blob(pt(fx, fy - 0.05, fh - 0.01), 0.068, 0.14, '#f5f5f5');
        blob(pt(fx, fy - 0.06, fh + 0.01), 0.055, 0.12, sgn > 0 ? '#22c46e' : '#e8399b');
      };
      // Дальняя (опорная, сзади) нога — первой.
      if (Math.sin(ph) > 0) { leg(1); leg(-1); } else { leg(-1); leg(1); }
      const hipH = 0.95 + bob, shH = 1.42 + bob;
      blob(pt(0, 0.04, hipH), 0.17, 0.13, '#15161a');
      polyO([pt(-0.16, 0.06, hipH), pt(0.16, 0.06, hipH), pt(0.19, 0.06 - leanF - 0.05, shH), pt(-0.19, 0.06 - leanF - 0.05, shH)], jersey);
      poly([pt(0.09, 0.06, hipH), pt(0.16, 0.06, hipH), pt(0.19, 0.06 - leanF - 0.05, shH), pt(0.12, 0.06 - leanF - 0.05, shH)], dark);
      poly([pt(-0.09, 0.03, hipH + 0.12), pt(0.09, 0.03, hipH + 0.12), pt(0.09, 0.0 - leanF * 0.5, hipH + 0.3), pt(-0.09, 0.0 - leanF * 0.5, hipH + 0.3)], '#ffffff');
      seg(pt(-0.14, 0.03, hipH + 0.17), pt(0.14, 0.03, hipH + 0.17), 0.015, dark);
      const shY = 0.01 - leanF - 0.05;
      for (const sgn of [-1, 1]) {
        const a = ph + (sgn > 0 ? Math.PI : 0); // руки в противофазе ногам
        const sh = pt(0.2 * sgn, shY, shH - 0.04);
        let el, hand;
        if (o.idle) {
          // Надевает шлем / снимает гидрокостюм.
          const w = Math.sin(r.phaseIdle || 0) * 0.08;
          el = pt(0.28 * sgn, shY + 0.02, shH + 0.05 + w);
          hand = pt(0.12 * sgn, shY - 0.05, shH + 0.32 + w);
        } else if (o.pushBike && sgn > 0) {
          el = pt(0.36, shY + 0.1, shH - 0.25);
          hand = pt(0.55, 0.1, 1.0);
        } else {
          const sw = Math.sin(a);
          el = pt(0.25 * sgn, shY + 0.18 + sw * 0.16, shH - 0.28);
          hand = pt(0.2 * sgn, shY - 0.05 + sw * 0.3, shH - 0.22 + Math.max(0, -sw) * 0.12);
        }
        limb(sh, el, 0.08, skin);
        limb(el, hand, 0.062, skin);
        blob(hand, 0.04, 0.045, skin);
      }
      const hy = shY - 0.05;
      blob(pt(0, hy, shH + 0.12), 0.07, 0.07, skin);
      blob(pt(0, hy - 0.02, shH + 0.26), 0.11, 0.13, skin);
      blob(pt(0, hy - 0.03, shH + 0.32), 0.12, 0.12, r.helmet);
      blob(pt(0, hy - 0.15, shH + 0.3), 0.12, 0.04, '#111');
      blob(pt(-0.04, hy - 0.06, shH + 0.36), 0.04, 0.05, 'rgba(255,255,255,0.35)');
      return S;
    }

    // Пловец кролем: вращение корпуса, высокий локоть на проносе, гребок под водой,
    // вдох на каждый второй цикл, шестиударная работа ног с пеной.
    drawSwimmerSprite(r) {
      const S = this.spriteFrame(r, 1.35);
      if (!S) return null;
      const { seg, blob, path, pt } = S;
      const ph = r.phase || 0;
      const skin = this.skinOf(r);
      const roll = Math.sin(ph) * 0.12;
      // Расходящиеся «усы» волны от головы и пенный след.
      S.path([pt(-0.12, -0.62, 0), pt(-0.34, -0.2, 0), pt(-0.5, 0.35, 0)], 0.035, 'rgba(255,255,255,0.18)');
      S.path([pt(0.12, -0.62, 0), pt(0.34, -0.2, 0), pt(0.5, 0.35, 0)], 0.035, 'rgba(255,255,255,0.18)');
      blob(pt(0, 0.3, -0.06), 0.25 - Math.abs(roll) * 0.4, 0.95, 'rgba(6,30,58,0.6)');
      blob(pt(roll * 0.5, 0.15, -0.02), 0.17, 0.5, window.Render.shade(r.jersey, 0.6));
      // Ноги: 3 удара на каждый гребок.
      for (const sgn of [-1, 1]) {
        const kick = Math.sin(ph * 3 + (sgn > 0 ? 0 : Math.PI));
        seg(pt(sgn * 0.09, 0.55, -0.04), pt(sgn * 0.1, 1.05, -0.02 + kick * 0.05), 0.08, 'rgba(226,179,145,0.55)');
        blob(pt(sgn * 0.1, 1.15, 0.02), 0.07 + Math.max(0, kick) * 0.06, 0.1 + Math.max(0, kick) * 0.08, 'rgba(255,255,255,0.85)');
      }
      // Слой воды поверх погружённого тела.
      blob(pt(0, 0.55, 0.0), 0.3, 0.75, 'rgba(45,125,175,0.35)');
      // Руки: a ∈ [0, π) — пронос над водой, [π, 2π) — гребок под водой.
      for (const sgn of [-1, 1]) {
        const a = ((ph + (sgn > 0 ? 0 : Math.PI)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const sh = pt(sgn * 0.2 + roll * sgn * 0.3, -0.22, 0.05 + roll * sgn * 0.6);
        if (a < Math.PI) {
          const t = a / Math.PI; // 0 — у бедра, 1 — вход в воду впереди
          const hand = pt(sgn * (0.26 - 0.06 * t), 0.15 - 1.05 * t, 0.06 + Math.sin(a) * 0.3);
          const el = pt(sgn * 0.36, -0.15 - 0.45 * t, 0.12 + Math.sin(a) * 0.48);
          path([sh, el, hand], 0.11, 'rgba(0,0,0,0.3)');
          path([sh, el, hand], 0.085, skin);
          blob(hand, 0.05, 0.065, skin);
          // Капли, стекающие с руки.
          if (t > 0.2 && t < 0.8) blob(pt(sgn * 0.3, 0.15 - 1.05 * t + 0.25, 0.04), 0.03, 0.03, 'rgba(255,255,255,0.8)');
          if (t > 0.85) blob(pt(sgn * 0.22, -0.9, 0.02), 0.12 * (t - 0.8) * 5, 0.08 * (t - 0.8) * 5, 'rgba(255,255,255,0.9)');
        } else {
          const t = (a - Math.PI) / Math.PI; // 0 — захват впереди, 1 — выход у бедра
          const hand = pt(sgn * (0.16 + 0.06 * Math.sin(t * Math.PI)), -0.9 + 1.05 * t, -0.18);
          const el = pt(sgn * 0.3, -0.45 + 0.4 * t, -0.08);
          path([sh, el, hand], 0.08, 'rgba(226,179,145,0.4)');
          if (t > 0.9) blob(pt(sgn * 0.24, 0.15, 0.02), 0.08, 0.06, 'rgba(255,255,255,0.75)');
        }
      }
      // Голова: на каждый второй цикл — поворот на вдох.
      const cyc = Math.floor(ph / (2 * Math.PI));
      const a0 = ((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const breathe = cyc % 2 === 0 && a0 > 0.3 && a0 < 1.5 ? Math.sin((a0 - 0.3) / 1.2 * Math.PI) : 0;
      const hx = breathe * 0.09 + roll * 0.2;
      blob(pt(hx, -0.5, 0.1), 0.12, 0.16, r.helmet);
      seg(pt(hx, -0.36, 0.11), pt(hx, -0.62, 0.11), 0.03, window.Render.shade(r.jersey, 1.1));
      blob(pt(hx - 0.04, -0.47, 0.14), 0.04, 0.06, 'rgba(255,255,255,0.4)');
      blob(pt(hx - 0.01, -0.6, 0.12), 0.1, 0.03, '#111');
      if (breathe > 0.4) blob(pt(hx + 0.1, -0.5, 0.08), 0.04, 0.05, skin);
      blob(pt(hx * 0.5, -0.68, 0.01), 0.2, 0.07, 'rgba(255,255,255,0.65)');
      return S;
    }

    drawLabel(r, base) {
      const ctx = this.ctx;
      // Подпись над соперниками / маркер игрока.
      const label = this.project(r.x, r.y, r.z + 2.5);
      if (label && base[2] > 14) {
        ctx.font = `600 ${Math.round(11 * this.dpr)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        if (r.isPlayer) {
          ctx.fillStyle = '#ffd400';
          ctx.beginPath();
          ctx.moveTo(label[0], label[1] + 6 * this.dpr); ctx.lineTo(label[0] - 6 * this.dpr, label[1] - 3 * this.dpr); ctx.lineTo(label[0] + 6 * this.dpr, label[1] - 3 * this.dpr);
          ctx.fill();
        } else {
          const txt = `${r.place}. ${r.name}`;
          const w = ctx.measureText(txt).width + 10 * this.dpr;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(label[0] - w / 2, label[1] - 14 * this.dpr, w, 17 * this.dpr);
          ctx.fillStyle = '#fff';
          ctx.fillText(txt, label[0], label[1]);
        }
      }
    }

    drawRider(r) {
      const ctx = this.ctx;
      if (r.airH > 0.05) {
        // В полёте тень остаётся на земле и уменьшается с высотой.
        const k = Math.max(0.35, 1 - r.airH / 8);
        ctx.globalAlpha = (r.ghost ? 0.5 : 1) * k;
        this.shadow(r.x, r.y, r.z - r.airH, 0.55 * k, 0.32 * k);
        ctx.globalAlpha = 1;
      }
      if (r.ghost) ctx.globalAlpha = 0.55;
      if (r.crash > 0) {
        // Падение: велосипед лежит на боку, гонщик поднимается рядом.
        const S0 = this.spriteFrame(r, 1.08);
        if (S0) this.drawBikeSprite(S0, Object.assign({}, r, { airH: 0 }), D.bikeById(r.bikeId), 1.45, 0.25);
        const off = { x: r.x + Math.sin(r.heading) * 0.7, y: r.y - Math.cos(r.heading) * 0.7 };
        const S = this.drawRunnerSprite(Object.assign({}, r, off, { phase: 0 }), { idle: true });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        if (S) this.drawLabel(r, S.base);
        return;
      }
      let S;
      if (r.mode === 'swim') S = this.drawSwimmerSprite(r);
      else if (r.mode === 'run') S = this.drawRunnerSprite(r, {});
      else if (r.mode === 'idle') S = this.drawRunnerSprite(r, { idle: true });
      else if (r.mode === 'push') S = this.drawRunnerSprite(r, { pushBike: true });
      else S = this.drawCyclist(r);
      ctx.globalAlpha = 1;
      if (!S) return;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.drawLabel(r, S.base);
    }
  }

  // Миникарта / превью трассы (вид сверху, y отражён, чтобы совпадать с видом из камеры).
  function drawTrackMap(ctx, track, w, h, opts) {
    const o = opts || {};
    const b = track.bounds;
    const pad = o.pad || 8;
    const sc = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY));
    const ox = (w - (b.maxX - b.minX) * sc) / 2, oy = (h - (b.maxY - b.minY) * sc) / 2;
    const tx = (x) => ox + (x - b.minX) * sc;
    const ty = (y) => h - (oy + (y - b.minY) * sc);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = o.outline || 'rgba(0,0,0,0.6)';
    ctx.lineWidth = (o.lw || 4) + 3;
    ctx.beginPath();
    track.samples.forEach((p, i) => { if (i === 0) ctx.moveTo(tx(p.x), ty(p.y)); else ctx.lineTo(tx(p.x), ty(p.y)); });
    if (!track.open) ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = o.lw || 4;
    for (let i = 0; i < track.N; i += 2) {
      if (track.open && i + 2 >= track.N) break;
      const p = track.samples[i], q = track.samples[(i + 2) % track.N];
      ctx.strokeStyle = o.mono || (p.surface === 'asphalt' ? '#9aa3ad' : D.SURFACES[p.surface].color);
      ctx.beginPath(); ctx.moveTo(tx(p.x), ty(p.y)); ctx.lineTo(tx(q.x), ty(q.y)); ctx.stroke();
    }
    const s0 = track.samples[0];
    ctx.fillStyle = '#fff';
    ctx.fillRect(tx(s0.x) - 3, ty(s0.y) - 3, 6, 6);
    if (track.open) {
      // Финиш внизу — клетчатый флажок.
      const f = track.samples[track.finishIdx];
      ctx.fillStyle = '#111'; ctx.fillRect(tx(f.x) - 4, ty(f.y) - 4, 8, 8);
      ctx.fillStyle = '#fff'; ctx.fillRect(tx(f.x) - 4, ty(f.y) - 4, 4, 4); ctx.fillRect(tx(f.x), ty(f.y), 4, 4);
    }
    return { tx, ty };
  }

  // Кадр трассы в 2.5D для карточек меню (рисуется один раз и кэшируется).
  const previewCache = {};
  function renderPreview(track, w, h, frac) {
    const key = `${track.def.id}|${w}x${h}`;
    if (previewCache[key]) return previewCache[key];
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const r = new Renderer(cv);
    r.W = w; r.Hs = h; r.dpr = 1;
    r.F = Math.min(h * 1.1, w * 0.95); r.cx = w / 2; r.cy = h * 0.66;
    const p = track.sampleAt(track.L * (frac != null ? frac : 0.3));
    const focus = { x: p.x, y: p.y, z: p.z, heading: p.ang, v: 14 };
    r.render({ track, riders: [], focus, particles: [], firstFrame: true, dt: 0.016 });
    previewCache[key] = cv.toDataURL('image/jpeg', 0.82);
    return previewCache[key];
  }

  window.Render = { Renderer, drawTrackMap, renderPreview, shade };
})();
