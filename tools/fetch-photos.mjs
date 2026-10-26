#!/usr/bin/env node
// Скачивает реальные фотографии велосипедов из Wikimedia Commons в assets/photos/
// и записывает авторов/лицензии в assets/photos/credits.js.
// После этого игра показывает фото даже без интернета.
//
//   node tools/fetch-photos.mjs            — скачать недостающие
//   node tools/fetch-photos.mjs --force    — перекачать всё
//   node tools/fetch-photos.mjs tarmac p5  — только указанные велосипеды
//
// Нужен Node.js 18+ (встроенный fetch).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'photos');
const creditsFile = path.join(outDir, 'credits.js');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'VeloRush2.5D/1.0 (https://github.com/xdcibx/bicycle-race; educational game)';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

function loadBrowserGlobal(file, name) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.window[name];
}

const { BIKES } = loadBrowserGlobal(path.join(root, 'js', 'data.js'), 'GameData');
const credits = fs.existsSync(creditsFile) ? loadBrowserGlobal(creditsFile, 'LOCAL_BIKE_PHOTOS') || {} : {};

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// Те же правила, что и в js/photos.js: в названии обязаны быть бренд и модель,
// снимки гонок, людей, выставок, логотипов и деталей отбрасываются.
const REJECT = /(logo|map|diagram|drawing|icon|sign|poster|advert|catalog|patent|svg|schematic|crash|accident|tour de france|giro|vuelta|stage|étape|etapa|team|équipe|podium|peloton|race|racing|rennen|course|criterium|finish|winner|champion|portrait|rider|cyclist|athlete|shop|store|showroom|museum|expo|eurobike|fair|messe|detail|close|headtube|head tube|badge|decal|crank|derailleur|saddle|groupset|drivetrain|cockpit|handlebar|interior|parade|crowd)/i;
const PREFER = /(bike|bicycle|fahrrad|vélo|velo|bicicleta|side|profile|studio)/i;

function matches(title, bike) {
  const t = title.replace(/^File:/, '').replace(/_+/g, ' ');
  const m = bike.photoMatch;
  if (!new RegExp(m.brand, 'i').test(t)) return false;
  if (m.model && !new RegExp(m.model, 'i').test(t)) return false;
  return !REJECT.test(t);
}

function pickBest(pages, bike) {
  let best = null, bestScore = -Infinity;
  for (const pg of pages) {
    const ii = pg.imageinfo && pg.imageinfo[0];
    if (!ii || !/image\/(jpeg|png|webp)/.test(ii.mime || '') || !matches(pg.title, bike)) continue;
    const ratio = ii.width / ii.height;
    if (ratio < 1.15 || ratio > 2.3 || ii.width < 600) continue;
    let score = -(pg.index || 0) * 0.1;
    if (PREFER.test(pg.title)) score += 2;
    if (ratio > 1.3 && ratio < 1.8) score += 1.5;
    if (score > bestScore) { bestScore = score; best = { pg, ii }; }
  }
  return best;
}

function queries(bike) {
  const brand = bike.brand.replace('é', 'e');
  const model = bike.model.split(' ').find((w) => w.length > 1 && !/^(s-works|c|line|carbon|advanced|pro|rc|disc|world|cup|explore)$/i.test(w)) || bike.model;
  return [`intitle:"${brand}" intitle:"${model}"`, `${bike.brand} ${bike.model}`, ...bike.photoQueries.slice(0, 2)];
}

async function search(bike) {
  for (const q of queries(bike)) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '30',
      gsrsearch: `${q} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '800',
    });
    const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const data = await res.json();
    const best = pickBest(Object.values(data.query?.pages || {}), bike);
    if (best) return { ...best, query: q };
  }
  return null;
}

let changed = false;
for (const bike of BIKES) {
  if (only.length && !only.includes(bike.id)) continue;
  if (credits[bike.id] && !force) { console.log(`✓ ${bike.id}: уже есть`); continue; }
  try {
    const found = await search(bike);
    if (!found) { console.log(`✗ ${bike.id}: ничего не найдено`); continue; }
    const { pg, ii } = found;
    const src = ii.thumburl || ii.url;
    const ext = (src.match(/\.(jpe?g|png|webp)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
    const file = `${bike.id}.${ext}`;
    const img = await fetch(src, { headers: { 'User-Agent': UA } });
    if (!img.ok) throw new Error(`HTTP ${img.status}`);
    fs.writeFileSync(path.join(outDir, file), Buffer.from(await img.arrayBuffer()));
    const meta = ii.extmetadata || {};
    credits[bike.id] = {
      url: `assets/photos/${file}`,
      page: ii.descriptionurl,
      title: pg.title.replace(/^File:/, ''),
      artist: stripHtml(meta.Artist?.value) || 'неизвестен',
      license: stripHtml(meta.LicenseShortName?.value) || 'см. страницу файла',
    };
    changed = true;
    console.log(`↓ ${bike.id}: ${credits[bike.id].title} (${credits[bike.id].license}, ${credits[bike.id].artist})`);
  } catch (e) {
    console.log(`✗ ${bike.id}: ${e.message}`);
  }
}

if (changed) {
  const body = `// Локальные фотографии велосипедов (сгенерировано tools/fetch-photos.mjs).\n` +
    `// Источник: Wikimedia Commons, авторы и лицензии указаны для каждого файла.\n` +
    `window.LOCAL_BIKE_PHOTOS = ${JSON.stringify(credits, null, 2)};\n`;
  fs.writeFileSync(creditsFile, body);
  console.log(`\nГотово: ${creditsFile}`);
}
