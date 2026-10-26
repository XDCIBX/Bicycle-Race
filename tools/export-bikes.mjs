// Сохраняет изображения моделей всех велосипедов (как в игре) в assets/bikes/<id>.svg.
// Запуск: node tools/export-bikes.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console, Math };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/data.js', 'js/bikeart.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
const outDir = path.join(root, 'assets', 'bikes');
fs.mkdirSync(outDir, { recursive: true });
const list = [];
for (const bike of ctx.GameData.BIKES) {
  fs.writeFileSync(path.join(outDir, `${bike.id}.svg`), ctx.BikeArt.svg(bike));
  list.push(`| ${bike.name} | ${ctx.GameData.BIKE_TYPES[bike.type]} | [${bike.id}.svg](${bike.id}.svg) |`);
}
fs.writeFileSync(path.join(outDir, 'README.md'), `# Модели велосипедов\n\nИзображения сгенерированы \`node tools/export-bikes.mjs\` по геометрии рам (js/bikeart.js).\n\n| Велосипед | Тип | Файл |\n|---|---|---|\n${list.join('\n')}\n`);
console.log(`Сохранено моделей: ${list.length}`);
