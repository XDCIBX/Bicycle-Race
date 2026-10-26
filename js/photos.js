// Фотографии велосипедов.
// Порядок поиска: 1) локальные файлы assets/photos (скачиваются tools/fetch-photos.mjs),
// 2) кэш в localStorage, 3) поиск реальных фото на Wikimedia Commons (свободные лицензии).
// Если сети нет — рисуем иллюстрацию велосипеда нужного типа.
(function () {
  'use strict';
  const CACHE_KEY = 'velorush.photos.v1';
  const API = 'https://commons.wikimedia.org/w/api.php';
  const pending = {};
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { cache = {}; }

  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* игнорируем */ }
  }

  function stripHtml(s) {
    const div = document.createElement('div');
    div.innerHTML = s || '';
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }

  const BAD_WORDS = /(logo|map|diagram|drawing|icon|sign|poster|advert|catalog|patent|svg|schematic|crash|accident)/i;

  // Выбираем лучший кадр из результатов поиска: альбомная ориентация, в названии есть бренд.
  function pickBest(pages, bike) {
    const tokens = bike.name.toLowerCase().replace(/[^a-z0-9а-яё ]/gi, ' ').split(/\s+/).filter((t) => t.length > 2);
    let best = null, bestScore = -Infinity;
    pages.forEach((pg) => {
      const ii = pg.imageinfo && pg.imageinfo[0];
      if (!ii || !/image\/(jpeg|png|webp)/.test(ii.mime || '')) return;
      if (BAD_WORDS.test(pg.title)) return;
      const title = pg.title.toLowerCase();
      let score = -(pg.index || 0) * 0.15;
      tokens.forEach((t) => { if (title.includes(t)) score += 2; });
      const ratio = ii.width / ii.height;
      if (ratio > 1.15 && ratio < 2.2) score += 2;
      else if (ratio < 0.9) score -= 2;
      if (ii.width < 500) score -= 3;
      if (score > bestScore) { bestScore = score; best = { pg, ii }; }
    });
    if (!best) return null;
    const meta = best.ii.extmetadata || {};
    return {
      url: best.ii.thumburl || best.ii.url,
      page: best.ii.descriptionurl,
      title: best.pg.title.replace(/^File:/, ''),
      artist: stripHtml(meta.Artist && meta.Artist.value) || 'неизвестен',
      license: stripHtml(meta.LicenseShortName && meta.LicenseShortName.value) || 'см. страницу файла',
    };
  }

  async function searchCommons(bike) {
    for (const q of bike.photoQueries) {
      const params = new URLSearchParams({
        action: 'query', format: 'json', origin: '*',
        generator: 'search', gsrnamespace: '6', gsrlimit: '12',
        gsrsearch: `${q} filetype:bitmap`,
        prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '640',
      });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(`${API}?${params}`, { signal: ctl.signal });
        if (!res.ok) continue;
        const data = await res.json();
        const pages = Object.values((data.query && data.query.pages) || {});
        const best = pickBest(pages, bike);
        if (best) return best;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  function get(bike) {
    const local = window.LOCAL_BIKE_PHOTOS && window.LOCAL_BIKE_PHOTOS[bike.id];
    if (local) return Promise.resolve(Object.assign({ local: true }, local));
    if (cache[bike.id]) return Promise.resolve(cache[bike.id]);
    if (!pending[bike.id]) {
      pending[bike.id] = searchCommons(bike).then((ph) => {
        if (ph) { cache[bike.id] = ph; saveCache(); }
        return ph;
      }).catch(() => null);
    }
    return pending[bike.id];
  }

  // ── Иллюстрация велосипеда (вид сбоку) — запасной вариант без сети ──────
  function drawBikeSide(ctx, bike, w, h) {
    const t = bike.type;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a2f3a'); g.addColorStop(1, '#171a21');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
    const k = Math.min(w / 320, h / 200);
    ctx.save();
    ctx.translate(w / 2, h * 0.58);
    ctx.scale(k, k);
    const R = t === 'folding' ? 30 : t === 'bmx' ? 38 : 52;
    const tire = t === 'fat' ? 14 : t === 'mtb' || t === 'enduro' ? 8 : t === 'bmx' ? 7 : t === 'gravel' ? 6 : 4;
    const wb = t === 'folding' ? 82 : t === 'bmx' ? 92 : 112;
    const rear = [-wb / 2, 30], front = [wb / 2, 30];
    // Колёса.
    [rear, front].forEach((c, i) => {
      ctx.lineWidth = tire; ctx.strokeStyle = '#0d0d10';
      ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI * 2); ctx.stroke();
      if (t === 'mtb' || t === 'enduro' || t === 'fat') {
        ctx.setLineDash([3, 4]); ctx.lineWidth = 3; ctx.strokeStyle = '#2a2a2e';
        ctx.beginPath(); ctx.arc(c[0], c[1], R + tire / 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      const deep = (t === 'aero' || t === 'tt') ? (i === 0 && t === 'tt' ? R - tire : 16) : 4;
      ctx.lineWidth = deep; ctx.strokeStyle = t === 'tt' && i === 0 ? '#2b2b30' : '#3a3d45';
      ctx.beginPath(); ctx.arc(c[0], c[1], R - tire / 2 - deep / 2, 0, Math.PI * 2); ctx.stroke();
      if (!(t === 'tt' && i === 0)) {
        ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(220,220,220,0.5)';
        for (let s = 0; s < 16; s++) {
          const a = s / 16 * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0] + Math.cos(a) * (R - tire), c[1] + Math.sin(a) * (R - tire)); ctx.stroke();
        }
      }
      ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(c[0], c[1], 4, 0, 7); ctx.fill();
    });
    // Геометрия рамы.
    const bb = [t === 'bmx' ? -8 : -6, 34];
    let seatTop, headTop, headBot;
    if (t === 'folding') { seatTop = [-14, -50]; headTop = [front[0] - 10, -48]; headBot = [front[0] - 4, 8]; }
    else if (t === 'bmx') { seatTop = [-18, -10]; headTop = [front[0] - 10, -28]; headBot = [front[0] - 6, 0]; }
    else if (t === 'mtb' || t === 'enduro' || t === 'fat') { seatTop = [-22, -40]; headTop = [front[0] - 22, -38]; headBot = [front[0] - 16, -8]; }
    else { seatTop = [-18, -48]; headTop = [front[0] - 18, -42]; headBot = [front[0] - 14, -14]; }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = bike.color;
    const thick = t === 'aero' || t === 'tt' ? 9 : t === 'fat' || t === 'enduro' ? 8 : 6;
    ctx.lineWidth = thick;
    ctx.beginPath();
    if (t === 'folding') {
      ctx.moveTo(rear[0], rear[1]); ctx.lineTo(bb[0], bb[1]);
      ctx.moveTo(bb[0] - 10, 6); ctx.quadraticCurveTo(10, -14, headBot[0], headBot[1] - 20);
      ctx.moveTo(bb[0], bb[1]); ctx.lineTo(seatTop[0], seatTop[1] + 20);
    } else {
      ctx.moveTo(rear[0], rear[1]); ctx.lineTo(bb[0], bb[1]); ctx.lineTo(seatTop[0], seatTop[1]);
      ctx.lineTo(rear[0], rear[1]);
      ctx.moveTo(seatTop[0], seatTop[1] + 4); ctx.lineTo(headTop[0], headTop[1] + 6);
      ctx.moveTo(bb[0], bb[1]); ctx.lineTo(headBot[0], headBot[1]);
      ctx.moveTo(headTop[0], headTop[1]); ctx.lineTo(headBot[0], headBot[1]);
    }
    ctx.stroke();
    if (t === 'enduro') { // задний амортизатор
      ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(-16, -18); ctx.stroke();
    }
    // Вилка.
    ctx.strokeStyle = t === 'mtb' || t === 'enduro' || t === 'fat' ? '#1b1b1b' : bike.color;
    ctx.lineWidth = t === 'mtb' || t === 'enduro' ? 7 : 5;
    ctx.beginPath(); ctx.moveTo(headBot[0], headBot[1]); ctx.lineTo(front[0], front[1]); ctx.stroke();
    if (t === 'mtb' || t === 'enduro') {
      ctx.strokeStyle = '#c9c9c9'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(headBot[0], headBot[1]); ctx.lineTo(headBot[0] + (front[0] - headBot[0]) * 0.45, headBot[1] + (front[1] - headBot[1]) * 0.45); ctx.stroke();
    }
    // Седло и подседел.
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4;
    const sp = t === 'folding' ? [seatTop[0] - 2, seatTop[1] - 18] : [seatTop[0] - 4, seatTop[1] - 12];
    ctx.beginPath(); ctx.moveTo(seatTop[0], seatTop[1]); ctx.lineTo(sp[0], sp[1]); ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(sp[0] + 2, sp[1] - 2, 15, 4, 0, 0, Math.PI * 2); ctx.fill();
    // Руль.
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(headTop[0], headTop[1]);
    if (t === 'road' || t === 'aero' || t === 'gravel') {
      ctx.lineTo(headTop[0] + 14, headTop[1] - 4);
      ctx.bezierCurveTo(headTop[0] + 30, headTop[1] - 4, headTop[0] + 30, headTop[1] + 18, headTop[0] + 16, headTop[1] + 16);
    } else if (t === 'tt') {
      ctx.lineTo(headTop[0] + 6, headTop[1] - 4); ctx.lineTo(headTop[0] + 34, headTop[1] - 6);
    } else if (t === 'bmx') {
      ctx.lineTo(headTop[0] - 6, headTop[1] - 26); ctx.lineTo(headTop[0] - 14, headTop[1] - 26);
    } else {
      ctx.lineTo(headTop[0] + 2, headTop[1] - 14 - (t === 'folding' ? 8 : 0)); ctx.lineTo(headTop[0] - 10, headTop[1] - 14 - (t === 'folding' ? 8 : 0));
    }
    ctx.stroke();
    // Шатун и звезда.
    ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bb[0], bb[1], 11, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(bb[0], bb[1]); ctx.lineTo(bb[0] + 10, bb[1] + 16); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#555';
    ctx.beginPath(); ctx.moveTo(bb[0], bb[1] - 11); ctx.lineTo(rear[0], rear[1] - 7); ctx.moveTo(bb[0], bb[1] + 11); ctx.lineTo(rear[0], rear[1] + 7); ctx.stroke();
    ctx.restore();
  }

  const artCache = {};
  function illustration(bike, w, h) {
    const key = `${bike.id}|${w}|${h}`;
    if (!artCache[key]) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      drawBikeSide(c.getContext('2d'), bike, w, h);
      artCache[key] = c.toDataURL();
    }
    return artCache[key];
  }

  // Заполняет контейнер .photo: иллюстрация сразу, реальное фото — когда загрузится.
  function attach(el, bike) {
    el.innerHTML = '';
    const img = document.createElement('img');
    img.alt = bike.name;
    img.src = illustration(bike, 480, 300);
    img.className = 'bike-img art';
    el.appendChild(img);
    const credit = document.createElement('div');
    credit.className = 'photo-credit';
    credit.textContent = 'Иллюстрация · ищем фото…';
    el.appendChild(credit);
    get(bike).then((ph) => {
      if (!ph) { credit.textContent = 'Иллюстрация (фото недоступно офлайн)'; return; }
      const real = new Image();
      real.referrerPolicy = 'no-referrer';
      real.onload = () => {
        img.src = real.src;
        img.className = 'bike-img photo';
        credit.innerHTML = '';
        const a = document.createElement('a');
        a.href = ph.page || ph.url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = `Фото: ${ph.artist} · ${ph.license}${ph.local ? '' : ' · Wikimedia Commons'}`;
        a.title = ph.title || '';
        credit.appendChild(a);
      };
      real.onerror = () => { credit.textContent = 'Иллюстрация (фото не загрузилось)'; };
      real.src = ph.url;
    });
  }

  window.BikePhotos = { get, attach, illustration, drawBikeSide, pickBest };
})();
