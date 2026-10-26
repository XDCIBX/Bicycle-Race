// Меню: трассы (с выбором тактики), тренировки гонщика, гараж (улучшения и колёса), магазин.
(function () {
  'use strict';
  const D = window.GameData;
  const GS = window.GameState;

  const UI = {
    state: null,
    screen: 'tracks',
    garageSel: null,
    onStartRace: null,
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMoney = (n) => '🪙 ' + Math.round(n).toLocaleString('ru-RU');
  function fmtTime(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function commit(flash) {
    GS.save(UI.state);
    const m = $('#money');
    m.textContent = fmtMoney(UI.state.money);
    if (flash) { m.classList.remove('flash'); void m.offsetWidth; m.classList.add('flash'); }
  }

  // ── Характеристики ─────────────────────────────────────────
  function statBars(stats, base) {
    return `<div class="stats">${D.STAT_KEYS.map((k) => {
      const v = Math.round(stats[k]);
      const b = base ? Math.round(base[k]) : v;
      const lo = Math.min(v, b, 100), diff = Math.min(v, 100) - Math.min(b, 100);
      return `<div class="stat"><span class="name">${D.STAT_NAMES[k]}</span>
        <div class="bar"><div class="base" style="width:${lo}%"></div>${diff > 0 ? `<div class="bonus" style="width:${diff}%"></div>` : ''}${diff < 0 ? `<div class="minus" style="width:${-diff}%"></div>` : ''}</div>
        <span class="val">${v}</span></div>`;
    }).join('')}</div>`;
  }

  function strengths(bike) {
    const s = bike.stats;
    const sorted = D.STAT_KEYS.slice().sort((a, b) => s[b] - s[a]);
    return sorted.slice(0, 2).map((k) => D.STAT_NAMES[k]).join(', ');
  }

  function ownedStats(bikeId) {
    const o = UI.state.owned[bikeId];
    return GS.effectiveStats(bikeId, o.upgrades, o.wheel, UI.state.rider.skills);
  }

  // Эталонное время круга: лучший велосипед в стоке с лучшими колёсами.
  const refCache = {};
  function refLap(trackId) {
    if (refCache[trackId]) return refCache[trackId];
    const tr = window.Tracks.get(trackId);
    let best = Infinity;
    D.BIKES.forEach((b) => {
      Object.keys(D.WHEELS).forEach((w) => {
        if (!b.sizes.includes(D.WHEELS[w].size)) return;
        best = Math.min(best, window.Tracks.estimateLap(tr, GS.effectiveStats(b.id, null, w), w));
      });
    });
    return (refCache[trackId] = best);
  }
  function forecast(trackId, stats, wheel) {
    const lap = window.Tracks.estimateLap(window.Tracks.get(trackId), stats, wheel);
    const ratio = refLap(trackId) / lap;
    const stars = Math.max(1, Math.min(5, Math.round((ratio - 0.62) / 0.36 * 5)));
    return { lap, stars };
  }
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  const MEDALS = ['🏆', '🥈', '🥉'];
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  function isUnlocked(i) {
    if (i < 2) return true;
    const prev = D.TRACKS[i - 1];
    return (UI.state.best[prev.id] || 99) <= 3;
  }

  // ── Экран «Гонки» ──────────────────────────────────────────
  function renderTracks(root) {
    const st = UI.state;
    const bike = D.bikeById(st.active);
    const o = st.owned[st.active];
    const stats = ownedStats(st.active);
    root.innerHTML = `
      <div class="active-bike">
        <div class="photo" id="active-photo"></div>
        <div style="flex:1;min-width:0">
          <div class="muted">Ваш велосипед</div>
          <h2 style="margin:0">${esc(bike.name)}</h2>
          <div class="muted">${D.BIKE_TYPES[bike.type]} · ${esc(D.WHEELS[o.wheel].name)}</div>
          <div class="muted">Гонщик: ${esc(st.rider.name)}, уровень ${GS.riderLevel(st.rider.skills)} · тактика: ${esc(D.TACTICS.find((x) => x.id === st.tactic).name)}</div>
        </div>
        <button class="btn" data-go="garage">Сменить / улучшить</button>
      </div>
      <div class="section-title"><h2>Трассы</h2><p>Велосипед едет сам — исход решают его характеристики, колёса, тренированность гонщика и выбранная тактика. Займите место в тройке, чтобы открыть следующую трассу.</p></div>
      <div class="grid" id="track-grid"></div>`;
    window.BikePhotos.attach($('#active-photo', root), bike, o.wheel);
    const grid = $('#track-grid', root);
    D.TRACKS.forEach((t, i) => {
      const tr = window.Tracks.get(t.id);
      const unlocked = isUnlocked(i);
      const fc = forecast(t.id, stats, o.wheel);
      const comp = {};
      tr.samples.forEach((p) => { comp[p.surface] = (comp[p.surface] || 0) + 1; });
      const compArr = Object.entries(comp).sort((a, b) => b[1] - a[1]);
      const best = st.best[t.id];
      const card = document.createElement('div');
      card.className = 'card' + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <canvas class="track-map" width="560" height="315"></canvas>
        <div class="body">
          <div class="row"><h3 style="margin:0">${esc(t.name)}</h3><span class="spacer"></span><span class="badge">Ур. ${t.tier}</span></div>
          <div class="muted">${esc(t.desc)}</div>
          <div class="surfbar">${compArr.map(([s, n]) => `<div title="${D.SURFACES[s].name}" style="flex:${n};background:${D.SURFACES[s].color}"></div>`).join('')}</div>
          <div class="legend">${compArr.map(([s, n]) => `<span><i style="background:${D.SURFACES[s].color}"></i>${D.SURFACES[s].name} ${Math.round(n / tr.N * 100)}%</span>`).join('')}</div>
          <div class="kv">
            <b>Круг</b><span>${(tr.L / 1000).toFixed(2)} км × ${t.laps}${tr.climb > 8 ? ` · набор ${Math.round(tr.climb)} м` : ''}</span>
            <b>Важно</b><span>${esc(t.focus)}</span>
            <b>Призы</b><span>${fmtMoney(t.prize)} / ${fmtMoney(t.prize * D.PRIZE_SHARE[1])} / ${fmtMoney(t.prize * D.PRIZE_SHARE[2])}</span>
            <b>Прогноз</b><span><span class="stars">${starStr(fc.stars)}</span> <span class="muted">круг ≈ ${fmtTime(fc.lap)}</span></span>
            ${best ? `<b>Рекорд</b><span>${best}-е место${st.bestTime[t.id] ? ' · ' + fmtTime(st.bestTime[t.id]) : ''}</span>` : ''}
          </div>
          <div class="spacer"></div>
          ${unlocked ? `<button class="btn primary" data-race="${t.id}">Старт ▶</button>`
            : `<button class="btn" disabled>🔒 Топ-3 на «${esc(D.TRACKS[i - 1].name)}»</button>`}
        </div>`;
      const cv = $('canvas', card);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = tr.env.ground; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, cv.width, cv.height);
      window.Render.drawTrackMap(ctx, tr, cv.width, cv.height, { lw: 9, pad: 26 });
      grid.appendChild(card);
    });
  }

  // ── Тренировки гонщика ─────────────────────────────────────
  function renderTraining(root) {
    const st = UI.state;
    const sk = st.rider.skills;
    const pr = GS.riderProfile(sk);
    const lvl = GS.riderLevel(sk);
    root.innerHTML = `
      <div class="section-title"><h2>Тренировки</h2><p>Велосипед — половина успеха. Вторая половина — ноги гонщика. Тренировки действуют на любом велосипеде.</p></div>
      <div class="rider-card">
        <div>${window.BikeArt.riderSvg(lvl, '#ff2d55')}</div>
        <div>
          <input class="rider-name" id="rider-name" maxlength="20" value="${esc(st.rider.name)}" aria-label="Имя гонщика">
          <div class="muted">Уровень ${lvl} · гонок ${st.races}, побед ${st.wins}</div>
          <div class="rider-attrs">
            <div class="kv"><b>Класс гонщика</b><span>${Math.round(pr.skill * 100)}%</span></div>
            <div class="kv"><b>Запас энергии</b><span>${pr.energyMax}</span></div>
            <div class="kv"><b>Восстановление</b><span>${pr.regen.toFixed(1)}/с</span></div>
            <div class="kv"><b>Сила спурта</b><span>+${Math.round((pr.sprintBoost - 1) * 100)}% к скорости</span></div>
            <div class="kv"><b>На колесе</b><span>+${(pr.draft * 100).toFixed(1)}% к скорости</span></div>
            <div class="kv"><b>Смелость в поворотах</b><span>${Math.round(pr.corner * 100)}%</span></div>
          </div>
        </div>
      </div>
      <div class="trainings" id="trainings"></div>`;
    const nameInput = $('#rider-name', root);
    nameInput.onchange = () => { st.rider.name = nameInput.value.trim().slice(0, 20) || 'Вы'; commit(); };
    const box = $('#trainings', root);
    D.RIDER_SKILLS.forEach((k) => {
      const level = sk[k.id];
      const max = level >= D.RIDER_MAX;
      const price = max ? 0 : GS.trainingPrice(k.id, level);
      const div = document.createElement('div');
      div.className = 'training';
      div.innerHTML = `
        <div class="head"><div class="icon">${k.icon}</div><div><b>${esc(k.name)}</b><div class="muted" style="font-size:13px">${esc(k.training)}</div></div></div>
        <div class="chips"><span class="chip good">${esc(k.effect)}</span></div>
        <div class="row"><div class="pips wide">${Array.from({ length: D.RIDER_MAX }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</div>
          <span class="spacer"></span><span class="muted" style="font-size:13px">${level}/${D.RIDER_MAX}</span></div>
        ${max ? '<span class="badge">Максимум</span>' : `<button class="btn gold" ${st.money < price ? 'disabled' : ''}>Тренироваться · ${fmtMoney(price)}</button>`}`;
      const b = $('button', div);
      if (b) b.onclick = () => {
        if (st.money < price) return;
        st.money -= price;
        sk[k.id]++;
        commit(true);
        toast(`${k.icon} ${k.name}: уровень ${sk[k.id]}`);
        render();
      };
      box.appendChild(div);
    });
  }

  // ── Перед стартом: прогноз и тактика ────────────────────────
  function openPrerace(trackId) {
    const st = UI.state;
    const t = D.trackById(trackId);
    const bike = D.bikeById(st.active);
    const o = st.owned[st.active];
    const stats = ownedStats(st.active);
    const fc = forecast(trackId, stats, o.wheel);
    const el = $('#prerace');
    el.innerHTML = `
      <div class="panel">
        <div class="muted">Трасса · ${t.laps} круга · ${esc(t.focus)}</div>
        <h2 style="margin:0">${esc(t.name)}</h2>
        <div class="prerace-bike">
          <div class="photo" id="pre-photo"></div>
          <div>
            <b>${esc(bike.name)}</b>
            <div class="muted" style="font-size:13px">${esc(D.WHEELS[o.wheel].name)}</div>
            <div style="margin-top:6px">Прогноз: <span class="stars">${starStr(fc.stars)}</span></div>
            <div class="muted" style="font-size:13px">Круг ≈ ${fmtTime(fc.lap)} · гонщик ур. ${GS.riderLevel(st.rider.skills)}</div>
          </div>
        </div>
        <b>Тактика на гонку</b>
        <div class="tactics">${D.TACTICS.map((x) => `<button class="tactic ${x.id === st.tactic ? 'selected' : ''}" data-tactic="${x.id}"><b>${x.icon} ${esc(x.name)}</b><small>${esc(x.desc)}</small></button>`).join('')}</div>
        <div class="muted" style="font-size:13px">Во время гонки велосипед едет сам. Кнопка ⚡ «Спурт» даёт рывок на 4 секунды, если хватает энергии.</div>
        <div class="row" style="margin-top:6px">
          <button class="btn primary" id="pre-start" style="flex:1">Старт ▶</button>
          <button class="btn" id="pre-cancel">Отмена</button>
        </div>
      </div>`;
    window.BikePhotos.attach($('#pre-photo', el), bike, o.wheel);
    el.querySelectorAll('[data-tactic]').forEach((b) => {
      b.onclick = () => {
        st.tactic = b.dataset.tactic;
        commit();
        el.querySelectorAll('[data-tactic]').forEach((x) => x.classList.toggle('selected', x === b));
      };
    });
    el.hidden = false;
    $('#pre-cancel', el).onclick = () => { el.hidden = true; render(); };
    el.onclick = (e) => { if (e.target === el) { el.hidden = true; render(); } };
    $('#pre-start', el).onclick = () => { el.hidden = true; UI.onStartRace(trackId); };
  }

  // ── Гараж ──────────────────────────────────────────────────
  function renderGarage(root) {
    const st = UI.state;
    const ids = D.BIKES.filter((b) => st.owned[b.id]).map((b) => b.id);
    if (!UI.garageSel || !st.owned[UI.garageSel]) UI.garageSel = st.active;
    root.innerHTML = `
      <div class="section-title"><h2>Гараж</h2><p>Улучшайте компоненты и подбирайте колёса под покрытие трассы.</p></div>
      <div class="garage">
        <div class="garage-list" id="glist"></div>
        <div class="detail" id="gdetail"></div>
      </div>`;
    const list = $('#glist', root);
    ids.forEach((id) => {
      const b = D.bikeById(id);
      const btn = document.createElement('button');
      btn.className = 'garage-item' + (id === UI.garageSel ? ' selected' : '');
      btn.innerHTML = `<div class="thumb"><div class="photo"></div></div>
        <div><div style="font-weight:700">${esc(b.name)}</div><div class="muted" style="font-size:12px">${D.BIKE_TYPES[b.type]}${id === st.active ? ' · <span style="color:var(--good)">в гонке</span>' : ''}</div></div>`;
      window.BikePhotos.attach($('.photo', btn), b);
      btn.onclick = () => { UI.garageSel = id; render(); };
      list.appendChild(btn);
    });
    const shopBtn = document.createElement('button');
    shopBtn.className = 'btn';
    shopBtn.textContent = '🛒 Купить ещё велосипед';
    shopBtn.onclick = () => show('shop');
    list.appendChild(shopBtn);
    renderBikeDetail($('#gdetail', root), UI.garageSel);
  }

  function wheelChips(w) {
    const keys = ['asphalt', 'cobble', 'gravel', 'dirt', 'sand', 'snow'];
    const roll = keys.map((k) => {
      const v = Math.round(w.roll[k] * 100);
      return `<span class="chip ${v >= 90 ? 'good' : v < 60 ? 'bad' : ''}" title="Накат">${D.SURFACES[k].name.split(' ')[0]} ${v}%</span>`;
    }).join('');
    const mods = Object.entries(w.mods).map(([k, v]) => `<span class="chip ${v > 0 ? 'good' : 'bad'}">${D.STAT_NAMES[k]} ${v > 0 ? '+' : ''}${v}</span>`).join('');
    return `<div class="chips">${roll}${mods}</div>`;
  }

  function renderBikeDetail(el, id) {
    const st = UI.state;
    const bike = D.bikeById(id);
    const o = st.owned[id];
    const stats = GS.effectiveStats(id, o.upgrades, o.wheel, st.rider.skills);
    el.innerHTML = `
      <div class="detail-head">
        <div class="photo" id="dphoto"></div>
        <div class="info">
          <div class="muted" style="font-weight:700;letter-spacing:1px">${esc(bike.brand.toUpperCase())}${bike.maker ? ` · ${esc(bike.maker)}` : ''}</div>
          <div class="row"><h2 style="margin:0">${esc(bike.model)}</h2><span class="badge">${D.BIKE_TYPES[bike.type]}</span></div>
          <div class="muted">${esc(bike.desc)}</div>
          ${statBars(stats, bike.stats)}
          <div class="row">
            ${id === st.active ? '<span class="badge hot">Выбран для гонок</span>' : `<button class="btn primary" id="btn-activate">Выбрать для гонок</button>`}
            <span class="muted" style="font-size:12px">Синий — база, оранжевый — улучшения, колёса и тренировки</span>
          </div>
        </div>
      </div>
      <section>
        <h3>Колёса и покрышки <span class="muted" style="font-size:13px;font-weight:500">· посадка: ${bike.sizes.map((s) => D.WHEEL_SIZE_NAMES[s]).join(', ')}</span></h3>
        <div class="upgrades" id="wheels"></div>
      </section>
      <section>
        <h3>Улучшения</h3>
        <div class="upgrades" id="ups"></div>
      </section>
      <section>
        <h3>Прогноз по трассам</h3>
        <div class="forecast" id="fc"></div>
      </section>`;
    window.BikePhotos.attach($('#dphoto', el), bike, o.wheel);
    const act = $('#btn-activate', el);
    if (act) act.onclick = () => { st.active = id; commit(); toast(`${bike.name} — готов к старту`); render(); };

    const wl = $('#wheels', el);
    Object.entries(D.WHEELS).filter(([wid]) => GS.wheelFits(id, wid)).forEach(([wid, w]) => {
      const owned = st.wheels.includes(wid);
      const mounted = o.wheel === wid;
      const div = document.createElement('div');
      div.className = 'wheel' + (mounted ? ' mounted' : '');
      div.innerHTML = `
        <div class="row"><b>${esc(w.name)}</b></div>
        <div class="muted" style="font-size:13px">${esc(w.desc)}</div>
        ${wheelChips(w)}
        <div class="row"><span class="spacer"></span>
          ${mounted ? '<span class="badge" style="color:var(--good)">Установлены</span>'
            : owned ? '<button class="btn small">Установить</button>'
              : `<button class="btn small gold" ${st.money < w.price ? 'disabled' : ''}>Купить ${fmtMoney(w.price)}</button>`}
        </div>`;
      const b = $('button', div);
      if (b) b.onclick = () => {
        if (!owned) {
          if (st.money < w.price) return;
          st.money -= w.price;
          st.wheels.push(wid);
          toast(`Куплено: ${w.name}`);
        }
        o.wheel = wid;
        commit(!owned);
        render();
      };
      wl.appendChild(div);
    });

    const ul = $('#ups', el);
    D.UPGRADES.forEach((up) => {
      const lvl = o.upgrades[up.id];
      const max = lvl >= D.MAX_UPGRADE;
      const price = max ? 0 : GS.upgradePrice(id, up.id, lvl);
      const div = document.createElement('div');
      div.className = 'upgrade';
      div.innerHTML = `
        <div class="row"><span style="font-size:20px">${up.icon}</span><b>${esc(up.name)}</b></div>
        <div class="chips">${Object.entries(up.mods).map(([k, v]) => `<span class="chip good">${D.STAT_NAMES[k]} +${v}/ур.</span>`).join('')}</div>
        <div class="row"><div class="pips">${Array.from({ length: D.MAX_UPGRADE }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
          <span class="spacer"></span>
          ${max ? '<span class="badge">Максимум</span>' : `<button class="btn small gold" ${st.money < price ? 'disabled' : ''}>Улучшить ${fmtMoney(price)}</button>`}
        </div>`;
      const b = $('button', div);
      if (b) b.onclick = () => {
        if (st.money < price) return;
        st.money -= price;
        o.upgrades[up.id]++;
        commit(true);
        render();
      };
      ul.appendChild(div);
    });

    const fc = $('#fc', el);
    D.TRACKS.forEach((t) => {
      const f = forecast(t.id, stats, o.wheel);
      const row = document.createElement('div');
      row.innerHTML = `<span>${esc(t.name)}</span><span><span class="stars">${starStr(f.stars)}</span> <span class="muted">${fmtTime(f.lap)}</span></span>`;
      fc.appendChild(row);
    });
  }

  // ── Магазин ────────────────────────────────────────────────
  function renderShop(root) {
    const st = UI.state;
    root.innerHTML = `
      <div class="section-title"><h2>Магазин велосипедов</h2><p>Только реальные бренды и модели: Specialized, Pinarello, Colnago, Canyon, Cervélo, Bianchi, Giant, Trek, Scott, Cannondale, Orbea, Surly, Brompton, Mongoose, Rockrider. Каждая сильна в своём.</p></div>
      <div class="grid" id="shop-grid"></div>`;
    const grid = $('#shop-grid', root);
    D.BIKES.forEach((b) => {
      const owned = !!st.owned[b.id];
      const card = document.createElement('div');
      card.className = 'card' + (b.id === st.active ? ' selected' : '');
      card.innerHTML = `
        <div class="photo"></div>
        <div class="body">
          <div class="muted" style="font-weight:700;letter-spacing:1px;font-size:12px">${esc(b.brand.toUpperCase())}${b.maker ? ` · ${esc(b.maker)}` : ''}</div>
          <div class="row"><h3 style="margin:0">${esc(b.model)}</h3></div>
          <div class="row"><span class="badge">${D.BIKE_TYPES[b.type]}</span><span class="badge">${D.WHEEL_SIZE_NAMES[D.WHEELS[b.stockWheel].size]}</span><span class="badge">Класс ${ROMAN[b.tier - 1]}</span></div>
          <div class="muted" style="font-size:13px">${esc(b.desc)}</div>
          <div style="font-size:13px"><b>Сильные стороны:</b> ${strengths(b)}</div>
          ${statBars(b.stats)}
          <div class="spacer"></div>
          <div class="row"><b style="font-size:18px">${b.price ? fmtMoney(b.price) : 'Бесплатно'}</b><span class="spacer"></span>
            ${owned ? '<button class="btn" data-own>В гараже ›</button>' : `<button class="btn gold" data-buy ${st.money < b.price ? 'disabled' : ''}>Купить</button>`}
          </div>
        </div>`;
      window.BikePhotos.attach($('.photo', card), b);
      const buy = $('[data-buy]', card);
      if (buy) buy.onclick = () => {
        if (st.money < b.price) return;
        st.money -= b.price;
        GS.grantBike(st, b.id);
        st.active = b.id;
        UI.garageSel = b.id;
        commit(true);
        toast(`Поздравляем с покупкой: ${b.name}!`);
        show('garage');
      };
      const own = $('[data-own]', card);
      if (own) own.onclick = () => { UI.garageSel = b.id; show('garage'); };
      grid.appendChild(card);
    });
  }

  function render() {
    const root = $('#screen');
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.screen === UI.screen));
    if (UI.screen === 'tracks') renderTracks(root);
    else if (UI.screen === 'training') renderTraining(root);
    else if (UI.screen === 'garage') renderGarage(root);
    else renderShop(root);
    root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => show(b.dataset.go); });
    root.querySelectorAll('[data-race]').forEach((b) => { b.onclick = () => openPrerace(b.dataset.race); });
  }

  function show(screen) {
    UI.screen = screen;
    render();
    window.scrollTo(0, 0);
  }

  // ── Итоги гонки ────────────────────────────────────────────
  function showResults(race, onAgain, onMenu) {
    const st = UI.state;
    const t = race.def;
    const res = race.results;
    const myIdx = res.findIndex((r) => r.rider.isPlayer);
    const place = myIdx + 1;
    const prize = Math.round(t.prize * (D.PRIZE_SHARE[myIdx] || 0) / 10) * 10;
    const myTime = res[myIdx].time;
    const prevBest = st.best[t.id];
    st.money += prize;
    st.races++;
    if (place === 1) st.wins++;
    if (!prevBest || place < prevBest) st.best[t.id] = place;
    if (!st.bestTime[t.id] || myTime < st.bestTime[t.id]) st.bestTime[t.id] = myTime;
    const idx = D.TRACKS.findIndex((x) => x.id === t.id);
    const unlockedNew = place <= 3 && (!prevBest || prevBest > 3) && D.TRACKS[idx + 1] && idx + 1 >= 2;
    commit(true);

    const el = $('#results');
    el.innerHTML = `
      <div class="panel results">
        <div class="results-place">${MEDALS[place - 1] || '🚴'} ${place}-е место</div>
        <div class="muted">${esc(t.name)} · ${race.player.finished ? 'ваше время' : 'не успели финишировать, расчётное время'} ${fmtTime(myTime)}${race.player.bestLap ? ` · лучший круг ${fmtTime(race.player.bestLap)}` : ''}</div>
        <div style="font-size:20px;font-weight:800">Приз: ${fmtMoney(prize)}</div>
        ${unlockedNew ? `<div class="badge hot" style="align-self:flex-start">Открыта трасса «${esc(D.TRACKS[idx + 1].name)}»!</div>` : ''}
        <table>
          <tr><th>#</th><th>Гонщик</th><th>Велосипед</th><th class="num">Время</th></tr>
          ${res.map((r, i) => `<tr class="${r.rider.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.rider.name)}</td><td>${esc(D.bikeById(r.rider.bikeId).name)}</td><td class="num">${r.rider.finished ? '' : '≈'}${fmtTime(r.time)}</td></tr>`).join('')}
        </table>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" id="res-again">Ещё раз</button>
          <button class="btn" id="res-garage">В гараж</button>
          <button class="btn" id="res-menu">К трассам</button>
        </div>
      </div>`;
    el.hidden = false;
    $('#res-again', el).onclick = () => { el.hidden = true; onAgain(); };
    $('#res-garage', el).onclick = () => { el.hidden = true; onMenu('garage'); };
    $('#res-menu', el).onclick = () => { el.hidden = true; onMenu('tracks'); };
  }

  function init(state, onStartRace) {
    UI.state = state;
    UI.onStartRace = onStartRace;
    document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => show(b.dataset.screen); });
    commit();
    render();
  }

  window.UI = { init, show, render, showResults, fmtTime, commit, toast, state: () => UI.state };
})();
