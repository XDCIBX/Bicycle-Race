// Фотографии велосипедов.
// Порядок поиска: 1) локальные файлы assets/photos (скачиваются tools/fetch-photos.mjs),
// 2) кэш в localStorage, 3) поиск реальных фото на Wikimedia Commons (свободные лицензии).
// Если сети нет — показываем реалистичную модель (js/bikeart.js).
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

  // Заполняет контейнер .photo: сразу реалистичная модель велосипеда (SVG по геометрии),
  // а когда загрузится настоящее фото — показываем его с переключателем «Фото / Модель».
  function attach(el, bike, wheelId) {
    el.innerHTML = '';
    const art = window.BikeArt.dataUrl(bike, wheelId);
    const img = document.createElement('img');
    img.alt = bike.name;
    img.src = art;
    img.className = 'bike-img art';
    el.appendChild(img);
    const credit = document.createElement('div');
    credit.className = 'photo-credit';
    credit.textContent = `Модель ${bike.name} · ищем фото…`;
    el.appendChild(credit);
    get(bike).then((ph) => {
      if (!ph) { credit.textContent = `Модель ${bike.name}`; return; }
      const real = new Image();
      real.referrerPolicy = 'no-referrer';
      real.onload = () => {
        const showPhoto = (on) => {
          img.src = on ? real.src : art;
          img.className = 'bike-img ' + (on ? 'photo' : 'art');
          credit.innerHTML = '';
          if (on) {
            const a = document.createElement('a');
            a.href = ph.page || ph.url; a.target = '_blank'; a.rel = 'noopener';
            a.textContent = `Фото: ${ph.artist} · ${ph.license}${ph.local ? '' : ' · Wikimedia Commons'}`;
            a.title = ph.title || '';
            a.onclick = (e) => e.stopPropagation();
            credit.appendChild(a);
          } else credit.textContent = `Модель ${bike.name}`;
          toggle.textContent = on ? 'Модель' : 'Фото';
        };
        const toggle = document.createElement('button');
        toggle.className = 'photo-toggle';
        let on = true;
        toggle.onclick = (e) => { e.stopPropagation(); on = !on; showPhoto(on); };
        el.appendChild(toggle);
        showPhoto(true);
      };
      real.onerror = () => { credit.textContent = `Модель ${bike.name}`; };
      real.src = ph.url;
    });
  }

  window.BikePhotos = { get, attach, pickBest };
})();
