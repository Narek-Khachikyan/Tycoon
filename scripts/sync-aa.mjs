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
  const endpoints = [
    'https://api.artificialanalysis.ai/v1/data/llms',
    'https://artificialanalysis.ai/api/v1/models',
    'https://api.artificialanalysis.ai/models',
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          'x-api-key': key,
          'Accept': 'application/json',
          'User-Agent': 'AITycoonSync/1.0',
        },
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // try next endpoint
    }
  }
  throw new Error('Failed to fetch from Artificial Analysis API endpoints.');
}

function normalizeKey(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  console.log('🔄 Синхронизация снимка Artificial Analysis...');

  let snapshot = {};
  if (fs.existsSync(SNAPSHOT_PATH)) {
    try {
      snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    } catch {
      snapshot = {};
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
    let updated = 0;

    for (const item of modelsList) {
      const slug = normalizeKey(item.slug || item.id || item.name || '');
      const iq = item.intelligence_index ?? item.quality_index ?? item.eval_index;
      const speed = item.output_speed ?? item.speed ?? item.tokens_per_second;
      const price = item.blended_price_per_1m ?? item.price_per_1m ?? item.cost_blended;

      if (slug && (iq != null || speed != null || price != null)) {
        snapshot[slug] = {
          ...(snapshot[slug] || {}),
          ...(iq != null ? { iq: Number(iq) } : {}),
          ...(speed != null ? { speed: Number(speed) } : {}),
          ...(price != null ? { price: Number(price) } : {}),
        };
        updated++;
      }
    }

    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    console.log(`✅ Снимок успешно сохранён: ${SNAPSHOT_PATH} (${updated} моделей обновлено)`);
  } catch (err) {
    console.error('❌ Ошибка синхронизации с AA:', err.message);
    process.exit(1);
  }
}

main();
