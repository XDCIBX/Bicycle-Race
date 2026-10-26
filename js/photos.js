// Фотографии велосипедов.
// Порядок поиска: 1) локальные файлы assets/photos (скачиваются tools/fetch-photos.mjs),
// 2) кэш в localStorage, 3) поиск реальных фото на Wikimedia Commons (свободные лицензии).
// Фото принимается, только если в названии файла есть и бренд, и модель (bike.photoMatch),
// а снимки гонок, команд, выставок, логотипов и деталей отбрасываются. Иначе — реалистичная
// модель велосипеда (js/bikeart.js). На самом изображении подписей нет: автор и лицензия — по кнопке ⓘ.
(function () {
  'use strict';
  const CACHE_KEY = 'velorush.photos.v2';
  const BAD_KEY = 'velorush.photos.bad';
  const API = 'https://commons.wikimedia.org/w/api.php';
  const pending = {};
  let cache = {};
  let bad = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { cache = {}; }
  try { bad = JSON.parse(localStorage.getItem(BAD_KEY) || '{}'); } catch (e) { bad = {}; }
  try { localStorage.removeItem('velorush.photos.v1'); } catch (e) { /* старый кэш с неточными фото */ }

  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* игнорируем */ } }

  function stripHtml(s) {
    const div = document.createElement('div');
    div.innerHTML = s || '';
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Не подходят: гонки и люди, выставки и магазины, логотипы, крупные планы деталей.
  const REJECT = /(logo|map|diagram|drawing|icon|sign|poster|advert|catalog|patent|svg|schematic|crash|accident|tour de france|giro|vuelta|stage|étape|etapa|team|équipe|podium|peloton|race|racing|rennen|course|criterium|finish|winner|champion|portrait|rider|cyclist|athlete|shop|store|showroom|museum|expo|eurobike|fair|messe|detail|close|headtube|head tube|badge|decal|crank|derailleur|saddle|groupset|drivetrain|cockpit|handlebar|interior|parade|crowd)/i;
  const PREFER = /(bike|bicycle|fahrrad|vélo|velo|bicicleta|side|profile|studio)/i;

  function matches(title, bike) {
    const m = bike.photoMatch;
    if (!m) return false;
    const t = title.replace(/^File:/, '').replace(/[_]+/g, ' ');
    if (!new RegExp(m.brand, 'i').test(t)) return false;
    if (m.model && !new RegExp(m.model, 'i').test(t)) return false;
    return !REJECT.test(t);
  }

  // Лучший кадр: обязательно бренд+модель в названии, альбомная ориентация (вид сбоку).
  function pickBest(pages, bike) {
    const banned = bad[bike.id] || [];
    let best = null, bestScore = -Infinity;
    pages.forEach((pg) => {
      const ii = pg.imageinfo && pg.imageinfo[0];
      if (!ii || !/image\/(jpeg|png|webp)/.test(ii.mime || '')) return;
      if (banned.includes(pg.title) || !matches(pg.title, bike)) return;
      const ratio = ii.width / ii.height;
      if (ratio < 1.15 || ratio > 2.3 || ii.width < 600) return;
      let score = -(pg.index || 0) * 0.1;
      if (PREFER.test(pg.title)) score += 2;
      if (ratio > 1.3 && ratio < 1.8) score += 1.5;
      if (score > bestScore) { bestScore = score; best = { pg, ii }; }
    });
    if (!best) return null;
    const meta = best.ii.extmetadata || {};
    return {
      url: best.ii.thumburl || best.ii.url,
      page: best.ii.descriptionurl,
      title: best.pg.title,
      artist: stripHtml(meta.Artist && meta.Artist.value) || 'неизвестен',
      license: stripHtml(meta.LicenseShortName && meta.LicenseShortName.value) || 'см. страницу файла',
    };
  }

  function queries(bike) {
    const brand = bike.brand.replace('é', 'e');
    const model = bike.model.split(' ').find((w) => w.length > 1 && !/^(s-works|c|line|carbon|advanced|pro|rc|disc|world|cup|explore)$/i.test(w)) || bike.model;
    return [`intitle:"${brand}" intitle:"${model}"`, `${bike.brand} ${bike.model}`, ...bike.photoQueries.slice(0, 2)];
  }

  async function searchCommons(bike) {
    for (const q of queries(bike)) {
      const params = new URLSearchParams({
        action: 'query', format: 'json', origin: '*',
        generator: 'search', gsrnamespace: '6', gsrlimit: '30',
        gsrsearch: `${q} filetype:bitmap`,
        prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '800',
      });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(`${API}?${params}`, { signal: ctl.signal });
        if (!res.ok) continue;
        const data = await res.json();
        const best = pickBest(Object.values((data.query && data.query.pages) || {}), bike);
        if (best) return best;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  function get(bike) {
    const local = window.LOCAL_BIKE_PHOTOS && window.LOCAL_BIKE_PHOTOS[bike.id];
    if (local && !(bad[bike.id] || []).includes(local.title)) return Promise.resolve(Object.assign({ local: true }, local));
    if (cache[bike.id] !== undefined) return Promise.resolve(cache[bike.id]);
    if (!pending[bike.id]) {
      pending[bike.id] = searchCommons(bike).then((ph) => {
        cache[bike.id] = ph; // null тоже кэшируем: «подходящего фото нет — показываем модель»
        store(CACHE_KEY, cache);
        return ph;
      }).catch(() => { delete pending[bike.id]; return null; });
    }
    return pending[bike.id];
  }

  // Пользователь отметил фото как неверное: запоминаем и ищем следующее.
  function reject(bike, ph) {
    bad[bike.id] = (bad[bike.id] || []).concat(ph.title);
    store(BAD_KEY, bad);
    delete cache[bike.id];
    delete pending[bike.id];
    store(CACHE_KEY, cache);
  }

  // Контейнер .photo: сразу реалистичная модель велосипеда, а если найдено точное фото —
  // показываем его. Подписей поверх картинки нет: ⓘ — автор и лицензия, «Модель/Фото» — переключатель.
  function attach(el, bike, wheelId) {
    el.innerHTML = '';
    const art = window.BikeArt.dataUrl(bike, wheelId);
    const img = document.createElement('img');
    img.alt = bike.name;
    img.src = art;
    img.className = 'bike-img art';
    el.appendChild(img);
    get(bike).then((ph) => {
      if (!ph || !el.isConnected) return;
      const real = new Image();
      real.referrerPolicy = 'no-referrer';
      real.onload = () => {
        const bar = document.createElement('div');
        bar.className = 'photo-tools';
        const info = document.createElement('button');
        info.textContent = 'ⓘ';
        info.title = 'Автор и лицензия фото';
        const toggle = document.createElement('button');
        const wrong = document.createElement('button');
        wrong.textContent = '✕ не тот';
        wrong.title = 'Это не тот велосипед — убрать фото';
        bar.append(info, toggle, wrong);
        el.appendChild(bar);
        const pop = document.createElement('div');
        pop.className = 'photo-pop';
        pop.hidden = true;
        const a = document.createElement('a');
        a.href = ph.page || ph.url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = `Фото: ${ph.artist} · ${ph.license}${ph.local ? '' : ' · Wikimedia Commons'}`;
        pop.appendChild(a);
        el.appendChild(pop);
        let on = true;
        const show = () => {
          img.src = on ? real.src : art;
          img.className = 'bike-img ' + (on ? 'photo' : 'art');
          toggle.textContent = on ? 'Модель' : 'Фото';
          info.hidden = !on; wrong.hidden = !on;
          if (!on) pop.hidden = true;
        };
        info.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; };
        toggle.onclick = (e) => { e.stopPropagation(); on = !on; show(); };
        wrong.onclick = (e) => { e.stopPropagation(); reject(bike, ph); attach(el, bike, wheelId); };
        show();
      };
      real.src = ph.url;
    });
  }

  // Список использованных фото с авторами (для экрана трофеев / титров).
  function credits() {
    const out = [];
    window.GameData.BIKES.forEach((b) => {
      const local = window.LOCAL_BIKE_PHOTOS && window.LOCAL_BIKE_PHOTOS[b.id];
      const ph = local || cache[b.id];
      if (ph) out.push({ bike: b, ph });
    });
    return out;
  }

  window.BikePhotos = { get, attach, pickBest, matches, credits };
})();
