// Реалистичная отрисовка велосипеда сбоку (SVG) по настоящей геометрии рамы:
// стек/рич, углы рулевой и подседельной труб, длина перьев, вынос вилки.
// Трубы с объёмной заливкой и бликом, спицы с перекрёстной шнуровкой,
// трансмиссия, тормозные роторы, вилки (жёсткие и амортизационные), рули разных типов
// и декали бренда на раме и ободах.
(function () {
  'use strict';
  const D = window.GameData;

  // ── Векторная математика (координаты в мм, ось Y вверх) ─────────────
  const V = (x, y) => ({ x, y });
  const add = (a, b) => V(a.x + b.x, a.y + b.y);
  const sub = (a, b) => V(a.x - b.x, a.y - b.y);
  const mul = (a, k) => V(a.x * k, a.y * k);
  const len = (a) => Math.hypot(a.x, a.y);
  const norm = (a) => mul(a, 1 / (len(a) || 1));
  const lerp = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  const rad = (deg) => deg * Math.PI / 180;
  const f = (n) => Math.round(n * 10) / 10;
  const P = (p) => `${f(p.x)},${f(-p.y)}`; // в координаты SVG (ось Y вниз)

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (k > 1) { // осветление к белому, чтобы блик был заметен и на тёмных рамах
      const t = Math.min(1, k - 1);
      r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t;
    } else { r *= k; g *= k; b *= k; }
    const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  // Геометрия по типам (мм). rim — радиус посадки обода (ISO/2), tire — ширина покрышки.
  const GEO = {
    road: { rim: 311, tire: 26, cs: 408, drop: 70, ha: 73.2, sa: 73.5, stack: 560, reach: 392, ht: 150, rake: 45, st: 500, saddle: 740, bar: 'drop', tubes: [30, 46, 34, 16, 20, 46] },
    aero: { rim: 311, tire: 26, cs: 410, drop: 72, ha: 73.0, sa: 73.5, stack: 555, reach: 395, ht: 145, rake: 45, st: 500, saddle: 740, bar: 'drop', tubes: [34, 58, 44, 18, 22, 54], aero: true },
    tt: { rim: 311, tire: 25, cs: 405, drop: 72, ha: 73.0, sa: 78, stack: 510, reach: 430, ht: 110, rake: 50, st: 480, saddle: 730, bar: 'tt', tubes: [36, 64, 50, 18, 22, 58], aero: true },
    gravel: { rim: 311, tire: 42, cs: 425, drop: 72, ha: 71.5, sa: 73.5, stack: 590, reach: 382, ht: 165, rake: 50, st: 500, saddle: 725, bar: 'drop', tubes: [32, 48, 34, 16, 22, 48] },
    hybrid: { rim: 311, tire: 36, cs: 440, drop: 70, ha: 71, sa: 73, stack: 615, reach: 392, ht: 170, rake: 50, st: 470, saddle: 715, bar: 'flat', tubes: [36, 46, 32, 18, 22, 46] },
    mtb: { rim: 292, tire: 56, cs: 435, drop: 50, ha: 68, sa: 74, stack: 620, reach: 430, ht: 110, rake: 44, st: 420, saddle: 700, bar: 'riser', fork: 100, tubes: [40, 54, 34, 18, 24, 56] },
    xc: { rim: 311, tire: 56, cs: 430, drop: 55, ha: 67.5, sa: 75, stack: 610, reach: 440, ht: 100, rake: 44, st: 420, saddle: 710, bar: 'flat', fork: 110, rear: 'xc', tubes: [42, 60, 38, 18, 26, 58] },
    enduro: { rim: 311, tire: 62, cs: 442, drop: 30, ha: 64.5, sa: 76.5, stack: 630, reach: 470, ht: 110, rake: 44, st: 420, saddle: 700, bar: 'riser', fork: 150, rear: 'enduro', tubes: [44, 64, 40, 20, 30, 60] },
    fat: { rim: 280, tire: 110, cs: 455, drop: 40, ha: 69, sa: 73, stack: 620, reach: 410, ht: 120, rake: 50, st: 430, saddle: 700, bar: 'riser', tubes: [40, 54, 36, 22, 28, 56] },
    bmx: { rim: 203, tire: 58, cs: 340, drop: -20, ha: 74.5, sa: 71, stack: 250, reach: 410, ht: 115, rake: 28, st: 230, saddle: 300, bar: 'bmx', tubes: [34, 38, 30, 18, 20, 44] },
    folding: { rim: 174, tire: 35, cs: 470, drop: -55, ha: 72, sa: 72, stack: 470, reach: 470, ht: 130, rake: 30, st: 380, saddle: 740, bar: 'brompton', tubes: [52, 0, 36, 16, 20, 44] },
  };

  const RIM_BRAND = {
    Specialized: 'ROVAL', Giant: 'CADEX', Canyon: 'DT SWISS', 'Cervélo': 'RESERVE', Pinarello: 'PRINCETON',
    Colnago: 'ENVE', Bianchi: 'VISION', Cannondale: 'HOLLOWGRAM', Orbea: 'OQUO', Scott: 'SYNCROS', Trek: 'BONTRAGER',
  };
  const FORK_BRAND = { enduro: 'FOX 36', xc: 'ROCKSHOX SID', mtb: 'ROCKSHOX' };

  function build(bike, wheelId) {
    const g = Object.assign({}, GEO[bike.type] || GEO.road);
    const wheel = D.WHEELS[wheelId || bike.stockWheel];
    const look = bike.look || {};
    // Ширина покрышки зависит от установленных колёс.
    const tireBySize = { road: 27, gravel: 42, mtb: 58, fat: 110, bmx: 58, folding: 35 };
    if (wheel && tireBySize[wheel.size]) g.tire = tireBySize[wheel.size] + (/2\.5|4\.6|45/.test(wheel.name) ? 6 : 0);
    const rimKind = wheel && wheel.size === 'road' && /Zipp/.test(wheel.name) ? 'carbon58' : look.rims || 'alu';

    const defs = [];
    const out = [];
    let gid = 0;
    const frame = bike.color, accent = bike.accent || '#222', decal = bike.decal || '#fff';

    // ── Ключевые точки рамы ──
    const B = V(0, 0);
    const R = V(-Math.sqrt(g.cs * g.cs - g.drop * g.drop), g.drop);
    const H = V(g.reach, g.stack);
    const dHead = V(Math.cos(rad(g.ha)), -Math.sin(rad(g.ha))); // вниз по рулевой
    const HB = add(H, mul(dHead, g.ht));
    const rakeDir = V(Math.sin(rad(g.ha)), Math.cos(rad(g.ha)));
    const a2c = (HB.y + g.rake * rakeDir.y - g.drop) / Math.sin(rad(g.ha));
    const crownEnd = add(HB, mul(dHead, a2c));
    const F = add(crownEnd, mul(rakeDir, g.rake));
    const dSeat = V(-Math.cos(rad(g.sa)), Math.sin(rad(g.sa)));
    const T = add(B, mul(dSeat, g.st));
    const S = add(B, mul(dSeat, g.saddle));
    const wheelR = g.rim + g.tire;
    const groundY = g.drop - wheelR;

    // ── Примитивы ──
    function tubeGrad(p1, n, w, color) {
      const id = `t${gid++}`;
      const a = add(p1, mul(n, w / 2)), b = sub(p1, mul(n, w / 2));
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(a.x)}" y1="${f(-a.y)}" x2="${f(b.x)}" y2="${f(-b.y)}">
        <stop offset="0" stop-color="${shade(color, 1.42)}"/><stop offset=".22" stop-color="${shade(color, 1.12)}"/>
        <stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, 0.5)}"/></linearGradient>`);
      return id;
    }
    function tube(p1, p2, w1, w2, color, opt) {
      const o = opt || {};
      const dir = norm(sub(p2, p1));
      let n = V(-dir.y, dir.x);
      if (n.y < 0) n = mul(n, -1);
      const id = tubeGrad(lerp(p1, p2, 0.5), n, (w1 + w2) / 2, color);
      const pts = [add(p1, mul(n, w1 / 2)), add(p2, mul(n, w2 / 2)), sub(p2, mul(n, w2 / 2)), sub(p1, mul(n, w1 / 2))];
      let s = `<path d="M${P(pts[0])} L${P(pts[1])} L${P(pts[2])} L${P(pts[3])} Z" fill="url(#${id})"/>`;
      if (!o.flat) {
        s = `<circle cx="${f(p1.x)}" cy="${f(-p1.y)}" r="${f(w1 / 2)}" fill="url(#${id})"/><circle cx="${f(p2.x)}" cy="${f(-p2.y)}" r="${f(w2 / 2)}" fill="url(#${id})"/>` + s;
      }
      // Глянцевый блик вдоль трубы.
      const h1 = add(p1, mul(n, w1 * 0.26)), h2 = add(p2, mul(n, w2 * 0.26));
      s += `<line x1="${f(h1.x)}" y1="${f(-h1.y)}" x2="${f(h2.x)}" y2="${f(-h2.y)}" stroke="#fff" stroke-opacity="${o.matte ? 0.1 : 0.28}" stroke-width="${f(Math.min(w1, w2) * 0.12)}" stroke-linecap="round"/>`;
      out.push(s);
    }
    function circle(c, r, attrs) { return `<circle cx="${f(c.x)}" cy="${f(-c.y)}" r="${f(r)}" ${attrs}/>`; }
    function line(a, b, attrs) { return `<line x1="${f(a.x)}" y1="${f(-a.y)}" x2="${f(b.x)}" y2="${f(-b.y)}" ${attrs}/>`; }
    function textAlong(p1, p2, t, txt, size, color, opt) {
      const o = opt || {};
      const c = lerp(p1, p2, t);
      let ang = Math.atan2(-(p2.y - p1.y), p2.x - p1.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      return `<text x="${f(c.x)}" y="${f(-c.y)}" transform="rotate(${f(ang)} ${f(c.x)} ${f(-c.y)})" font-family="'Arial Black','Helvetica Neue',Arial,sans-serif" font-weight="900" ${o.italic ? 'font-style="italic"' : ''} font-size="${f(size)}" letter-spacing="${f(size * (o.ls != null ? o.ls : 0.08))}" fill="${color}" text-anchor="middle" dominant-baseline="central">${txt}</text>`;
    }

    // ── Колесо ──
    function wheelSvg(c, front, disc) {
      const s = [];
      const r = g.rim, tw = g.tire;
      const hasDisc = !['bmx', 'folding'].includes(bike.type);
      // Тормозной ротор (за спицами).
      if (hasDisc && !disc) {
        const rr = front ? 80 : 70;
        s.push(circle(c, rr, `fill="none" stroke="#a7adb5" stroke-width="9"`));
        s.push(circle(c, rr, `fill="none" stroke="#6b7078" stroke-width="2" stroke-dasharray="6 9"`));
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * Math.PI * 2;
          s.push(line(add(c, V(Math.cos(a) * 18, Math.sin(a) * 18)), add(c, V(Math.cos(a) * (rr - 4), Math.sin(a) * (rr - 4))), `stroke="#8d939b" stroke-width="7" stroke-linecap="round"`));
        }
      }
      const depth = disc ? r : rimKind === 'alu' ? 22 : rimKind === 'carbon30' ? 32 : rimKind === 'carbon50' ? 50 : 58;
      const carbon = rimKind !== 'alu';
      if (disc) {
        const id = `d${gid++}`;
        defs.push(`<radialGradient id="${id}" cx=".38" cy=".35" r=".8"><stop offset="0" stop-color="#4a4d55"/><stop offset=".6" stop-color="#1e2024"/><stop offset="1" stop-color="#0c0d0f"/></radialGradient>`);
        s.push(circle(c, r, `fill="url(#${id})"`));
        s.push(`<text x="${f(c.x)}" y="${f(-c.y + 70)}" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="46" letter-spacing="6" fill="#e9e9e9" fill-opacity=".85" text-anchor="middle">ZIPP</text>`);
        s.push(`<text x="${f(c.x)}" y="${f(-c.y + 112)}" font-family="Arial,sans-serif" font-weight="700" font-size="22" letter-spacing="4" fill="#bbb" text-anchor="middle">SUPER-9 DISC</text>`);
      } else {
        // Спицы: перекрёстная (тангенциальная) шнуровка.
        const n = carbon ? 24 : 28;
        const inner = r - depth;
        for (let k = 0; k < n; k++) {
          const a = k / n * Math.PI * 2;
          const side = k % 2 ? 1 : -1;
          const hub = add(c, V(Math.cos(a + side * 0.6) * 24, Math.sin(a + side * 0.6) * 24));
          const rimP = add(c, V(Math.cos(a) * inner, Math.sin(a) * inner));
          s.push(line(hub, rimP, `stroke="${carbon ? '#2b2d31' : '#c9cdd3'}" stroke-width="${carbon ? 2.6 : 1.7}"`));
        }
      }
      // Обод.
      if (!disc) {
        const id = `r${gid++}`;
        if (carbon) defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3c42"/><stop offset=".5" stop-color="#17181b"/><stop offset="1" stop-color="#2a2c31"/></linearGradient>`);
        else defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef0f3"/><stop offset=".45" stop-color="#a9aeb6"/><stop offset="1" stop-color="#d8dbe0"/></linearGradient>`);
        s.push(circle(c, r - depth / 2, `fill="none" stroke="url(#${id})" stroke-width="${depth}"`));
        s.push(circle(c, r - 1, `fill="none" stroke="${carbon ? '#55585f' : '#7d838b'}" stroke-width="3"`));
        if (carbon && depth >= 30) {
          const txt = rimKind === 'carbon58' ? 'ZIPP 404' : RIM_BRAND[bike.brand] || bike.brand.toUpperCase();
          const pid = `p${gid++}`;
          const rr = r - depth / 2;
          defs.push(`<path id="${pid}" d="M${f(c.x - rr)},${f(-c.y)} a${f(rr)},${f(rr)} 0 1,1 ${f(rr * 2)},0 a${f(rr)},${f(rr)} 0 1,1 ${f(-rr * 2)},0"/>`);
          [0.05, 0.55].forEach((off) => {
            s.push(`<text font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="${f(depth * 0.5)}" letter-spacing="${f(depth * 0.12)}" fill="#f2f2f2" fill-opacity=".9" dominant-baseline="central"><textPath href="#${pid}" startOffset="${off * 100}%">${txt}</textPath></text>`);
          });
        }
      }
      // Покрышка.
      s.push(circle(c, r + tw / 2, `fill="none" stroke="#151515" stroke-width="${tw}"`));
      if (look.gumwall && tw < 60) s.push(circle(c, r + tw * 0.28, `fill="none" stroke="#b8925a" stroke-width="${f(tw * 0.42)}"`));
      if (tw >= 40) {
        const knob = tw >= 90 ? '16 12' : '9 8';
        s.push(circle(c, r + tw - 4, `fill="none" stroke="#0a0a0a" stroke-width="${tw >= 90 ? 16 : 9}" stroke-dasharray="${knob}"`));
        s.push(circle(c, r + tw * 0.62, `fill="none" stroke="#262626" stroke-width="2" stroke-dasharray="5 7"`));
      } else {
        s.push(circle(c, r + tw - 2, `fill="none" stroke="#2d2d2d" stroke-width="1.6"`));
      }
      s.push(circle(c, r + tw * 0.5, `fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="${f(tw * 0.3)}"`));
      // Втулка и ось.
      s.push(circle(c, 26, `fill="#232428"`));
      s.push(circle(c, 13, `fill="#b9bec5"`));
      s.push(circle(c, 5, `fill="#3b3e44"`));
      return s.join('');
    }

    // Тень и пол.
    const span = [R.x - wheelR, F.x + wheelR];
    out.push(`<ellipse cx="${f((span[0] + span[1]) / 2)}" cy="${f(-groundY + 6)}" rx="${f((span[1] - span[0]) / 2 + 30)}" ry="22" fill="url(#shadow)"/>`);
    defs.push(`<radialGradient id="shadow"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`);

    // Дальний шатун (за рамой).
    const crankA = rad(-62), crankL = bike.type === 'bmx' ? 175 : bike.type === 'folding' ? 165 : 172;
    const pedal1 = add(B, V(Math.cos(crankA) * crankL, Math.sin(crankA) * crankL));
    const pedal2 = sub(B, V(Math.cos(crankA) * crankL, Math.sin(crankA) * crankL));
    out.push(line(B, pedal2, `stroke="#2a2b2f" stroke-width="20" stroke-linecap="round"`));
    out.push(`<rect x="${f(pedal2.x - 45)}" y="${f(-pedal2.y - 9)}" width="90" height="18" rx="6" fill="#1d1e21"/>`);

    // Колёса.
    out.push(wheelSvg(R, false, rimKind === 'disc'));
    out.push(wheelSvg(F, true, false));

    const [wTT, wDT, wST, wSS, wCS, wHT] = g.tubes;
    const matte = /^#1|^#2/.test(frame);

    // ── Задний треугольник / подвеска ──
    if (g.rear === 'enduro' || g.rear === 'xc') {
      const pivot = add(B, V(-40, 70));
      tube(R, pivot, wCS * 0.8, wCS, frame, { matte });
      const rockerP = add(T, mul(dSeat, -120));
      const ssTop = add(rockerP, V(-30, 20));
      tube(R, ssTop, wSS, wSS * 1.2, frame, { matte });
    } else if (bike.type === 'folding') {
      const pivot = add(B, V(-20, 40));
      tube(R, pivot, wCS, wCS * 1.2, frame);
      tube(R, add(B, mul(dSeat, 140)), wSS, wSS, frame);
    } else {
      tube(R, B, wCS * 0.8, wCS, frame, { matte });
      tube(R, add(T, mul(dSeat, -18)), wSS * 0.85, wSS, frame, { matte });
    }
    // Дропаут и тормозной калипер сзади.
    out.push(circle(R, 18, `fill="${shade(frame, 0.6)}"`));

    // ── Трансмиссия (кассета, цепь, переключатель) ──
    const ringR = bike.type === 'bmx' ? 75 : g.rear || bike.type === 'mtb' || bike.type === 'fat' ? 72 : 100;
    const cogR = bike.type === 'bmx' ? 34 : bike.type === 'folding' ? 30 : 52;
    const single = ['bmx', 'folding'].includes(bike.type);
    if (!single) {
      [cogR, cogR * 0.82, cogR * 0.64, cogR * 0.47].forEach((rr) => out.push(circle(R, rr, `fill="none" stroke="#9097a0" stroke-width="5"`)));
    } else out.push(circle(R, cogR, `fill="none" stroke="#9097a0" stroke-width="6"`));
    const jockey1 = add(R, V(8, -62)), jockey2 = add(R, V(-12, -112));
    const ringTop = add(B, V(0, ringR)), ringBot = add(B, V(0, -ringR));
    out.push(line(ringTop, add(R, V(0, cogR)), `stroke="#3c3f45" stroke-width="7" stroke-dasharray="7 3"`));
    if (!single) {
      out.push(`<path d="M${P(ringBot)} L${P(jockey2)} L${P(jockey1)} L${P(add(R, V(4, -cogR)))}" fill="none" stroke="#3c3f45" stroke-width="7" stroke-dasharray="7 3"/>`);
      // Задний переключатель.
      out.push(`<path d="M${P(add(R, V(-6, -10)))} L${P(add(R, V(26, -40)))} L${P(jockey1)}" fill="none" stroke="#1f2124" stroke-width="16" stroke-linejoin="round" stroke-linecap="round"/>`);
      out.push(`<path d="M${P(jockey1)} L${P(jockey2)}" stroke="#2c2f34" stroke-width="22" stroke-linecap="round"/>`);
      out.push(circle(jockey1, 12, `fill="#606770"`) + circle(jockey2, 12, `fill="#606770"`));
      out.push(circle(add(R, V(22, -36)), 8, `fill="${accent}"`));
    } else {
      out.push(line(ringBot, add(R, V(0, -cogR)), `stroke="#3c3f45" stroke-width="7" stroke-dasharray="7 3"`));
    }

    // ── Основные трубы ──
    if (bike.type === 'folding') {
      // Brompton: изогнутая главная труба, шарнир, длинный подседел.
      const mainEnd = add(B, mul(dSeat, 330));
      const mid = add(lerp(HB, mainEnd, 0.5), V(0, 60));
      const id = tubeGrad(mid, V(0, 1), wTT, frame);
      out.push(`<path d="M${P(add(HB, mul(dHead, -20)))} Q${P(mid)} ${P(mainEnd)}" fill="none" stroke="url(#${id})" stroke-width="${wTT}" stroke-linecap="round"/>`);
      out.push(circle(lerp(HB, mainEnd, 0.5), 30, `fill="#2a2b2f"`) + circle(lerp(HB, mainEnd, 0.5), 12, `fill="#c4c8ce"`));
      tube(B, add(B, mul(dSeat, 360)), wST, wST, frame);
      out.push(textAlong(add(HB, mul(dHead, -20)), mainEnd, 0.3, 'BROMPTON', wTT * 0.48, decal));
    } else {
      tube(B, add(T, mul(dSeat, 10)), wST * 1.05, wST, frame, { matte });
      tube(B, add(HB, mul(dHead, -28)), wDT, wDT * 0.92, frame, { matte });
      tube(add(T, mul(dSeat, -6)), add(H, mul(dHead, 22)), wTT * 0.9, wTT, frame, { matte });
    }
    // Рулевая труба.
    tube(add(H, mul(dHead, -6)), add(HB, mul(dHead, 6)), wHT, wHT * 1.08, frame, { flat: true, matte });
    out.push(line(add(H, mul(dHead, 10)), add(HB, mul(dHead, -10)), `stroke="${accent}" stroke-width="${f(wHT * 0.25)}" stroke-opacity=".9"`));
    // Каретка.
    out.push(circle(B, 28, `fill="${shade(frame, 0.7)}"`));

    // Амортизатор (эндуро) / скрытый (XC).
    if (g.rear === 'enduro') {
      const top = add(T, mul(dSeat, -120)), mount = lerp(B, HB, 0.32);
      out.push(line(mount, lerp(mount, top, 0.55), `stroke="#151618" stroke-width="34" stroke-linecap="round"`));
      out.push(line(lerp(mount, top, 0.5), top, `stroke="#f2c230" stroke-width="22" stroke-linecap="round"`));
      out.push(textAlong(mount, top, 0.25, 'FOX', 16, '#f2c230'));
      tube(top, add(top, V(70, 30)), 26, 22, shade(frame, 0.8));
    }
    if (g.rear === 'xc') out.push(circle(add(B, V(-40, 70)), 12, `fill="#2c2e33"`) + circle(add(T, mul(dSeat, -120)), 10, `fill="#2c2e33"`));

    // Декали на раме.
    if (bike.type !== 'folding') {
      const dtA = B, dtB = add(HB, mul(dHead, -28));
      out.push(textAlong(dtA, dtB, 0.56, bike.brand.toUpperCase(), Math.min(wDT * 0.56, 34), decal, { italic: ['Pinarello', 'Canyon', 'Cervélo'].includes(bike.brand) }));
      const tA = add(T, mul(dSeat, -6)), tB = add(H, mul(dHead, 22));
      out.push(textAlong(tA, tB, 0.5, bike.model.toUpperCase(), Math.min(wTT * 0.42, 15), shade(decal === '#ffffff' ? '#ffffff' : decal, 0.95), { ls: 0.18 }));
      // Акцентная полоса на подседельной трубе.
      out.push(line(add(B, mul(dSeat, g.st * 0.62)), add(B, mul(dSeat, g.st * 0.78)), `stroke="${accent}" stroke-width="${f(wST * 0.92)}"`));
    }

    // ── Вилка ──
    if (g.fork) {
      const crown = add(HB, mul(dHead, 14));
      const stEnd = add(HB, mul(dHead, g.fork * 0.9 + 40));
      const sid = `s${gid++}`;
      const n = V(-dHead.y, dHead.x);
      const a = add(crown, mul(n, 18)), b = sub(crown, mul(n, 18));
      const gold = g.rear === 'enduro';
      defs.push(`<linearGradient id="${sid}" gradientUnits="userSpaceOnUse" x1="${f(a.x)}" y1="${f(-a.y)}" x2="${f(b.x)}" y2="${f(-b.y)}"><stop offset="0" stop-color="${gold ? '#fff2b8' : '#ffffff'}"/><stop offset=".45" stop-color="${gold ? '#d9a521' : '#b7bcc4'}"/><stop offset="1" stop-color="${gold ? '#7a5a0e' : '#5d636b'}"/></linearGradient>`);
      out.push(line(crown, stEnd, `stroke="url(#${sid})" stroke-width="34" stroke-linecap="round"`));
      out.push(`<path d="M${P(add(stEnd, mul(dHead, -30)))} L${P(F)}" stroke="#141517" stroke-width="46" stroke-linecap="round"/>`);
      out.push(line(add(stEnd, mul(dHead, -30)), F, `stroke="#fff" stroke-opacity=".12" stroke-width="6"`));
      out.push(textAlong(add(stEnd, mul(dHead, -10)), F, 0.45, FORK_BRAND[bike.type] || 'ROCKSHOX', 15, gold ? '#f2c230' : '#e33', { ls: 0.12 }));
      out.push(`<rect x="${f(crown.x - 34)}" y="${f(-crown.y - 14)}" width="68" height="28" rx="10" fill="#18191c" transform="rotate(${f(90 - g.ha)} ${f(crown.x)} ${f(-crown.y)})"/>`);
    } else {
      const crown = add(HB, mul(dHead, 6));
      const ctrl = add(lerp(crown, F, 0.55), mul(rakeDir, g.rake * 0.6));
      const id = tubeGrad(lerp(crown, F, 0.5), V(-dHead.y, dHead.x), 30, bike.type === 'fat' || bike.type === 'bmx' ? frame : frame);
      out.push(`<path d="M${P(crown)} Q${P(ctrl)} ${P(F)}" fill="none" stroke="url(#${id})" stroke-width="${bike.type === 'fat' ? 34 : 28}" stroke-linecap="round"/>`);
      out.push(`<path d="M${P(crown)} Q${P(ctrl)} ${P(F)}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="5" transform="translate(-6,-2)"/>`);
    }
    // Тормозные калиперы.
    if (!['bmx', 'folding'].includes(bike.type)) {
      out.push(`<rect x="${f(R.x + 30)}" y="${f(-R.y - 70)}" width="38" height="58" rx="10" fill="#202226"/>`);
      out.push(`<rect x="${f(F.x - 70)}" y="${f(-F.y - 70)}" width="38" height="58" rx="10" fill="#202226"/>`);
    } else {
      out.push(`<rect x="${f(HB.x - 6)}" y="${f(-HB.y + 20)}" width="30" height="20" rx="6" fill="#9aa0a8"/>`);
    }

    // ── Подседел и седло ──
    out.push(line(add(T, mul(dSeat, -10)), S, `stroke="${bike.type === 'folding' ? '#c3c7cd' : '#1d1e21'}" stroke-width="${bike.type === 'folding' ? 30 : 27}" stroke-linecap="round"`));
    out.push(line(add(T, mul(dSeat, -10)), S, `stroke="#fff" stroke-opacity=".18" stroke-width="5" transform="translate(-6,0)"`));
    const sad = add(S, V(0, 18));
    const sadLen = bike.type === 'bmx' ? 210 : 270;
    out.push(`<path d="M${P(add(sad, V(-sadLen * 0.48, 10)))} Q${P(add(sad, V(-sadLen * 0.5, 34)))} ${P(add(sad, V(-sadLen * 0.2, 30)))} L${P(add(sad, V(sadLen * 0.5, 14)))} Q${P(add(sad, V(sadLen * 0.56, 4)))} ${P(add(sad, V(sadLen * 0.42, -2)))} L${P(add(sad, V(-sadLen * 0.4, -6)))} Z" fill="#141416"/>`);
    out.push(`<path d="M${P(add(sad, V(-sadLen * 0.44, 22)))} Q${P(add(sad, V(-sadLen * 0.2, 28)))} ${P(add(sad, V(sadLen * 0.4, 12)))}" fill="none" stroke="${accent}" stroke-width="4"/>`);

    // ── Руль ──
    const steerTop = add(H, mul(dHead, -38));
    out.push(line(add(H, mul(dHead, 4)), steerTop, `stroke="#1b1c1f" stroke-width="${f(wHT * 0.7)}" stroke-linecap="round"`));
    let barC;
    if (g.bar === 'brompton') {
      const top = add(H, V(-60, 360));
      out.push(line(add(H, mul(dHead, -10)), top, `stroke="#2a2b2f" stroke-width="30" stroke-linecap="round"`));
      out.push(line(top, add(top, V(-90, -10)), `stroke="#1b1c1f" stroke-width="30" stroke-linecap="round"`));
      out.push(line(add(top, V(-90, -10)), add(top, V(-150, -14)), `stroke="#3a3b3f" stroke-width="36" stroke-linecap="round"`));
      barC = top;
    } else if (g.bar === 'bmx') {
      const clamp = add(steerTop, V(40, 0));
      out.push(line(steerTop, clamp, `stroke="#1b1c1f" stroke-width="40" stroke-linecap="round"`));
      const top = add(clamp, V(-50, 230));
      out.push(line(clamp, top, `stroke="#c9ccd1" stroke-width="22" stroke-linecap="round"`));
      out.push(line(lerp(clamp, top, 0.55), add(lerp(clamp, top, 0.55), V(-30, 0)), `stroke="#c9ccd1" stroke-width="16"`));
      out.push(line(top, add(top, V(-80, 10)), `stroke="#111" stroke-width="34" stroke-linecap="round"`));
      barC = top;
    } else {
      const stemLen = g.bar === 'riser' ? 50 : g.bar === 'flat' ? 80 : 105;
      const sDir = norm(V(Math.sin(rad(g.ha)) + 0.08, Math.cos(rad(g.ha))));
      const clamp = add(steerTop, mul(sDir, stemLen));
      out.push(line(add(steerTop, V(-6, 0)), clamp, `stroke="#1b1c1f" stroke-width="38" stroke-linecap="round"`));
      out.push(circle(clamp, 20, `fill="#2a2b2f"`));
      barC = clamp;
      if (g.bar === 'drop') {
        // Барашек с обмоткой, рукоятки и тормозные ручки.
        const tape = bike.type === 'gravel' ? '#5a4632' : '#151515';
        const d = `M${P(clamp)} L${P(add(clamp, V(55, 6)))} Q${P(add(clamp, V(110, 2)))} ${P(add(clamp, V(100, -60)))} Q${P(add(clamp, V(90, -128)))} ${P(add(clamp, V(20, -122)))}`;
        out.push(`<path d="${d}" fill="none" stroke="${tape}" stroke-width="26" stroke-linecap="round"/>`);
        out.push(`<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="26" stroke-dasharray="3 9"/>`);
        out.push(`<path d="M${P(add(clamp, V(70, 8)))} q30,-34 52,-14 q10,30 -10,80 q-14,30 -26,-10 z" fill="#1d1e21"/>`);
        out.push(`<path d="M${P(add(clamp, V(104, -18)))} q8,52 -14,90" fill="none" stroke="#2e3035" stroke-width="10" stroke-linecap="round"/>`);
      } else if (g.bar === 'tt') {
        out.push(line(clamp, add(clamp, V(70, -6)), `stroke="#151515" stroke-width="30" stroke-linecap="round"`));
        out.push(`<path d="M${P(add(clamp, V(-10, 26)))} L${P(add(clamp, V(210, 40)))} q30,4 20,-30" fill="none" stroke="#1a1b1e" stroke-width="20" stroke-linecap="round"/>`);
        out.push(`<rect x="${f(clamp.x - 40)}" y="${f(-clamp.y - 52)}" width="90" height="18" rx="8" fill="#2d2f34"/>`);
      } else {
        // Прямой/райзер руль: грипса, ручка тормоза, манетка.
        const up = g.bar === 'riser' ? 30 : 8;
        out.push(line(clamp, add(clamp, V(-30, up)), `stroke="#1b1c1f" stroke-width="22" stroke-linecap="round"`));
        out.push(line(add(clamp, V(-30, up)), add(clamp, V(-110, up + 8)), `stroke="#111" stroke-width="32" stroke-linecap="round"`));
        out.push(`<path d="M${P(add(clamp, V(-20, up + 6)))} q40,6 70,-30" fill="none" stroke="#3a3c41" stroke-width="9" stroke-linecap="round"/>`);
      }
    }
    // Тросы от руля к раме.
    out.push(`<path d="M${P(add(barC, V(10, -10)))} Q${P(add(H, V(150, -40)))} ${P(lerp(HB, B, 0.12))}" fill="none" stroke="#1c1d20" stroke-width="5"/>`);

    // ── Система и ближний шатун ──
    const teeth = ringR * 2 * Math.PI / 52;
    out.push(circle(B, ringR, `fill="none" stroke="#33363b" stroke-width="12"`));
    out.push(circle(B, ringR + 4, `fill="none" stroke="#5b6068" stroke-width="5" stroke-dasharray="${f(teeth * 0.45)} ${f(teeth * 0.55)}"`));
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + 0.4;
      out.push(line(B, add(B, V(Math.cos(a) * (ringR - 8), Math.sin(a) * (ringR - 8))), `stroke="#24262a" stroke-width="14" stroke-linecap="round"`));
    }
    out.push(line(B, pedal1, `stroke="#1c1d20" stroke-width="24" stroke-linecap="round"`));
    out.push(line(B, pedal1, `stroke="#fff" stroke-opacity=".15" stroke-width="5" transform="translate(-4,-4)"`));
    out.push(circle(B, 20, `fill="#4a4e55"`) + circle(B, 8, `fill="#c4c8ce"`));
    out.push(`<rect x="${f(pedal1.x - 48)}" y="${f(-pedal1.y - 10)}" width="96" height="20" rx="7" fill="#111214"/>`);

    // ── Сцена ──
    const minX = R.x - wheelR - 60, maxX = Math.max(F.x + wheelR, barC.x + 160) + 60;
    const topY = Math.max(S.y + 60, barC.y + 60, wheelR * 2 + g.drop - wheelR);
    const minY = groundY - 70;
    let w = maxX - minX, h = topY - minY;
    // Пропорции 16:10 для карточек.
    const target = 1.6;
    let vx = minX, vy = -topY;
    if (w / h < target) { const nw = h * target; vx -= (nw - w) / 2; w = nw; } else { const nh = w / target; vy -= (nh - h) * 0.55; h = nh; }
    const bgId = 'bg';
    defs.push(`<radialGradient id="${bgId}" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#3a4150"/><stop offset=".65" stop-color="#1f242e"/><stop offset="1" stop-color="#12151b"/></radialGradient>`);
    defs.push(`<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a303b"/><stop offset="1" stop-color="#14171d"/></linearGradient>`);
    const bg = `<rect x="${f(vx)}" y="${f(vy)}" width="${f(w)}" height="${f(h)}" fill="url(#${bgId})"/>` +
      `<rect x="${f(vx)}" y="${f(-groundY)}" width="${f(w)}" height="${f(vy + h + groundY)}" fill="url(#floor)" opacity=".85"/>` +
      `<line x1="${f(vx)}" y1="${f(-groundY)}" x2="${f(vx + w)}" y2="${f(-groundY)}" stroke="#fff" stroke-opacity=".06" stroke-width="3"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vx)} ${f(vy)} ${f(w)} ${f(h)}" width="${Math.round(w / 3)}" height="${Math.round(h / 3)}"><defs>${defs.join('')}</defs>${bg}${out.join('')}</svg>`;
  }

  const cache = {};
  function svg(bike, wheelId) {
    const key = `${bike.id}|${wheelId || ''}`;
    if (!cache[key]) cache[key] = build(bike, wheelId);
    return cache[key];
  }
  function dataUrl(bike, wheelId) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(bike, wheelId));
  }

  // Аватар гонщика для экрана тренировок.
  function riderSvg(level, jersey) {
    const j = jersey || '#ff2d55';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">
      <defs><radialGradient id="rb" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#3a4150"/><stop offset="1" stop-color="#151920"/></radialGradient>
      <linearGradient id="rj" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(j, 1.25)}"/><stop offset="1" stop-color="${shade(j, 0.6)}"/></linearGradient>
      <linearGradient id="rh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6b0"/><stop offset="1" stop-color="#e0b400"/></linearGradient></defs>
      <rect width="220" height="220" rx="24" fill="url(#rb)"/>
      <path d="M30 220 Q36 150 110 140 Q184 150 190 220 Z" fill="url(#rj)"/>
      <path d="M86 146 L110 176 L134 146" fill="none" stroke="#fff" stroke-width="5" stroke-opacity=".8"/>
      <rect x="40" y="186" width="140" height="10" fill="#fff" fill-opacity=".25"/>
      <rect x="96" y="120" width="28" height="26" rx="8" fill="#e6b18f"/>
      <ellipse cx="110" cy="96" rx="36" ry="40" fill="#f0c4a2"/>
      <path d="M68 86 Q70 40 110 38 Q152 40 154 86 Q132 74 110 74 Q88 74 68 86 Z" fill="url(#rh)"/>
      <path d="M86 46 L92 72 M110 40 L110 72 M134 46 L128 72" stroke="#7a5a00" stroke-width="4" stroke-linecap="round" opacity=".5"/>
      <rect x="74" y="86" width="72" height="20" rx="10" fill="#14161a"/>
      <rect x="80" y="89" width="28" height="9" rx="4" fill="#5ad1ff" opacity=".7"/>
      <path d="M100 120 Q110 126 120 120" fill="none" stroke="#a5644b" stroke-width="3" stroke-linecap="round"/>
      <circle cx="182" cy="40" r="26" fill="#ffd400"/><text x="182" y="40" text-anchor="middle" dominant-baseline="central" font-family="Arial Black,Arial" font-weight="900" font-size="22" fill="#1a1500">${level}</text>
    </svg>`;
  }

  window.BikeArt = { svg, dataUrl, riderSvg, shade };
})();
