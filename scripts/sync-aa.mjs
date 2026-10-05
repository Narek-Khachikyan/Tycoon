#!/usr/bin/env node
/**
 * Скрипт синхронизации данных Artificial Analysis (ADR-0001).
 * Запуск: AA_API_KEY=... npm run sync:aa
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.resolve(__dirname, '../src/data/aa-snapshot.json');
const GENERATIONS_PATH = path.resolve(__dirname, '../src/data/generations.ts');

const apiKey = process.env.AA_API_KEY;

const API_BASE = 'https://artificialanalysis.ai/api/v2';

/**
 * Адреса V2 в документированном контракте (старые `/api/v2/data/*` выключают 4 ноября 2026).
 *
 * Pro отдаёт `price_1m_blended_3_to_1`, из которого catalog.ts строит живой изгиб цены в
 * пределах ±30%, поэтому Pro — первый адрес. Free-ключ получает на нём 403, и тогда снимок
 * обновляет индекс и скорость, а цены остаются прошлыми: молчаливый откат цены на фолбэки
 * сидов мы не выдаём за успешную синхронизацию.
 */
const ENDPOINTS = [
  { label: 'Pro', path: '/language/models' },
  { label: 'Free', path: '/language/models/free' },
];

/** Страховка от бесконечного обхода, если `has_more` врёт: страниц у каталога единицы. */
const MAX_PAGES = 20;

async function fetchPage(url, key) {
  const res = await fetch(url, {
    headers: {
      'x-api-key': key,
      'Accept': 'application/json',
      'User-Agent': 'TokenClickerSync/1.0',
    },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText} от ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Модели постранично: список отдаётся по 200 записей на страницу, а не целиком, и без обхода
 * страниц снимок замер бы на первой — молча, потому что сиды без ответа сохраняют прошлые
 * значения. Пустой `data` вместо массива тоже ошибка, а не «моделей нет».
 */
async function fetchAllModels(endpoint, key) {
  const models = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${API_BASE}${endpoint.path}?page=${page}`;
    const body = await fetchPage(url, key);
    if (!Array.isArray(body?.data)) {
      throw new Error(`Неожиданная форма ответа ${url}: нет массива data`);
    }
    models.push(...body.data);
    if (!body.pagination?.has_more) return models;
  }
  throw new Error(`${API_BASE}${endpoint.path}: пагинация не закончилась за ${MAX_PAGES} страниц`);
}

/** Pro, а на 403 — Free. Остальные статусы (401, 429, 500) не обсуждаются: это общий сбой. */
async function fetchFromAA(key) {
  for (const endpoint of ENDPOINTS) {
    try {
      return { tier: endpoint.label, models: await fetchAllModels(endpoint, key) };
    } catch (err) {
      if (err.status !== 403) throw err;
      console.warn(`⚠️  ${err.message} — пробуем Free-адрес.`);
    }
  }
  throw new Error('Не удалось получить данные Artificial Analysis: ключ не проходит ни Pro, ни Free');
}

function normalizeKey(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Замер, а не отсутствие замера.
 *
 * AA не публикует метрику, если модель её не измерял, и отдаёт это как `0`, а не `null`.
 * Отличить «замерено ноль» от «не замерено» по ответу нельзя, поэтому правило одно и
 * строгое: ноль в снимок не попадает.
 *
 * `0` в снимке опаснее отсутствующей записи: `mergeSeed` в catalog.ts берёт значение по
 * условию `s[k] != null`, ноль проходит как замер и обрушивает `softMod` в пол
 * `1 - MOD_SPREAD`, то есть удешевляет цену Модели ровно на треть. Не измеренное в снимок
 * не попадает, и `catalog.ts` откатится к резервному значению сида самостоятельно.
 */
const measured = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Слаги, на которые ссылаются сиды: первый элемент каждой строки в generations.ts.
 * Снимок держит только их, потому что он импортируется прямо в бандл — 690 записей целиком
 * это ~90 КБ публичных данных, из которых игра читает 76.
 */
function seedSlugs() {
  const src = fs.readFileSync(GENERATIONS_PATH, 'utf8');
  const body = src.slice(src.indexOf('GENERATIONS'));
  const slugs = new Set();
  for (const m of body.matchAll(/\['([a-z0-9][a-z0-9._-]*)',\s*'/g)) slugs.add(m[1]);
  return slugs;
}

/**
 * Пишет снимок атомарно: сначала во временный файл рядом, затем переименование.
 * Прерванный `writeFileSync` не может оставить `aa-snapshot.json` обрезанным.
 */
function writeSnapshotAtomic(data) {
  const tmpPath = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, SNAPSHOT_PATH);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

async function main() {
  console.log('🔄 Синхронизация снимка Artificial Analysis...');

  let snapshot = {};
  if (fs.existsSync(SNAPSHOT_PATH)) {
    try {
      snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    } catch (err) {
      // Не подставляем `{}`: следующая запись молча стёрла бы все записи,
      // которых не оказалось в ответе API.
      console.error(`❌ Снимок повреждён и не разбирается: ${SNAPSHOT_PATH}`);
      console.error(`   ${err.message}`);
      console.error('   Восстановите файл вручную или удалите его, чтобы начать с нуля.');
      process.exit(1);
    }
  }

  if (!apiKey) {
    console.warn('⚠️  Переменная окружения AA_API_KEY не задана.');
    console.warn('   Для боевой синхронизации запустите: AA_API_KEY="ваш_ключ" npm run sync:aa');
    console.log('   Используем текущий снимок и резервные данные из generations.ts.');
    return;
  }

  try {
    const { tier, models: modelsList } = await fetchFromAA(apiKey);
    const wanted = seedSlugs();
    let updated = 0;
    let seen = 0;
    const next = {};

    for (const item of modelsList) {
      const slug = normalizeKey(item.slug || item.id || item.name || '');
      // Документированный контракт: индекс — в evaluations, скорость — в performance,
      // цена — в pricing. На Free-адресе `price_1m_blended_3_to_1` не приходит вовсе, и
      // прошлая цена сида сохраняется ниже, а не затирается нулём.
      const iq = item.evaluations?.artificial_analysis_intelligence_index;
      const speed = item.performance?.median_output_tokens_per_second;
      const price = item.pricing?.price_1m_blended_3_to_1;

      if (!slug || (!measured(iq) && !measured(speed) && !measured(price))) continue;
      // Всё, чего нет в generations.ts, в снимок не попадает: unattributed записи только
      // раздувают публичный файл, а прочитать их игра всё равно не может.
      if (!wanted.has(slug)) continue;
      seen++;
      next[slug] = {
        ...(snapshot[slug] || {}),
        ...(measured(iq) ? { iq: Number(iq) } : {}),
        ...(measured(speed) ? { speed: Number(speed) } : {}),
        ...(measured(price) ? { price: Number(price) } : {}),
      };
      updated++;
    }

    // Сиды, которым AA не отвечает, сохраняют прошлую запись, если она была: снимок не должен
    // терять значение только потому, что модель временно исчезла из выдачи AA.
    for (const slug of wanted) {
      if (snapshot[slug] && !next[slug]) next[slug] = snapshot[slug];
    }
    snapshot = next;

    writeSnapshotAtomic(snapshot);
    const missing = [...wanted].filter((s) => !snapshot[s]);
    console.log(`✅ Снимок сохранён: ${SNAPSHOT_PATH}`);
    console.log(`   обновлено ${updated} из ${wanted.size} сидов (в выдаче AA: ${seen}, адрес ${tier})`);
    if (tier === 'Free') {
      console.warn('⚠️  Ключ не даёт blended-цену: price в снимке остался прошлым, изгиб цены не обновлён.');
    }
    if (missing.length) {
      console.log(`   без данных AA (${missing.length}), остаются фолбэки сидов: ${missing.join(', ')}`);
    }
  } catch (err) {
    console.error('❌ Ошибка синхронизации с AA:', err.message);
    process.exit(1);
  }
}

main();
