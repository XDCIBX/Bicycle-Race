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
      this.colorCache = {};
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      if (race.firstFrame) { c.z = t.z; c.a = t.heading; }
      let d = t.heading - c.a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      c.a += d * Math.min(1, race.dt * 4.5);
      const sp = Math.min(1, t.v / 28);
      c.B = 13 + sp * 4; c.H = 14.5 + sp * 3;
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
      ctx.fillStyle = track.env.ground;
      ctx.fillRect(0, 0, this.W, this.Hs);
      this.now = performance.now() / 1000;

      this.drawGround(track);
      this.drawLakes(track);
      this.drawDecals(track);
      this.drawRoad(track, race);
      this.drawParticles(race, true);

      // Объекты и гонщики, отсортированные от дальних к ближним.
      const list = [];
      const R2 = VIEW * VIEW;
      for (const o of track.objects) {
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
      if (race.focus && race.focus.sprinting) this.drawSpeedLines();

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

    // Неоднородная земля: мягкие пятна светлее/темнее основного цвета; на воде — блики волн.
    drawGround(track) {
      const c = this.cam, ctx = this.ctx;
      const CELL = 11, R = 125;
      const fx = c.x + c.ca * 40, fy = c.y + c.sa * 40;
      const x0 = Math.floor((fx - R) / CELL), x1 = Math.floor((fx + R) / CELL);
      const y0 = Math.floor((fy - R) / CELL), y1 = Math.floor((fy + R) / CELL);
      const water = track.env.water;
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          let h = Math.imul(gx * 374761393 + gy * 668265263, 1274126177) >>> 0;
          h = ((h ^ (h >>> 13)) >>> 0) / 4294967296;
          const cx = (gx + 0.5) * CELL + (h - 0.5) * 6, cy = (gy + 0.5) * CELL + ((h * 7) % 1 - 0.5) * 6;
          if ((cx - fx) ** 2 + (cy - fy) ** 2 > R * R) continue;
          if (water) {
            const z = 0;
            const ph = this.now * 1.3 + h * 20;
            const len = 1.5 + h * 2.5, ox = Math.sin(ph) * 0.8;
            const a = this.project(cx + ox - len, cy + Math.cos(ph) * 0.4, z), b = this.project(cx + ox + len, cy + Math.cos(ph) * 0.4, z);
            if (!a || !b) continue;
            ctx.strokeStyle = h > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(10,50,90,0.2)';
            ctx.lineWidth = Math.max(1, 0.25 * a[2]);
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.3 * a[2], b[0], b[1]); ctx.stroke();
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

    // Тени облаков медленно плывут по земле.
    drawClouds(track) {
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
      const R2 = 120 * 120;
      for (const d of track.decals) {
        const dx = d.x - c.x, dy = d.y - c.y;
        if (dx * dx + dy * dy > R2) continue;
        const p = this.project(d.x, d.y, d.z);
        if (!p) continue;
        const r = d.r * p[2];
        if (p[0] < -r || p[0] > this.W + r || p[1] < -r || p[1] > this.Hs + r) continue;
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
      for (const q of quads) this.drawRoadQuad(track, q.i, (q.i + STEP) % N, q.d, centerLine);
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
      if (env === 'city') {
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
        const rut = surf === 'snow' ? 'rgba(150,175,200,0.3)' : 'rgba(0,0,0,0.1)';
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
      // Стартовая клетка.
      if (i0 === 0) {
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
          const g = ctx.createRadialGradient(top[0] - r * 0.4, top[1] - r * 0.45, r * 0.1, top[0], top[1], r * 1.1);
          g.addColorStop(0, autumn ? '#ffd166' : '#7cc95a'); g.addColorStop(0.55, autumn ? '#e07a2f' : '#3f8a35'); g.addColorStop(1, autumn ? '#9a4b1c' : '#24561f');
          ctx.fillStyle = g;
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
          if (s > 10) this.planeText(o.x - ca * 0.6, o.y - sa * 0.6, o.x + ca * 0.6, o.y + sa * 0.6, o.z + 1.2, dist >= 1000 ? `${(dist / 1000).toFixed(1).replace('.0', '')} км` : `${dist} м`, 0.42, '#1b1b1b');
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
          const g = ctx.createRadialGradient(q[0] - r * 0.35 * q[2], q[1] - r * 0.35 * q[2], 1, q[0], q[1], r * q[2]);
          g.addColorStop(0, o.big ? '#ffd2a0' : '#fff6b0'); g.addColorStop(1, o.big ? '#f26b00' : '#e8c400');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0], q[1], r * q[2], 0, 7); ctx.fill();
          if (o.big) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(q[0] - r * q[2], q[1] - 0.1 * q[2], 2 * r * q[2], 0.2 * q[2]); }
          break;
        }
        case 'pontoon': {
          this.prism(o.x, o.y, 0, 6, 16, 0.35, o.ang, '#a0744a');
          const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
          ctx.strokeStyle = 'rgba(60,35,15,0.5)'; ctx.lineWidth = 1;
          for (let k = -7; k <= 7; k += 1) {
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
        case 'gantry': this.drawGantry(track); break;
        case 'building': this.drawBox(o, track, false); break;
        case 'house': this.drawBox(o, track, true); break;
        default: break;
      }
    }

    drawGantry(track) {
      const p = track.samples[0], hw = track.hw + 1.4;
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
      const col = palette[Math.floor(o.seed * palette.length)];
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

    // Гонщик: локальная аффинная проекция, поэтому велосипед корректно «лежит» на дороге.
    // Пловец кролем: тело под водой, голова в шапочке, гребки руками, брызги и кильватер.
    drawSwimmer(r, pt, k, seg, blob) {
      const ph = r.phase || 0;
      const skin = '#e2b391';
      // Кильватерный след.
      seg(pt(-0.2, 1.0, 0), pt(-0.45, 1.8, 0), 0.06, 'rgba(255,255,255,0.22)');
      seg(pt(0.2, 1.0, 0), pt(0.45, 1.8, 0), 0.06, 'rgba(255,255,255,0.22)');
      blob(pt(0, 0.35, -0.05), 0.24, 0.95, 'rgba(8,35,65,0.55)');
      blob(pt(0, 0.2, -0.02), 0.18, 0.5, window.Render.shade(r.jersey, 0.55));
      // Работа ног — пена.
      for (const sgn of [-1, 1]) blob(pt(sgn * 0.12, 1.25 + Math.sin(ph * 2 + sgn) * 0.08, 0.02), 0.09, 0.13, 'rgba(255,255,255,0.8)');
      // Руки: одна над водой (пронос), другая под водой (гребок).
      for (const sgn of [-1, 1]) {
        const a = ph + (sgn > 0 ? 0 : Math.PI);
        const sh = pt(sgn * 0.2, -0.25, 0.08);
        if (Math.sin(a) > 0) {
          const hand = pt(sgn * 0.28, -0.25 - 0.75 * (1 - Math.cos(a)) / 2, 0.15 + 0.4 * Math.sin(a));
          seg(sh, hand, 0.09, skin);
          blob(hand, 0.05, 0.06, skin);
        } else {
          const hand = pt(sgn * 0.16, -0.95 + 0.9 * (1 - Math.cos(a)) / 2, -0.1);
          seg(sh, hand, 0.09, 'rgba(226,179,145,0.45)');
          if (Math.cos(a) > 0.85) blob(pt(sgn * 0.2, -0.95, 0.03), 0.16, 0.1, 'rgba(255,255,255,0.9)');
        }
      }
      // Голова: шапочка и очки, поворот для вдоха.
      const turn = Math.sin(ph) > 0.85 ? 0.06 : 0;
      blob(pt(turn, -0.48, 0.12), 0.13, 0.16, r.helmet);
      blob(pt(turn - 0.02, -0.57, 0.14), 0.1, 0.03, '#111');
      blob(pt(turn, -0.62, 0.02), 0.18, 0.06, 'rgba(255,255,255,0.55)');
    }

    // Бегун: шаг с фазой, руки в противофазе, стартовый номер на спине.
    drawRunner(r, pt, k, seg, blob, poly) {
      const ph = r.phase || 0;
      const skin = '#e2b391';
      const jersey = r.jersey, dark = window.Render.shade(r.jersey, 0.6);
      blob(pt(0.25, 0.1, 0), 0.3, 0.55, 'rgba(0,0,0,0.22)');
      const leg = (sgn) => {
        const a = ph + (sgn > 0 ? 0 : Math.PI);
        const fy = -Math.sin(a) * 0.42, fh = Math.max(0, Math.cos(a)) * 0.28 + 0.05;
        const hip = pt(sgn * 0.1, 0.05, 0.92);
        const knee = pt(sgn * 0.11, fy * 0.5 - 0.12, 0.5 + fh * 0.6);
        const foot = pt(sgn * 0.11, fy, fh);
        seg(hip, knee, 0.12, skin);
        seg(knee, foot, 0.09, skin);
        blob(foot, 0.06, 0.12, sgn > 0 ? '#39ff88' : '#ff4fd8');
      };
      // Дальняя нога первой (та, что сзади по фазе).
      if (Math.sin(ph) > 0) { leg(1); leg(-1); } else { leg(-1); leg(1); }
      blob(pt(0, 0.04, 0.95), 0.17, 0.13, '#15161a');
      poly([pt(-0.16, 0.06, 0.95), pt(0.16, 0.06, 0.95), pt(0.19, -0.05, 1.42), pt(-0.19, -0.05, 1.42)], jersey);
      poly([pt(-0.09, 0.0, 1.07), pt(0.09, 0.0, 1.07), pt(0.09, -0.02, 1.25), pt(-0.09, -0.02, 1.25)], '#ffffff');
      seg(pt(-0.14, 0.02, 1.12), pt(0.14, 0.02, 1.12), 0.015, dark);
      for (const sgn of [-1, 1]) {
        const a = ph + (sgn > 0 ? Math.PI : 0);
        const sh = pt(sgn * 0.2, -0.05, 1.38);
        const el = pt(sgn * 0.24, -Math.sin(a) * 0.18, 1.12);
        const hand = pt(sgn * 0.2, -Math.sin(a) * 0.3 - 0.12, 1.15);
        seg(sh, el, 0.075, jersey);
        seg(el, hand, 0.06, skin);
      }
      blob(pt(0, -0.08, 1.55), 0.07, 0.07, skin);
      blob(pt(0, -0.1, 1.68), 0.11, 0.13, skin);
      blob(pt(0, -0.12, 1.75), 0.12, 0.12, r.helmet);
      blob(pt(0, -0.24, 1.72), 0.12, 0.04, '#111');
    }

    drawLabel(r, base) {
      const ctx = this.ctx;
      // Подпись над соперниками / маркер игрока.
      const label = this.project(r.x, r.y, r.z + 2.4);
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

    drawRider(r, race) {
      const ctx = this.ctx;
      const base = this.project(r.x, r.y, r.z);
      if (!base) return;
      const fx = Math.cos(r.heading), fy = Math.sin(r.heading);
      const pf = this.project(r.x + fx, r.y + fy, r.z);
      const pr = this.project(r.x + fy, r.y - fx, r.z);
      const pu = this.project(r.x, r.y, r.z + 1);
      if (!pf || !pr || !pu) return;
      const F = [pf[0] - base[0], pf[1] - base[1]], R = [pr[0] - base[0], pr[1] - base[1]], U = [pu[0] - base[0], pu[1] - base[1]];
      const bike = D.bikeById(r.bikeId);
      const t = bike.type;
      // Точка в локальных координатах гонщика (x — вправо, y — назад, h — высота, метры) → экран.
      const pt = (x, y, h) => [base[0] + R[0] * x - F[0] * y + U[0] * h, base[1] + R[1] * x - F[1] * y + U[1] * h];
      const k = Math.hypot(R[0], R[1]); // пикселей на метр
      const seg = (a, b, w, col) => {
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * k);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      };
      const blob = (c, rx, ry, col) => {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.ellipse(c[0], c[1], Math.max(0.5, rx * k), Math.max(0.5, ry * k), Math.atan2(-F[0], F[1]), 0, Math.PI * 2); ctx.fill();
      };
      const poly = (pts, col) => {
        ctx.fillStyle = col; ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath(); ctx.fill();
      };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (r.mode === 'swim' || r.mode === 'run') {
        if (r.mode === 'swim') this.drawSwimmer(r, pt, k, seg, blob, poly);
        else this.drawRunner(r, pt, k, seg, blob, poly);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.drawLabel(r, base);
        return;
      }
      const mtbLike = ['mtb', 'enduro', 'xc', 'fat', 'bmx'].includes(t);
      const tw = t === 'fat' ? 0.11 : mtbLike ? 0.06 : t === 'gravel' ? 0.042 : 0.028;
      const wheelD = t === 'folding' ? 0.42 : t === 'bmx' ? 0.52 : 0.7;
      const wb = t === 'folding' ? 0.52 : t === 'bmx' ? 0.48 : t === 'enduro' ? 0.62 : 0.5;
      const lean = (r.lean || 0) * 0.16;
      const tuck = t === 'tt' || t === 'aero' ? 0.14 : t === 'road' ? 0.06 : 0;
      const ph = r.pedal || 0;
      const rims = (bike.look && bike.look.rims) || 'alu';
      const rimCol = rims === 'alu' ? '#b9bec5' : '#33353a';

      // Мягкая тень.
      blob(pt(0.28, 0.25, 0), 0.38, 1.05, 'rgba(0,0,0,0.22)');
      // Колёса: покрышка + обод сверху.
      for (const wy of [-wb, wb]) {
        const a = pt(0, wy - wheelD / 2, wheelD / 2 * 0.15), b = pt(0, wy + wheelD / 2, wheelD / 2 * 0.15);
        seg(a, b, tw * 2.2, '#121214');
        seg(pt(0, wy - wheelD * 0.44, 0.06), pt(0, wy + wheelD * 0.44, 0.06), tw * (rims === 'alu' ? 0.7 : 1.1), rimCol);
      }
      // Задние перья, рама, вилка.
      const frame = bike.color, frameD = window.Render.shade(bike.color, 0.65);
      seg(pt(-0.06, wb, 0.33), pt(-0.03, 0.02, 0.3), 0.035, frameD);
      seg(pt(0.06, wb, 0.33), pt(0.03, 0.02, 0.3), 0.035, frameD);
      seg(pt(-0.05, wb, 0.36), pt(0, 0.12, 0.62), 0.03, frame);
      seg(pt(0.05, wb, 0.36), pt(0, 0.12, 0.62), 0.03, frame);
      seg(pt(0, 0.02, 0.3), pt(0, -wb + 0.12, 0.6), t === 'aero' || t === 'tt' || t === 'enduro' ? 0.075 : 0.06, frameD);
      seg(pt(0, 0.14, 0.64), pt(0, -wb + 0.1, 0.66), mtbLike ? 0.06 : 0.05, frame);
      seg(pt(0, 0.14, 0.64), pt(0, -wb + 0.1, 0.66), 0.015, 'rgba(255,255,255,0.35)');
      seg(pt(-0.05, -wb, 0.36), pt(0, -wb + 0.08, 0.6), 0.03, mtbLike && t !== 'fat' && t !== 'bmx' ? '#1a1a1d' : frame);
      seg(pt(0.05, -wb, 0.36), pt(0, -wb + 0.08, 0.6), 0.03, mtbLike && t !== 'fat' && t !== 'bmx' ? '#1a1a1d' : frame);
      // Звезда, шатуны и педали (вращаются).
      blob(pt(0.08, 0, 0.3), 0.02, 0.1, '#55595f');
      const pedalY = (sgn) => Math.cos(ph) * 0.17 * sgn, pedalH = (sgn) => 0.3 + Math.sin(ph) * 0.17 * sgn;
      const footL = pt(-0.13, pedalY(-1), pedalH(-1)), footR = pt(0.13, pedalY(1), pedalH(1));
      seg(pt(-0.1, 0, 0.3), footL, 0.025, '#2a2b2f');
      seg(pt(0.1, 0, 0.3), footR, 0.025, '#2a2b2f');

      // Ноги: бедро → колено → стопа (дальняя нога рисуется первой).
      const hipH = 0.98 - tuck * 0.3;
      const leg = (sgn) => {
        const foot = sgn < 0 ? footL : footR;
        const fy = pedalY(sgn), fh = pedalH(sgn);
        const hip = pt(0.1 * sgn + lean * 0.5, 0.2, hipH);
        const knee = pt(0.15 * sgn + lean * 0.4, -0.22 + fy * 0.4, (hipH + fh) / 2 + 0.12);
        seg(hip, knee, 0.13, '#17181b');
        seg(knee, foot, 0.095, '#e2b391');
        seg(pt(0.15 * sgn, -0.22 + fy * 0.6, fh + 0.15), foot, 0.08, '#f4f4f4');
        blob(foot, 0.055, 0.13, '#111214');
      };
      leg(-1); leg(1);

      // Седло и руль.
      poly([pt(-0.07 + lean * 0.3, 0.32, hipH - 0.02), pt(0.07 + lean * 0.3, 0.32, hipH - 0.02), pt(0.025, 0.08, hipH - 0.02), pt(-0.025, 0.08, hipH - 0.02)], '#151517');
      const barY = -wb + 0.06, barH = t === 'bmx' ? 1.05 : t === 'folding' ? 1.0 : mtbLike ? 0.92 : 0.86;
      seg(pt(0, -wb + 0.12, 0.66), pt(0, barY, barH), 0.04, '#1b1c1f');
      let handL, handR;
      if (t === 'tt') {
        seg(pt(-0.2, barY, barH), pt(0.2, barY, barH), 0.032, '#1b1c1f');
        seg(pt(-0.06, barY + 0.15, barH + 0.05), pt(-0.05, barY - 0.2, barH + 0.06), 0.03, '#1b1c1f');
        seg(pt(0.06, barY + 0.15, barH + 0.05), pt(0.05, barY - 0.2, barH + 0.06), 0.03, '#1b1c1f');
        handL = pt(-0.05, barY - 0.15, barH + 0.07); handR = pt(0.05, barY - 0.15, barH + 0.07);
      } else if (mtbLike || t === 'hybrid' || t === 'folding') {
        const bw = t === 'bmx' ? 0.34 : t === 'folding' ? 0.28 : t === 'hybrid' ? 0.31 : 0.39;
        seg(pt(-bw, barY + 0.03, barH), pt(bw, barY + 0.03, barH), 0.032, '#1b1c1f');
        seg(pt(-bw, barY + 0.03, barH), pt(-bw + 0.12, barY + 0.03, barH), 0.045, '#0d0d0f');
        seg(pt(bw - 0.12, barY + 0.03, barH), pt(bw, barY + 0.03, barH), 0.045, '#0d0d0f');
        if (t === 'bmx') seg(pt(-0.12, barY + 0.06, barH - 0.12), pt(0.12, barY + 0.06, barH - 0.12), 0.02, '#c9ccd1');
        handL = pt(-bw + 0.06, barY + 0.03, barH + 0.02); handR = pt(bw - 0.06, barY + 0.03, barH + 0.02);
      } else {
        // Барашек: верхний хват и «рожки» с ручками.
        seg(pt(-0.2, barY + 0.04, barH), pt(0.2, barY + 0.04, barH), 0.032, '#151515');
        seg(pt(-0.2, barY + 0.04, barH), pt(-0.21, barY - 0.1, barH - 0.02), 0.032, '#151515');
        seg(pt(0.2, barY + 0.04, barH), pt(0.21, barY - 0.1, barH - 0.02), 0.032, '#151515');
        blob(pt(-0.21, barY - 0.08, barH + 0.02), 0.025, 0.05, '#2b2c30');
        blob(pt(0.21, barY - 0.08, barH + 0.02), 0.025, 0.05, '#2b2c30');
        handL = pt(-0.21, barY - 0.07, barH + 0.04); handR = pt(0.21, barY - 0.07, barH + 0.04);
      }

      // Корпус с наклоном вперёд.
      const shH = 1.2 - tuck, shY = -0.24 - tuck * 0.6;
      const jersey = r.jersey, jerseyD = window.Render.shade(r.jersey, 0.7);
      poly([pt(-0.15 + lean, 0.24, hipH + 0.02), pt(0.15 + lean, 0.24, hipH + 0.02), pt(0.2 + lean * 1.4, shY, shH), pt(-0.2 + lean * 1.4, shY, shH)], jersey);
      poly([pt(0.06 + lean, 0.22, hipH + 0.04), pt(0.15 + lean, 0.22, hipH + 0.03), pt(0.2 + lean * 1.4, shY + 0.02, shH), pt(0.11 + lean * 1.4, shY + 0.02, shH + 0.01)], jerseyD);
      seg(pt(lean * 1.2, 0.16, hipH + 0.08), pt(lean * 1.4, shY + 0.05, shH + 0.02), 0.04, 'rgba(255,255,255,0.55)');
      poly([pt(-0.15 + lean, 0.24, hipH + 0.02), pt(0.15 + lean, 0.24, hipH + 0.02), pt(0.155 + lean, 0.14, hipH + 0.06), pt(-0.155 + lean, 0.14, hipH + 0.06)], jerseyD);
      // Руки: плечо → локоть → кисть.
      const arm = (sgn, hand) => {
        const sh = pt(0.19 * sgn + lean * 1.4, shY + 0.03, shH - 0.02);
        const el = pt(0.24 * sgn + lean, shY - 0.2, shH - 0.12);
        seg(sh, el, 0.085, jersey);
        seg(el, hand, 0.065, '#e2b391');
        blob(hand, 0.04, 0.05, '#111214');
      };
      arm(-1, handL); arm(1, handR);
      // Голова и шлем.
      const head = pt(lean * 1.5, shY - 0.13, shH + 0.08);
      blob(pt(lean * 1.5, shY - 0.06, shH + 0.04), 0.05, 0.05, '#e2b391');
      const aeroHelmet = t === 'tt';
      blob(aeroHelmet ? pt(lean * 1.5, shY - 0.05, shH + 0.1) : head, 0.12, aeroHelmet ? 0.24 : 0.16, r.helmet);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(0.5, 0.018 * k);
      for (const vx of [-0.05, 0, 0.05]) {
        const a = pt(lean * 1.5 + vx, shY - 0.22, shH + 0.1), b = pt(lean * 1.5 + vx, shY - 0.03, shH + 0.1);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      blob(pt(lean * 1.5, shY - 0.26, shH + 0.06), 0.09, 0.03, '#0d0f12');
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      this.drawLabel(r, base);
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
    ctx.closePath(); ctx.stroke();
    ctx.lineWidth = o.lw || 4;
    for (let i = 0; i < track.N; i += 2) {
      const p = track.samples[i], q = track.samples[(i + 2) % track.N];
      ctx.strokeStyle = o.mono || (p.surface === 'asphalt' ? '#9aa3ad' : D.SURFACES[p.surface].color);
      ctx.beginPath(); ctx.moveTo(tx(p.x), ty(p.y)); ctx.lineTo(tx(q.x), ty(q.y)); ctx.stroke();
    }
    const s0 = track.samples[0];
    ctx.fillStyle = '#fff';
    ctx.fillRect(tx(s0.x) - 3, ty(s0.y) - 3, 6, 6);
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
