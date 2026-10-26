#!/usr/bin/env node
// Собирает веб-версию игры в папку www/ — её упаковывает Capacitor в iOS-приложение
// и её же публикует GitHub Pages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
const ITEMS = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'assets', 'icons'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const item of ITEMS) fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
console.log(`Готово: ${path.relative(root, out)}/ (${ITEMS.join(', ')})`);
