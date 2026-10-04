#!/usr/bin/env node
/**
 * Скрипт синхронизации данных Artificial Analysis (ADR-0001).
 * Запуск: AA_API_KEY=... npm run sync:aa
 *
 * Ключ читается только из окружения и живёт в этом процессе: в бандл, в Vite и в
 * git он попасть не должен (AGENTS.md, «что мы никогда не жертвуем»).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.resolve(__dirname, '../src/data/aa-snapshot.json');

const apiKey = process.env.AA_API_KEY;
const API_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models';

async function fetchFromAA(key) {
  const res = await fetch(API_URL, {
    headers: {
      'x-api-key': key,
      Accept: 'application/json',
      'User-Agent': 'AITycoonSync/1.0',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AA ответил ${res.status}. ${body.slice(0, 200)}`);
  }
  return res.json();
}

function normalizeKey(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * AA не публикует метрику, если модель её не измерял, и отдаёт это как `0`, а не `null`.
 * Различить «замерено ноль» и «не замерено» по ответу нельзя, поэтому правило одно и
 * строгое: ноль в снимок не попадает.
 *
 * `0` в снимке опаснее отсутствующей записи: `mergeSeed` берёт snapshot по условию
 * `s[k] != null`, ноль проходит как замер и обрушивает `softMod` (0 упирается в пол
 * 1 - MOD_SPREAD), а медиана по Поколению уезжает в ноль и портит модификаторы всех
 * остальных Моделей. Поэтому не измеренное в снимок не попадает: `catalog.ts`
 * откатится к резервному значению сида самостоятельно.
 */
const measured = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

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
    const payload = await fetchFromAA(apiKey);
    const modelsList = Array.isArray(payload) ? payload : payload.data ?? [];

    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of modelsList) {
      const slug = normalizeKey(item.slug || item.id || '');
      if (!slug) continue;

      const iq = measured(item.evaluations?.artificial_analysis_intelligence_index)
        ? Number(item.evaluations.artificial_analysis_intelligence_index)
        : undefined;
      const speed = measured(item.median_output_tokens_per_second)
        ? Number(item.median_output_tokens_per_second)
        : undefined;
      const price = measured(item.pricing?.price_1m_blended_3_to_1)
        ? Number(item.pricing.price_1m_blended_3_to_1)
        : undefined;

      const entry = snapshot[slug] ?? {};
      if (!iq && !speed && !price) {
        skipped++;
        continue;
      }

      const next = {
        ...entry,
        ...(iq != null ? { iq } : {}),
        ...(speed != null ? { speed } : {}),
        ...(price != null ? { price } : {}),
      };
      const changed = JSON.stringify(next) !== JSON.stringify(entry);
      if (!changed) continue;
      if (entry.name || Object.keys(entry).length) updated++;
      else added++;
      snapshot[slug] = next;
    }

    writeSnapshotAtomic(snapshot);
    console.log(`✅ Снимок сохранён: ${SNAPSHOT_PATH}`);
    console.log(`   Ответ AA: ${modelsList.length} моделей, без замеров пропущено: ${skipped}`);
    console.log(`   Записано: новых ${added}, обновлено ${updated}, всего в снимке ${Object.keys(snapshot).length}`);
  } catch (err) {
    console.error('❌ Ошибка синхронизации с AA:', err.message);
    process.exit(1);
  }
}

main();