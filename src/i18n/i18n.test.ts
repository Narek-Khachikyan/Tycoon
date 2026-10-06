import { describe, expect, it } from 'vitest';
import { t } from './index';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import { useGameStore } from '../store/useGameStore';
import { exportSave, importSave } from '../economy/save';

describe('i18n translation system', () => {
  it('returns Russian strings verbatim when lang is ru', () => {
    expect(t('ru', 'Модели')).toBe('Модели');
    expect(t('ru', 'Апгрейды')).toBe('Апгрейды');
    expect(t('ru', 'Купить')).toBe('Купить');
    expect(t('ru', 'Продать')).toBe('Продать');
    expect(t('ru', 'Куплено')).toBe('Куплено');
    expect(t('ru', 'не хватает {amount}', { amount: '10' })).toBe('не хватает 10');
  });

  it('translates strings to English when lang is en', () => {
    expect(t('en', 'Модели')).toBe('Models');
    expect(t('en', 'Апгрейды')).toBe('Upgrades');
    expect(t('en', 'Купить')).toBe('Buy');
    expect(t('en', 'Продать')).toBe('Sell');
    expect(t('en', 'Куплено')).toBe('Purchased');
    expect(t('en', 'не хватает {amount}', { amount: '10' })).toBe('need 10');
    expect(t('en', 'до следующего Агента {pct}%', { pct: 85 })).toBe('to next Agent 85%');
  });

  it('falls back to message key when translation is absent', () => {
    expect(t('en', 'Unknown message' as any)).toBe('Unknown message');
  });

  it('formats numbers with commas in Russian and periods in English', () => {
    expect(formatNumber('ru', 1234.5)).toContain(',');
    expect(formatNumber('en', 1234.5)).toContain('.');
  });

  it('formats plural counts appropriately in both languages', () => {
    expect(formatCount('ru', 1, 'Агент', 'Агента', 'Агентов')).toBe('Агент');
    expect(formatCount('ru', 2, 'Агент', 'Агента', 'Агентов')).toBe('Агента');
    expect(formatCount('ru', 5, 'Агент', 'Агента', 'Агентов')).toBe('Агентов');

    expect(formatCount('en', 1, 'Агент', 'Агента', 'Агентов')).toBe('Agent');
    expect(formatCount('en', 2, 'Агент', 'Агента', 'Агентов')).toBe('Agents');
    expect(formatCount('en', 5, 'Агент', 'Агента', 'Агентов')).toBe('Agents');
  });

  it('formats duration in Russian and English', () => {
    const durRu = formatDuration('ru', 125);
    const durEn = formatDuration('en', 125);
    expect(durRu).toContain('мин');
    expect(durEn).toContain('m');
  });

  it('supports changing language via useGameStore setLang', () => {
    const store = useGameStore.getState();
    store.setLang('en');
    expect(useGameStore.getState().state.settings.lang).toBe('en');
    store.setLang('ru');
    expect(useGameStore.getState().state.settings.lang).toBe('ru');
  });

  it('preserves language through export and import save', () => {
    const store = useGameStore.getState();
    store.setLang('en');
    const exported = exportSave(useGameStore.getState().state);
    const imported = importSave(exported, Date.now());
    expect(imported).not.toBeNull();
    expect(imported?.settings.lang).toBe('en');

    store.setLang('ru');
    const exportedRu = exportSave(useGameStore.getState().state);
    const importedRu = importSave(exportedRu, Date.now());
    expect(importedRu).not.toBeNull();
    expect(importedRu?.settings.lang).toBe('ru');
  });
});
