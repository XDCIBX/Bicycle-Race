// Меню: гонки (трассы, чемпионаты, триатлон), гонщик (уровень, дерево навыков, тренировки),
// гараж (улучшения и колёса), магазин, трофеи (медали и кубки), итоги гонок.
(function () {
  'use strict';
  const D = window.GameData;
  const GS = window.GameState;
  const PR = window.Progression;
  const TRI = window.Triathlon;

  const UI = {
    state: null,
    screen: 'race',
    sub: { race: 'tracks', rider: 'skills' },
    garageSel: null,
    start: null, // колбэк запуска гонки: ({ mode, id, champ })
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMoney = (n) => '🪙 ' + Math.round(n).toLocaleString('ru-RU');
  function fmtTime(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  const MEDAL_EMOJI = ['🥇', '🥈', '🥉'];
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const KIND_NAME = { gold: 'Золото', silver: 'Серебро', bronze: 'Бронза' };

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  function commit(flash) {
    GS.save(UI.state);
    const m = $('#money');
    m.textContent = fmtMoney(UI.state.money);
    if (flash) { m.classList.remove('flash'); void m.offsetWidth; m.classList.add('flash'); }
    const lv = $('#hdr-level');
    if (lv) lv.textContent = `Ур. ${PR.level(UI.state)}`;
  }

  // ── Медали и кубки (SVG) ───────────────────────────────────
  const METAL = {
    gold: ['#fff3a8', '#ffd23f', '#b8860b'], silver: ['#ffffff', '#cfd5dc', '#7e8791'], bronze: ['#ffd1a3', '#d98b4a', '#7d4a1f'],
    none: ['#4a5160', '#353b47', '#252a33'],
  };
  function medalSvg(kind, label, size) {
    const [a, b, c] = METAL[kind] || METAL.none;
    const id = `m${Math.random().toString(36).slice(2, 8)}`;
    return `<svg viewBox="0 0 100 130" width="${size || 56}" height="${(size || 56) * 1.3}" aria-hidden="true">
      <defs><radialGradient id="${id}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient></defs>
      <path d="M22 0 L46 48 L36 54 L10 6 Z" fill="#d7263d"/><path d="M78 0 L54 48 L64 54 L90 6 Z" fill="#1b4f9c"/>
      <circle cx="50" cy="86" r="38" fill="url(#${id})" stroke="${c}" stroke-width="3"/>
      <circle cx="50" cy="86" r="29" fill="none" stroke="${a}" stroke-opacity=".7" stroke-width="2"/>
      <text x="50" y="88" text-anchor="middle" dominant-baseline="central" font-family="'Arial Black',Arial" font-weight="900" font-size="${label && label.length > 2 ? 18 : 30}" fill="${c}">${esc(label || '')}</text>
    </svg>`;
  }
  function cupSvg(kind, color, size) {
    const [a, b, c] = METAL[kind] || METAL.none;
    const id = `c${Math.random().toString(36).slice(2, 8)}`;
    return `<svg viewBox="0 0 120 150" width="${size || 90}" height="${(size || 90) * 1.25}" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}"/><stop offset=".3" stop-color="${a}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
      <path d="M28 18 Q6 18 8 42 Q10 64 38 70" fill="none" stroke="url(#${id})" stroke-width="8"/>
      <path d="M92 18 Q114 18 112 42 Q110 64 82 70" fill="none" stroke="url(#${id})" stroke-width="8"/>
      <path d="M26 10 H94 Q94 70 60 84 Q26 70 26 10 Z" fill="url(#${id})"/>
      <ellipse cx="60" cy="11" rx="34" ry="6" fill="${a}" opacity=".7"/>
      <rect x="53" y="82" width="14" height="22" fill="url(#${id})"/>
      <path d="M38 104 H82 L88 118 H32 Z" fill="url(#${id})"/>
      <rect x="26" y="118" width="68" height="24" rx="4" fill="${color || '#333'}"/>
      <rect x="34" y="124" width="52" height="12" rx="2" fill="#000" opacity=".25"/>
      <text x="60" y="44" text-anchor="middle" font-family="'Arial Black',Arial" font-weight="900" font-size="26" fill="${c}" opacity=".55">${kind === 'gold' ? '1' : kind === 'silver' ? '2' : kind === 'bronze' ? '3' : '?'}</text>
    </svg>`;
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
    return D.STAT_KEYS.slice().sort((a, b) => s[b] - s[a]).slice(0, 2).map((k) => D.STAT_NAMES[k]).join(', ');
  }
  function ownedStats(bikeId) {
    const st = UI.state, o = st.owned[bikeId];
    return GS.effectiveStats(bikeId, o.upgrades, o.wheel, st.rider.skills, st.perks);
  }

  const refCache = {};
  function refLap(trackId) {
    if (refCache[trackId]) return refCache[trackId];
    const tr = window.Tracks.get(trackId);
    let best = Infinity;
    D.BIKES.forEach((b) => Object.keys(D.WHEELS).forEach((w) => {
      if (b.sizes.includes(D.WHEELS[w].size)) best = Math.min(best, window.Tracks.estimateLap(tr, GS.effectiveStats(b.id, null, w), w));
    }));
    return (refCache[trackId] = best);
  }
  function forecast(trackId, stats, wheel) {
    const lap = window.Tracks.estimateLap(window.Tracks.get(trackId), stats, wheel);
    const ratio = refLap(trackId) / lap;
    return { lap, stars: Math.max(1, Math.min(5, Math.round((ratio - 0.62) / 0.36 * 5))) };
  }
  function isUnlocked(i) {
    if (i < 2) return true;
    return (UI.state.best[D.TRACKS[i - 1].id] || 99) <= 3;
  }

  // Заголовок с уровнем гонщика и шкалой опыта.
  function levelBar() {
    const st = UI.state;
    const li = PR.levelInfo(st.xp || 0);
    const pct = li.need ? Math.round(li.into / li.need * 100) : 100;
    const free = PR.pointsFree(st);
    return `<div class="levelbar">
      <div class="lvl-badge">${li.level}</div>
      <div style="flex:1;min-width:0">
        <div class="row"><b>${esc(st.rider.name)}</b><span class="muted" style="font-size:13px">уровень ${li.level}${li.need ? ` · ${li.into}/${li.need} XP` : ' · максимум'}</span>
          ${free > 0 ? `<span class="badge hot" data-go-rider="skills">+${free} очк. навыков</span>` : ''}</div>
        <div class="xpbar"><div style="width:${pct}%"></div></div>
      </div>
    </div>`;
  }

  function subTabs(group, items) {
    return `<div class="segmented">${items.map(([id, label]) => `<button data-sub="${group}:${id}" class="${UI.sub[group] === id ? 'active' : ''}">${label}</button>`).join('')}</div>`;
  }

  // ═════════ ГОНКИ ═════════
  function renderRace(root) {
    const st = UI.state;
    const bike = D.bikeById(st.active);
    const o = st.owned[st.active];
    root.innerHTML = `
      ${levelBar()}
      <div class="active-bike">
        <div class="photo" id="active-photo"></div>
        <div style="flex:1;min-width:0">
          <div class="muted">Ваш велосипед</div>
          <h2 style="margin:0">${esc(bike.name)}</h2>
          <div class="muted">${D.BIKE_TYPES[bike.type]} · ${esc(D.WHEELS[o.wheel].name)}</div>
        </div>
        <button class="btn" data-go="garage">Сменить / улучшить</button>
      </div>
      ${subTabs('race', [['tracks', '🚴 Трассы'], ['champs', '🏆 Чемпионаты'], ['tri', '🏊 Триатлон']])}
      <div id="race-sub"></div>`;
    window.BikePhotos.attach($('#active-photo', root), bike, o.wheel);
    const sub = $('#race-sub', root);
    if (UI.sub.race === 'champs') renderChamps(sub);
    else if (UI.sub.race === 'tri') renderTri(sub);
    else renderTracks(sub);
  }

  function renderTracks(root) {
    const st = UI.state;
    const o = st.owned[st.active];
    const stats = ownedStats(st.active);
    root.innerHTML = `<div class="section-title"><h2>Трассы</h2><p>Велосипед едет сам — исход решают характеристики, колёса, навыки гонщика и тактика. Топ-3 открывает следующую трассу.</p></div>
      <div class="grid" id="track-grid"></div>`;
    const grid = $('#track-grid', root);
    D.TRACKS.forEach((t, i) => {
      const tr = window.Tracks.get(t.id);
      const unlocked = isUnlocked(i);
      const fc = forecast(t.id, stats, o.wheel);
      const comp = {};
      tr.samples.forEach((p) => { comp[p.surface] = (comp[p.surface] || 0) + 1; });
      const compArr = Object.entries(comp).sort((a, b) => b[1] - a[1]);
      const best = st.best[t.id];
      const medals = (st.trophies.medals || []).filter((m) => m.event === t.id);
      const card = document.createElement('div');
      card.className = 'card' + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="track-thumb"><img alt="${esc(t.name)}"><canvas width="150" height="110"></canvas>
          ${medals.length ? `<div class="thumb-medals">${['gold', 'silver', 'bronze'].map((k) => { const n = medals.filter((m) => m.kind === k).length; return n ? `<span>${MEDAL_EMOJI[['gold', 'silver', 'bronze'].indexOf(k)]}×${n}</span>` : ''; }).join('')}</div>` : ''}</div>
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
          ${unlocked ? `<button class="btn primary" data-start="cycle:${t.id}">Старт ▶</button>`
            : `<button class="btn" disabled>🔒 Топ-3 на «${esc(D.TRACKS[i - 1].name)}»</button>`}
        </div>`;
      grid.appendChild(card);
      const img = $('img', card);
      // 2.5D-кадр трассы рисуем асинхронно, чтобы меню открывалось мгновенно.
      setTimeout(() => { if (img.isConnected) img.src = window.Render.renderPreview(tr, 560, 315); }, 30 + i * 40);
      const cv = $('canvas', card);
      window.Render.drawTrackMap(cv.getContext('2d'), tr, cv.width, cv.height, { lw: 3, pad: 10 });
    });
  }

  // ── Чемпионаты ──
  function stageName(mode, id) {
    return mode === 'tri' ? TRI.eventById(id).name : D.trackById(id).name;
  }
  function renderChamps(root) {
    const st = UI.state;
    const lvl = PR.level(st);
    const ch = st.champ;
    let html = '';
    if (ch) {
      const c = PR.champById(ch.id);
      const table = PR.standings(st);
      const next = c.stages[ch.stage];
      html += `<div class="champ-active">
        <div class="row"><div>${cupSvg('gold', c.color, 64)}</div>
          <div style="flex:1"><div class="muted">Текущий чемпионат · ${c.mode === 'tri' ? 'триатлон' : 'велогонки'}</div><h2 style="margin:0">${esc(c.name)}</h2>
          <div class="stages">${c.stages.map((sid, i) => `<span class="stage ${i < ch.stage ? 'done' : i === ch.stage ? 'now' : ''}">${i < ch.stage ? '✓' : i + 1}. ${esc(stageName(c.mode, sid))}</span>`).join('')}</div></div></div>
        ${table.length ? `<table class="standings"><tr><th>#</th><th>Гонщик</th><th class="num">Очки</th></tr>${table.map((r, i) => `<tr class="${r.name === st.rider.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="num">${r.points}</td></tr>`).join('')}</table>` : '<div class="muted">Очки: 25 / 18 / 15 / 12 / 10 / 8 за места 1–6 на каждом этапе.</div>'}
        <div class="row" style="margin-top:8px">
          <button class="btn primary" data-start="${c.mode}:${next}:champ">Этап ${ch.stage + 1}: ${esc(stageName(c.mode, next))} ▶</button>
          <button class="btn" id="champ-quit">Сняться с чемпионата</button>
        </div></div>`;
    }
    html += `<div class="section-title"><h2>Чемпионаты</h2><p>Серия этапов с одними и теми же соперниками. Очки за каждый этап, кубок — за итоговое место в общем зачёте.</p></div><div class="grid">`;
    PR.CHAMPIONSHIPS.forEach((c) => {
      const cups = (st.trophies.cups || []).filter((x) => x.champ === c.id);
      const bestCup = ['gold', 'silver', 'bronze'].find((k) => cups.some((x) => x.kind === k));
      const locked = lvl < c.level;
      html += `<div class="card champ-card ${locked ? 'locked' : ''}">
        <div class="champ-cup">${cupSvg(bestCup || 'none', c.color, 76)}</div>
        <div class="body">
          <div class="row"><h3 style="margin:0">${esc(c.name)}</h3><span class="spacer"></span><span class="badge">${c.mode === 'tri' ? '🏊 Триатлон' : '🚴 Вело'}</span></div>
          <div class="muted" style="font-size:13px">${c.stages.map((sid, i) => `${i + 1}. ${esc(stageName(c.mode, sid))}`).join(' · ')}</div>
          <div class="kv"><b>Уровень</b><span>от ${c.level}</span><b>Призовой фонд</b><span>${fmtMoney(c.prize)}</span>
            ${cups.length ? `<b>Кубки</b><span>${cups.map((x) => MEDAL_EMOJI[['gold', 'silver', 'bronze'].indexOf(x.kind)]).join(' ')}</span>` : ''}</div>
          <div class="spacer"></div>
          ${locked ? `<button class="btn" disabled>🔒 Нужен уровень ${c.level}</button>`
            : ch ? `<button class="btn" disabled>${ch.id === c.id ? 'Идёт сейчас' : 'Сначала завершите текущий'}</button>`
              : `<button class="btn primary" data-champ="${c.id}">Начать чемпионат</button>`}
        </div></div>`;
    });
    html += '</div>';
    root.innerHTML = html;
    root.querySelectorAll('[data-champ]').forEach((b) => {
      b.onclick = () => { PR.startChamp(st, b.dataset.champ); commit(); toast('Чемпионат начался!'); render(); };
    });
    const q = $('#champ-quit', root);
    if (q) q.onclick = () => { if (confirm('Сняться с чемпионата? Набранные очки сгорят.')) { st.champ = null; commit(); render(); } };
  }

  // ── Триатлон ──
  function triProfileOf(st) { return TRI.triProfile(st.tri.skills, st.perks); }
  function triForecast(ev) {
    const st = UI.state;
    const tp = triProfileOf(st);
    const o = st.owned[st.active];
    let t = 0;
    ev.legs.forEach(([k, km]) => {
      if (k === 't1') t += tp.t1; else if (k === 't2') t += tp.t2;
      else if (k === 'swim') t += km * 1000 / tp.swimV;
      else if (k === 'run') t += km * 1000 / tp.runV;
      else if (k === 'bike') t += km * 1000 / TRI.bikeSpeed(ev.bikeTrack, ownedStats(st.active), o.wheel, GS.riderProfile(st.rider.skills, st.perks).skill);
    });
    return t;
  }
  function legsLine(ev) {
    return ev.legs.filter(([k]) => k[0] !== 't').map(([k, km]) => `${TRI.LEG_INFO[k].icon} ${km} км`).join('  ');
  }
  function renderTri(root) {
    const st = UI.state;
    const lvl = PR.level(st);
    const tp = triProfileOf(st);
    const sk = st.tri.skills;
    root.innerHTML = `<div class="section-title"><h2>Триатлон</h2><p>Плавание, велоэтап на вашем велосипеде и бег. Разделочные и аэро-велосипеды здесь особенно сильны. Следите за гликогеном: гели и темп решают длинные дистанции.</p></div>
      <div class="tri-summary">
        ${D.TRI_SKILLS.map((k) => `<div><span>${k.icon}</span><b>${sk[k.id]}</b><small>${esc(k.name)}</small></div>`).join('')}
        <div><span>🏊</span><b>${TRI.fmtPace('swim', tp.swimV)}</b><small>темп плавания</small></div>
        <div><span>🏃</span><b>${TRI.fmtPace('run', tp.runV)}</b><small>темп бега</small></div>
        <button class="btn" data-go-rider="tri">Тренировать ›</button>
      </div>
      <div class="grid" id="tri-grid"></div>`;
    const grid = $('#tri-grid', root);
    TRI.EVENTS.forEach((ev) => {
      const locked = lvl < ev.level;
      const best = st.tri.best[ev.id], bestT = st.tri.bestTime[ev.id];
      const fc = triForecast(ev);
      const card = document.createElement('div');
      card.className = 'card' + (locked ? ' locked' : '');
      card.innerHTML = `
        <div class="tri-banner tier${ev.tier}"><div class="tri-legs">${ev.legs.filter(([k]) => k[0] !== 't').map(([k]) => `<span>${TRI.LEG_INFO[k].icon}</span>`).join('<i>›</i>')}</div><b>${esc(ev.name)}</b></div>
        <div class="body">
          <div class="muted">${esc(ev.desc)}</div>
          <div class="kv">
            <b>Дистанция</b><span>${legsLine(ev)}</span>
            <b>Место</b><span>${esc(ev.place)}</span>
            <b>Уровень</b><span>от ${ev.level} · сложность ${ROMAN[ev.tier - 1]}</span>
            <b>Призы</b><span>${fmtMoney(ev.prize)} / ${fmtMoney(ev.prize * D.PRIZE_SHARE[1])} / ${fmtMoney(ev.prize * D.PRIZE_SHARE[2])}</span>
            <b>Прогноз</b><span>≈ ${TRI.fmtClock(fc)}${ev.cutoff ? ` · лимит ${TRI.fmtClock(ev.cutoff)}` : ''}</span>
            ${best ? `<b>Лучшее</b><span>${best}-е место · ${TRI.fmtClock(bestT)}</span>` : ''}
          </div>
          <div class="spacer"></div>
          ${locked ? `<button class="btn" disabled>🔒 Нужен уровень ${ev.level}</button>` : `<button class="btn primary" data-start="tri:${ev.id}">Старт ▶</button>`}
        </div>`;
      grid.appendChild(card);
    });
  }

  // ═════════ ГОНЩИК ═════════
  function renderRider(root) {
    const st = UI.state;
    const lvl = PR.level(st);
    const pr = GS.riderProfile(st.rider.skills, st.perks);
    const podiums = (st.trophies.medals || []).length;
    root.innerHTML = `
      <div class="rider-card">
        <div>${window.BikeArt.riderSvg(lvl, '#ff2d55')}</div>
        <div>
          <input class="rider-name" id="rider-name" maxlength="20" value="${esc(st.rider.name)}" aria-label="Имя гонщика">
          ${levelBar()}
          <div class="rider-attrs">
            <div class="kv"><b>Класс гонщика</b><span>${Math.round(pr.skill * 100)}%</span></div>
            <div class="kv"><b>Запас энергии</b><span>${pr.energyMax}</span></div>
            <div class="kv"><b>Сила спурта</b><span>+${Math.round((pr.sprintBoost - 1) * 100)}%</span></div>
            <div class="kv"><b>На колесе</b><span>+${(pr.draft * 100).toFixed(1)}%</span></div>
            <div class="kv"><b>Гонок / побед</b><span>${st.races} / ${st.wins}</span></div>
            <div class="kv"><b>Подиумов</b><span>${podiums}</span></div>
          </div>
        </div>
      </div>
      ${subTabs('rider', [['skills', '🌳 Навыки'], ['cycle', '🚴 Тренировки'], ['tri', '🏊 Триатлет']])}
      <div id="rider-sub"></div>`;
    const nameInput = $('#rider-name', root);
    nameInput.onchange = () => {
      const old = st.rider.name;
      st.rider.name = nameInput.value.trim().slice(0, 20) || 'Вы';
      if (st.champ && st.champ.points[old] != null) { st.champ.points[st.rider.name] = st.champ.points[old]; delete st.champ.points[old]; st.champ.history = st.champ.history.map((h) => h.map((n) => (n === old ? st.rider.name : n))); }
      commit(); render();
    };
    const sub = $('#rider-sub', root);
    if (UI.sub.rider === 'cycle') renderTrainings(sub, 'cycle');
    else if (UI.sub.rider === 'tri') renderTrainings(sub, 'tri');
    else renderSkillTree(sub);
  }

  function renderSkillTree(root) {
    const st = UI.state;
    const free = PR.pointsFree(st);
    root.innerHTML = `<div class="section-title"><h2>Дерево навыков</h2><p>Очки навыков даются за каждый уровень (и бонусные — каждые 5 уровней). Навыки открываются по уровню и по цепочке сверху вниз. Свободно очков: <b>${free}</b>.</p></div>
      <div class="tree">${PR.BRANCHES.map((br) => `
        <div class="branch" style="--bc:${br.color}">
          <div class="branch-head"><span>${br.icon}</span><b>${esc(br.name)}</b></div>
          ${PR.PERKS.filter((p) => p.branch === br.id).map((p) => {
    const state = PR.perkState(st, p);
    const label = { owned: '✓ Изучено', available: `Изучить · ${p.cost} очк.`, locked: `🔒 Уровень ${p.level}`, needreq: '🔒 Нужен предыдущий', nopoints: `Нужно ${p.cost} очк.` }[state];
    return `<div class="perk ${state}"><div class="perk-lvl">ур. ${p.level}</div><b>${esc(p.name)}</b><small>${esc(p.desc)}</small>
              <button class="btn small ${state === 'available' ? 'gold' : ''}" data-perk="${p.id}" ${state === 'available' ? '' : 'disabled'}>${label}</button></div>`;
  }).join('<div class="perk-link"></div>')}
        </div>`).join('')}</div>`;
    root.querySelectorAll('[data-perk]').forEach((b) => {
      b.onclick = () => {
        if (PR.buyPerk(st, b.dataset.perk)) {
          const p = PR.PERKS.find((x) => x.id === b.dataset.perk);
          commit(); toast(`Навык изучен: ${p.name}`); render();
        }
      };
    });
  }

  function renderTrainings(root, kind) {
    const st = UI.state;
    const cap = PR.trainingCap(st);
    const list = kind === 'tri' ? D.TRI_SKILLS : D.RIDER_SKILLS;
    const levels = kind === 'tri' ? st.tri.skills : st.rider.skills;
    const price = (k, lvl) => (kind === 'tri' ? Math.round(k.base * Math.pow(lvl + 1, 1.5) / 10) * 10 : GS.trainingPrice(k.id, lvl));
    root.innerHTML = `<div class="section-title"><h2>${kind === 'tri' ? 'Тренировки триатлета' : 'Тренировки велогонщика'}</h2>
      <p>Потолок тренированности растёт с уровнем гонщика: сейчас до <b>${cap}</b> из ${D.RIDER_MAX}. ${kind === 'tri' ? 'Велоэтап в триатлоне зависит от велосипеда и вело-тренировок.' : 'Действуют на любом велосипеде.'}</p></div>
      <div class="trainings" id="trainings"></div>`;
    const box = $('#trainings', root);
    list.forEach((k) => {
      const level = levels[k.id] || 0;
      const max = level >= D.RIDER_MAX;
      const capped = !max && level >= cap;
      const cost = max ? 0 : price(k, level);
      const needLvl = capped ? (level) * 2 : 0;
      const div = document.createElement('div');
      div.className = 'training';
      div.innerHTML = `
        <div class="head"><div class="icon">${k.icon}</div><div><b>${esc(k.name)}</b><div class="muted" style="font-size:13px">${esc(k.training)}</div></div></div>
        <div class="chips"><span class="chip good">${esc(k.effect)}</span></div>
        <div class="row"><div class="pips wide">${Array.from({ length: D.RIDER_MAX }, (_, i) => `<i class="${i < level ? 'on' : i < cap ? '' : 'cap'}"></i>`).join('')}</div>
          <span class="spacer"></span><span class="muted" style="font-size:13px">${level}/${D.RIDER_MAX}</span></div>
        ${max ? '<span class="badge">Максимум</span>' : capped ? `<button class="btn" disabled>🔒 Нужен уровень гонщика ${needLvl}</button>`
          : `<button class="btn gold" ${st.money < cost ? 'disabled' : ''}>Тренироваться · ${fmtMoney(cost)}</button>`}`;
      const b = $('button.gold', div);
      if (b) b.onclick = () => {
        if (st.money < cost) return;
        st.money -= cost;
        levels[k.id] = level + 1;
        const xp = PR.addXp(st, 15 + level * 5);
        commit(true);
        toast(`${k.icon} ${k.name}: уровень ${levels[k.id]} · +${xp.gained} XP${xp.levels ? ` · новый уровень ${xp.newLevel}!` : ''}`);
        render();
      };
      box.appendChild(div);
    });
  }

  // ═════════ ТРОФЕИ ═════════
  function renderTrophies(root) {
    const st = UI.state;
    const medals = st.trophies.medals || [];
    const cups = st.trophies.cups || [];
    const cnt = (k) => medals.filter((m) => m.kind === k).length;
    const events = [...D.TRACKS.map((t) => ({ id: t.id, name: t.name, mode: 'cycle' })), ...TRI.EVENTS.map((e) => ({ id: e.id, name: e.name, mode: 'tri' }))];
    const credits = window.BikePhotos.credits();
    root.innerHTML = `
      <div class="section-title"><h2>Трофеи</h2><p>Медали за подиумы в гонках и кубки за чемпионаты.</p></div>
      <div class="trophy-stats">
        <div>${medalSvg('gold', '1', 44)}<b>${cnt('gold')}</b><small>золото</small></div>
        <div>${medalSvg('silver', '2', 44)}<b>${cnt('silver')}</b><small>серебро</small></div>
        <div>${medalSvg('bronze', '3', 44)}<b>${cnt('bronze')}</b><small>бронза</small></div>
        <div>${cupSvg('gold', '#ffd400', 44)}<b>${cups.length}</b><small>кубков</small></div>
        <div><span style="font-size:36px">🏁</span><b>${st.races}</b><small>гонок</small></div>
      </div>
      <h3>Кубки чемпионатов</h3>
      <div class="cup-shelf">${PR.CHAMPIONSHIPS.map((c) => {
    const won = cups.filter((x) => x.champ === c.id);
    const best = ['gold', 'silver', 'bronze'].find((k) => won.some((x) => x.kind === k));
    return `<div class="cup ${best ? '' : 'empty'}">${cupSvg(best || 'none', c.color, 80)}<b>${esc(c.name)}</b><small>${best ? `${KIND_NAME[best]}${won.length > 1 ? ` · всего ${won.length}` : ''}` : `от уровня ${c.level}`}</small></div>`;
  }).join('')}</div>
      <h3>Медали по гонкам</h3>
      <div class="medal-wall">${events.map((e) => {
    const ms = medals.filter((m) => m.event === e.id);
    const best = e.mode === 'tri' ? st.tri.bestTime[e.id] : st.bestTime[e.id];
    return `<div class="medal-row ${ms.length ? '' : 'empty'}">
          <div class="medal-row-head"><span>${e.mode === 'tri' ? '🏊' : '🚴'}</span><b>${esc(e.name)}</b>${best ? `<small>рекорд ${e.mode === 'tri' ? TRI.fmtClock(best) : fmtTime(best)}</small>` : ''}</div>
          <div class="medal-list">${ms.length ? ['gold', 'silver', 'bronze'].map((k) => { const n = ms.filter((m) => m.kind === k).length; return n ? `<div class="medal-item">${medalSvg(k, String(['gold', 'silver', 'bronze'].indexOf(k) + 1), 40)}<span>×${n}</span></div>` : ''; }).join('') : '<span class="muted" style="font-size:13px">Пока нет медалей</span>'}</div>
        </div>`;
  }).join('')}</div>
      ${credits.length ? `<h3>Фото велосипедов</h3><div class="credits">${credits.map(({ bike, ph }) => `<div><b>${esc(bike.name)}</b> — <a href="${esc(ph.page || ph.url)}" target="_blank" rel="noopener">${esc(ph.artist)}, ${esc(ph.license)}</a></div>`).join('')}</div>` : ''}`;
  }

  // ═════════ ПЕРЕД СТАРТОМ ═════════
  function openPrerace(mode, id, champ) {
    const st = UI.state;
    const bike = D.bikeById(st.active);
    const o = st.owned[st.active];
    const el = $('#prerace');
    const champInfo = champ && st.champ ? `<div class="badge hot" style="align-self:flex-start">🏆 ${esc(PR.champById(st.champ.id).name)} · этап ${st.champ.stage + 1}</div>` : '';
    if (mode === 'tri') {
      const ev = TRI.eventById(id);
      el.innerHTML = `
        <div class="panel">
          ${champInfo}
          <div class="muted">${legsLine(ev)}</div>
          <h2 style="margin:0">${esc(ev.name)}</h2>
          <div class="prerace-bike"><div class="photo" id="pre-photo"></div>
            <div><b>${esc(bike.name)}</b><div class="muted" style="font-size:13px">${D.BIKE_TYPES[bike.type]}${['tt', 'aero', 'road'].includes(bike.type) ? ' — отличный выбор для триатлона' : ' — для триатлона лучше шоссейный или TT'}</div>
              <div style="margin-top:6px">Прогноз: <b>≈ ${TRI.fmtClock(triForecast(ev))}</b>${ev.cutoff ? ` <span class="muted">(лимит ${TRI.fmtClock(ev.cutoff)})</span>` : ''}</div></div></div>
          <b>Темп</b>
          <div class="tactics">${Object.entries(TRI.PACES).map(([pid, p]) => `<button class="tactic ${pid === st.tri.pacing ? 'selected' : ''}" data-pace="${pid}"><b>${p.icon} ${p.name}</b><small>${pid === 'easy' ? 'Медленнее, но гликоген почти не тратится' : pid === 'hard' ? 'Быстрее, но расход энергии на 45% выше' : 'Сбалансированный расход сил'}</small></button>`).join('')}</div>
          <label class="row" style="gap:8px"><input type="checkbox" id="pre-autogel" ${st.tri.autoGel !== false ? 'checked' : ''}> Автоматически брать гели, когда гликоген падает</label>
          <div class="muted" style="font-size:13px">Во время гонки темп можно менять, гель — кнопкой 🍌. Если гликоген кончится, вы «упрётесь в стену» и сильно замедлитесь.</div>
          <div class="row" style="margin-top:6px"><button class="btn primary" id="pre-start" style="flex:1">Старт ▶</button><button class="btn" id="pre-cancel">Отмена</button></div>
        </div>`;
      el.querySelectorAll('[data-pace]').forEach((b) => {
        b.onclick = () => { st.tri.pacing = b.dataset.pace; commit(); el.querySelectorAll('[data-pace]').forEach((x) => x.classList.toggle('selected', x === b)); };
      });
      $('#pre-autogel', el).onchange = (e) => { st.tri.autoGel = e.target.checked; commit(); };
    } else {
      const t = D.trackById(id);
      const fc = forecast(id, ownedStats(st.active), o.wheel);
      el.innerHTML = `
        <div class="panel">
          ${champInfo}
          <div class="muted">Трасса · ${t.laps} круга · ${esc(t.focus)}</div>
          <h2 style="margin:0">${esc(t.name)}</h2>
          <div class="prerace-bike"><div class="photo" id="pre-photo"></div>
            <div><b>${esc(bike.name)}</b><div class="muted" style="font-size:13px">${esc(D.WHEELS[o.wheel].name)}</div>
              <div style="margin-top:6px">Прогноз: <span class="stars">${starStr(fc.stars)}</span></div>
              <div class="muted" style="font-size:13px">Круг ≈ ${fmtTime(fc.lap)} · гонщик ур. ${PR.level(st)}</div></div></div>
          <b>Тактика на гонку</b>
          <div class="tactics">${D.TACTICS.map((x) => `<button class="tactic ${x.id === st.tactic ? 'selected' : ''}" data-tactic="${x.id}"><b>${x.icon} ${esc(x.name)}</b><small>${esc(x.desc)}</small></button>`).join('')}</div>
          <div class="muted" style="font-size:13px">Велосипед едет сам. Кнопка ⚡ «Спурт» даёт рывок на 4 секунды, если хватает энергии.</div>
          <div class="row" style="margin-top:6px"><button class="btn primary" id="pre-start" style="flex:1">Старт ▶</button><button class="btn" id="pre-cancel">Отмена</button></div>
        </div>`;
      el.querySelectorAll('[data-tactic]').forEach((b) => {
        b.onclick = () => { st.tactic = b.dataset.tactic; commit(); el.querySelectorAll('[data-tactic]').forEach((x) => x.classList.toggle('selected', x === b)); };
      });
    }
    window.BikePhotos.attach($('#pre-photo', el), bike, o.wheel);
    el.hidden = false;
    const close = () => { el.hidden = true; };
    $('#pre-cancel', el).onclick = close;
    el.onclick = (e) => { if (e.target === el) close(); };
    $('#pre-start', el).onclick = () => { close(); UI.start({ mode, id, champ: !!champ }); };
  }

  // ═════════ ГАРАЖ ═════════
  function renderGarage(root) {
    const st = UI.state;
    const ids = D.BIKES.filter((b) => st.owned[b.id]).map((b) => b.id);
    if (!UI.garageSel || !st.owned[UI.garageSel]) UI.garageSel = st.active;
    root.innerHTML = `
      <div class="section-title"><h2>Гараж</h2><p>Улучшайте компоненты и подбирайте колёса под покрытие трассы.</p></div>
      <div class="garage"><div class="garage-list" id="glist"></div><div class="detail" id="gdetail"></div></div>`;
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
    const stats = GS.effectiveStats(id, o.upgrades, o.wheel, st.rider.skills, st.perks);
    el.innerHTML = `
      <div class="detail-head">
        <div class="photo" id="dphoto"></div>
        <div class="info">
          <div class="muted" style="font-weight:700;letter-spacing:1px">${esc(bike.brand.toUpperCase())}${bike.maker ? ` · ${esc(bike.maker)}` : ''}</div>
          <div class="row"><h2 style="margin:0">${esc(bike.model)}</h2><span class="badge">${D.BIKE_TYPES[bike.type]}</span></div>
          <div class="muted">${esc(bike.desc)}</div>
          ${statBars(stats, bike.stats)}
          <div class="row">
            ${id === st.active ? '<span class="badge hot">Выбран для гонок</span>' : '<button class="btn primary" id="btn-activate">Выбрать для гонок</button>'}
            <span class="muted" style="font-size:12px">Синий — база, оранжевый — улучшения, колёса, тренировки и навыки</span>
          </div>
        </div>
      </div>
      <section><h3>Колёса и покрышки <span class="muted" style="font-size:13px;font-weight:500">· посадка: ${bike.sizes.map((s) => D.WHEEL_SIZE_NAMES[s]).join(', ')}</span></h3><div class="upgrades" id="wheels"></div></section>
      <section><h3>Улучшения</h3><div class="upgrades" id="ups"></div></section>
      <section><h3>Прогноз по трассам</h3><div class="forecast" id="fc"></div></section>`;
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

  // ═════════ МАГАЗИН ═════════
  function renderShop(root) {
    const st = UI.state;
    root.innerHTML = `
      <div class="section-title"><h2>Магазин велосипедов</h2><p>Только реальные бренды и модели. Каждая сильна в своём. Фото — с Wikimedia Commons, только при точном совпадении бренда и модели; иначе показана модель велосипеда.</p></div>
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
    if (UI.screen === 'race') renderRace(root);
    else if (UI.screen === 'rider') renderRider(root);
    else if (UI.screen === 'garage') renderGarage(root);
    else if (UI.screen === 'trophies') renderTrophies(root);
    else renderShop(root);
    root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => show(b.dataset.go); });
    root.querySelectorAll('[data-go-rider]').forEach((b) => { b.onclick = () => { UI.sub.rider = b.dataset.goRider; show('rider'); }; });
    root.querySelectorAll('[data-sub]').forEach((b) => {
      b.onclick = () => { const [g, id] = b.dataset.sub.split(':'); UI.sub[g] = id; render(); };
    });
    root.querySelectorAll('[data-start]').forEach((b) => {
      b.onclick = () => { const [mode, id, champ] = b.dataset.start.split(':'); openPrerace(mode, id, champ === 'champ'); };
    });
    commit();
  }

  function show(screen) {
    UI.screen = screen;
    render();
    window.scrollTo(0, 0);
  }

  // ═════════ ИТОГИ ГОНКИ ═════════
  // Начисляет призы, опыт, медали, очки чемпионата и кубки; показывает экран итогов.
  function showResults(race, ctx) {
    const st = UI.state;
    const tri = race.mode === 'tri';
    const res = race.results;
    const myIdx = res.findIndex((r) => r.rider.isPlayer);
    const me = res[myIdx];
    const place = myIdx + 1;
    const dnf = !!me.dnf;
    const ev = tri ? race.event : D.trackById(race.def.id);
    const tier = race.def.tier || ev.tier;
    const prize = dnf ? 0 : Math.round(ev.prize * (D.PRIZE_SHARE[myIdx] || 0) / 10) * 10;
    const distMult = tri ? 1 + Math.log2(1 + race.legs.reduce((a, l) => a + l.meters, 0) / 20000) : 1;
    st.money += prize;
    st.races++;
    if (place === 1 && !dnf) st.wins++;
    const xp = PR.addXp(st, dnf ? 20 : PR.raceXp(tier, place, distMult * (ctx.champ ? 1.25 : 1)));
    const medal = dnf ? null : PR.addMedal(st, place, { event: ev.id, name: ev.name, mode: tri ? 'tri' : 'cycle', time: me.time });
    let unlockedNew = null;
    if (tri) {
      if (!dnf && (!st.tri.best[ev.id] || place < st.tri.best[ev.id])) st.tri.best[ev.id] = place;
      if (!dnf && (!st.tri.bestTime[ev.id] || me.time < st.tri.bestTime[ev.id])) st.tri.bestTime[ev.id] = me.time;
    } else {
      const prevBest = st.best[ev.id];
      if (!prevBest || place < prevBest) st.best[ev.id] = place;
      if (!st.bestTime[ev.id] || me.time < st.bestTime[ev.id]) st.bestTime[ev.id] = me.time;
      const idx = D.TRACKS.findIndex((x) => x.id === ev.id);
      if (place <= 3 && (!prevBest || prevBest > 3) && D.TRACKS[idx + 1] && idx + 1 >= 2) unlockedNew = D.TRACKS[idx + 1];
    }
    // Чемпионат: очки за этап, а после последнего этапа — кубок.
    let champHtml = '', champDone = false, champNext = null;
    if (ctx.champ && st.champ) {
      const c = PR.champById(st.champ.id);
      const order = res.map((r) => (r.rider.isPlayer ? st.rider.name : r.rider.name));
      PR.recordChampStage(st, order);
      const table = PR.standings(st);
      if (st.champ.stage >= c.stages.length) {
        champDone = true;
        const myPlace = table.findIndex((r) => r.name === st.rider.name) + 1;
        const cup = PR.addCup(st, myPlace, c);
        const cprize = Math.round(c.prize * (D.PRIZE_SHARE[myPlace - 1] || 0) / 10) * 10;
        st.money += cprize;
        const cxp = PR.addXp(st, c.prize / 8 * (PR.CHAMP_POINTS[myPlace - 1] || 5) / 25);
        champHtml = `<div class="champ-final">${cup ? cupSvg(cup.kind, c.color, 84) : ''}
          <div><div class="muted">Итог чемпионата</div><h3 style="margin:0">${esc(c.name)}: ${myPlace}-е место</h3>
          <div>${cup ? `Кубок: <b>${KIND_NAME[cup.kind]}</b> · ` : ''}приз ${fmtMoney(cprize)} · +${cxp.gained} XP</div></div></div>`;
        st.champ = null;
      } else {
        champNext = c.stages[st.champ.stage];
      }
      champHtml += `<table class="standings"><tr><th>#</th><th>Общий зачёт</th><th class="num">Очки</th></tr>${table.map((r, i) => `<tr class="${r.name === st.rider.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="num">${r.points}</td></tr>`).join('')}</table>`;
    }
    commit(true);

    const head = dnf ? '⛔ DNF — не уложились в лимит' : `${medal ? '' : '🚴 '}${place}-е место`;
    const timeStr = tri ? TRI.fmtClock(me.time) : fmtTime(me.time);
    const legsHead = tri ? race.legs.map((l) => `<th class="num">${TRI.LEG_INFO[l.kind].icon}</th>`).join('') : '<th>Велосипед</th>';
    const rows = res.map((r, i) => {
      const cells = tri ? r.splits.map((x) => `<td class="num">${TRI.fmtClock(x)}</td>`).join('') : `<td>${esc(D.bikeById(r.rider.bikeId).name)}</td>`;
      const t = r.dnf ? 'DNF' : (tri ? TRI.fmtClock(r.time) : `${r.rider.finished ? '' : '≈'}${fmtTime(r.time)}`);
      return `<tr class="${r.rider.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.rider.name)}</td>${cells}<td class="num"><b>${t}</b></td></tr>`;
    }).join('');
    const el = $('#results');
    el.innerHTML = `
      <div class="panel results">
        <div class="row">${medal ? medalSvg(medal.kind, String(place), 54) : ''}<div class="results-place">${head}</div></div>
        <div class="muted">${esc(ev.name)} · ${tri ? 'итоговое время' : (race.player.finished ? 'ваше время' : 'расчётное время')} ${timeStr}${!tri && race.player.bestLap ? ` · лучший круг ${fmtTime(race.player.bestLap)}` : ''}</div>
        <div class="reward-row"><span>Приз: <b>${fmtMoney(prize)}</b></span><span>Опыт: <b>+${xp.gained} XP</b></span>${xp.levels ? `<span class="badge hot">🎉 Уровень ${xp.newLevel}! +${fmtMoney(xp.bonus)}</span>` : ''}</div>
        ${unlockedNew ? `<div class="badge hot" style="align-self:flex-start">Открыта трасса «${esc(unlockedNew.name)}»!</div>` : ''}
        ${champHtml}
        <div class="table-wrap"><table>
          <tr><th>#</th><th>Спортсмен</th>${legsHead}<th class="num">Итог</th></tr>
          ${rows}
        </table></div>
        <div class="row" style="margin-top:8px">
          ${champNext ? `<button class="btn primary" id="res-next">Этап ${st.champ.stage + 1}: ${esc(stageName(tri ? 'tri' : 'cycle', champNext))} ▶</button>`
            : champDone ? '<button class="btn primary" id="res-trophies">🏆 К трофеям</button>'
              : '<button class="btn primary" id="res-again">Ещё раз</button>'}
          <button class="btn" id="res-garage">В гараж</button>
          <button class="btn" id="res-menu">В меню</button>
        </div>
      </div>`;
    el.hidden = false;
    const close = () => { el.hidden = true; };
    const again = $('#res-again', el);
    if (again) again.onclick = () => { close(); ctx.onAgain(); };
    const next = $('#res-next', el);
    if (next) next.onclick = () => { close(); ctx.onMenu('race'); openPrerace(tri ? 'tri' : 'cycle', champNext, true); };
    const tro = $('#res-trophies', el);
    if (tro) tro.onclick = () => { close(); ctx.onMenu('trophies'); };
    $('#res-garage', el).onclick = () => { close(); ctx.onMenu('garage'); };
    $('#res-menu', el).onclick = () => { close(); ctx.onMenu('race'); };
  }

  function init(state, start) {
    UI.state = state;
    UI.start = start;
    document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => show(b.dataset.screen); });
    render();
  }

  window.UI = { init, show, render, showResults, fmtTime, commit, toast, medalSvg, cupSvg, state: () => UI.state };
})();
