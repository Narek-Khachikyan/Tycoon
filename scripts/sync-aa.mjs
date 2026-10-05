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

async function fetchFromAA(key) {
  // Единственный живой эндпоинт: v2 отдаёт 690 моделей. Прежние адреса (v1 и api-поддомен)
  // отвечают 404 — не ключом, а самим собой, поэтому список не «на всякий случай».
  const url = 'https://artificialanalysis.ai/api/v2/data/llms/models';

  try {
    const res = await fetch(url, {
      headers: {
        'x-api-key': key,
        'Accept': 'application/json',
        'User-Agent': 'TokenClickerSync/1.0',
      },
    });
    if (res.ok) {
      return await res.json();
    }
    throw new Error(`HTTP ${res.status} ${res.statusText} от ${url}`);
  } catch (err) {
    throw new Error(`Не удалось получить данные Artificial Analysis: ${err.message}`);
  }
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
    const rawData = await fetchFromAA(apiKey);
    const modelsList = Array.isArray(rawData) ? rawData : rawData.data || rawData.models || [];
    const wanted = seedSlugs();
    let updated = 0;
    let seen = 0;
    const next = {};

    for (const item of modelsList) {
      const slug = normalizeKey(item.slug || item.id || item.name || '');
      // v2 лежит глубже плоских полей: индекс в evaluations, скорость — отдельный медианный
      // счётчик, цена — в pricing.
      const iq = item.evaluations?.artificial_analysis_intelligence_index;
      const speed = item.median_output_tokens_per_second;
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
    console.log(`   обновлено ${updated} из ${wanted.size} сидов (в выдаче AA: ${seen})`);
    if (missing.length) {
      console.log(`   без данных AA (${missing.length}), остаются фолбэки сидов: ${missing.join(', ')}`);
    }
  } catch (err) {
    console.error('❌ Ошибка синхронизации с AA:', err.message);
    process.exit(1);
  }
}

main();
