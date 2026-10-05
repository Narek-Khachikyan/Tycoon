import { describe, expect, it } from 'vitest';
import { LAB_IDS } from '../data/labs';
import { QUIPS } from '../data/quips';
import { newlyEarnedShadows } from './achievements';
import { CATALOG } from './catalog';
import { buyAgents, prestige } from './engine';
import { pickQuip, QUIPS_SEEN_CAP, recordQuip } from './quips';
import { exportSave, importSave, migrate } from './save';
import { SHADOW_ACHIEVEMENTS } from './shadow';
import { newGame, SAVE_VERSION, type GameState } from './state';

const T0 = 1_000_000;

/** Токены в кармане: тесты строят конец игры, а не играют до него. */
const rich = (s: GameState, tokens: number): GameState => ({ ...s, tokens, runTokens: tokens });

const quipCheck = (id: string) => SHADOW_ACHIEVEMENTS.find((a) => a.id === id)!.check;

describe('таблица реплик', () => {
  it('держит минимум 6 реплик на каждую лабораторию', () => {
    for (const lab of LAB_IDS) {
      expect(QUIPS.filter((q) => q.lab === lab).length).toBeGreaterThanOrEqual(6);
    }
    expect(QUIPS.length).toBeGreaterThanOrEqual(6 * LAB_IDS.length);
  });

  it('нумерует id как <lab>-<n> без дублей и пустых текстов', () => {
    const ids = QUIPS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUIPS) {
      expect(q.id.startsWith(`${q.lab}-`)).toBe(true);
      expect(Number(q.id.slice(q.lab.length + 1))).toBeGreaterThanOrEqual(1);
      expect(q.text.length).toBeGreaterThan(0);
    }
  });

  it('говорит по глоссарию: без избегаемых синонимов', () => {
    // Токены — не монеты, Клики — не тапы, Модели — не здания: синонимы, которые
    // CONTEXT.md запрещает, ловятся по словам, а не подстрокой, иначе «этап»
    // сработал бы за «тап».
    const banned = new Set([
      'монета', 'монеты', 'монет', 'тап', 'тапы', 'здание', 'здания', 'зданий',
      'юнит', 'юниты', 'юнитов', 'сессия', 'сессии', 'компания', 'вендор', 'провайдер',
      'ивент', 'эвент', 'баг', 'баги', 'бонус', 'бонусы', 'улучшение', 'статы',
      'бенчмарк', 'подписка', 'талант', 'пассивка', 'эпоха', 'сезон', 'ран',
      'апокалипсис', 'мятеж', 'взятка', 'жетон', 'купон', 'подарок', 'реклама',
      'промокод', 'самоцвет', 'алмаз', 'аватар', 'логотип', 'тир', 'уровень', 'босс',
    ]);
    for (const q of QUIPS) {
      const words = q.text.toLowerCase().split(/[^а-яёa-z]+/);
      expect(words.filter((w) => banned.has(w))).toEqual([]);
    }
  });
});

describe('каденс реплик', () => {
  it('молчит на нерепличных кликах', () => {
    for (const clicks of [0, -4, 1, 2, 3, 5, 6, 7, NaN, 4.5]) {
      expect(pickQuip('openai', clicks, [])).toBeNull();
      expect(pickQuip(null, clicks, [])).toBeNull();
    }
  });

  it('даёт реплику на каждый 4-й клик — 1–2 в окне любых 5 кликов', () => {
    for (const lab of ['openai' as const, null]) {
      for (let start = 1; start <= 400; start++) {
        let heard = 0;
        // != null, а не !== null: промах ядра — это undefined (дырка в таблице),
        // и строгая проверка засчитала бы его за «услышано».
        for (let c = start; c < start + 5; c++) if (pickQuip(lab, c, []) != null) heard++;
        expect(heard).toBeGreaterThanOrEqual(1);
        expect(heard).toBeLessThanOrEqual(2);
      }
    }
  });

  it('не возвращает undefined ни на одном репличном клике (регрессия дырок в таблице)', () => {
    for (let c = 4; c <= 4000; c += 4) {
      for (const lab of ['openai' as const, 'xai' as const, null]) {
        const q = pickQuip(lab, c, []);
        expect(q).toBeDefined();
        expect(typeof q!.id).toBe('string');
        expect(typeof q!.text).toBe('string');
      }
    }
  });

  it('детерминирована: те же аргументы — та же реплика, без Date.now и Math.random', () => {
    const clock = Date.now;
    const dice = Math.random;
    Date.now = () => {
      throw new Error('pickQuip читает Date.now');
    };
    Math.random = () => {
      throw new Error('pickQuip читает Math.random');
    };
    try {
      for (let c = 4; c <= 400; c += 4) {
        expect(pickQuip('xai', c, [])).toBe(pickQuip('xai', c, []));
        expect(pickQuip(null, c, ['openai-1'])).toBe(pickQuip(null, c, ['openai-1']));
      }
    } finally {
      Date.now = clock;
      Math.random = dice;
    }
  });
});

describe('выбор реплики', () => {
  it('предпочитает неуслышанные id своей лаборатории', () => {
    const lab = 'openai';
    const all = QUIPS.filter((q) => q.lab === lab).map((q) => q.id);
    const seen = all.slice(1);
    expect(pickQuip(lab, 4, seen)!.id).toBe(all[0]);
    // И без лаборатории: единственный неуслышанный из всех — он и звучит.
    const rest = QUIPS.map((q) => q.id).slice(1);
    expect(pickQuip(null, 8, rest)!.id).toBe(QUIPS[0].id);
  });

  it('не молчит, когда всё услышано: коллекция уходит в повторы', () => {
    const all = QUIPS.map((q) => q.id);
    expect(pickQuip('meta', 4, all)).not.toBeNull();
    expect(pickQuip(null, 4, all)).not.toBeNull();
  });
});

describe('recordQuip', () => {
  it('дописывает id и возвращает новый объект, не трогая вход', () => {
    const s = newGame(T0);
    const next = recordQuip(s, 'openai-1');
    expect(next).not.toBe(s);
    expect(next.quipsSeen).toEqual(['openai-1']);
    expect(s.quipsSeen).toEqual([]);
  });

  it('возвращает ТОТ ЖЕ объект на дубле: повторы не событие', () => {
    const s = { ...newGame(T0), quipsSeen: ['openai-1'] };
    expect(recordQuip(s, 'openai-1')).toBe(s);
  });

  it('держит кап 300, сдвигая голову', () => {
    expect(QUIPS_SEEN_CAP).toBe(300);
    let s = newGame(T0);
    for (let i = 0; i < QUIPS_SEEN_CAP; i++) s = recordQuip(s, `t-${i}`);
    expect(s.quipsSeen).toHaveLength(QUIPS_SEEN_CAP);
    const next = recordQuip(s, `t-${QUIPS_SEEN_CAP}`);
    expect(next.quipsSeen).toHaveLength(QUIPS_SEEN_CAP);
    expect(next.quipsSeen[0]).toBe('t-1');
    expect(next.quipsSeen[QUIPS_SEEN_CAP - 1]).toBe(`t-${QUIPS_SEEN_CAP}`);
  });

  it('переживает Престиж вместе с Достижениями: коллекция не сгорает за Забег', () => {
    let s = rich(newGame(T0), 1e30);
    s = buyAgents(s, CATALOG[0].flagship.id, 1);
    s = recordQuip(recordQuip(s, 'openai-1'), 'xai-5');
    expect(prestige(s, T0 + 1).quipsSeen).toEqual(['openai-1', 'xai-5']);
  });
});

describe('миграция переписки', () => {
  it('поднимает v4 до текущей с пустой перепиской, не теряя остальное', () => {
    const s = migrate({ version: 4, tokens: 1e6, clicks: 42, achievements: ['click_1'] }, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.quipsSeen).toEqual([]);
    expect(s.tokens).toBe(1e6);
    expect(s.clicks).toBe(42);
    expect(s.achievements).toEqual(['click_1']);
  });

  it('хранит переписку живого сохранения v5: дедуп, мусор вон, хвост обрезан', () => {
    const kept = migrate({ version: 5, quipsSeen: ['openai-1', 'openai-1', 'xai-5', 42] }, T0);
    expect(kept.quipsSeen).toEqual(['openai-1', 'xai-5']);
    const long = Array.from({ length: QUIPS_SEEN_CAP + 10 }, (_, i) => `t-${i}`);
    const cut = migrate({ version: 5, quipsSeen: long }, T0);
    expect(cut.quipsSeen).toHaveLength(QUIPS_SEEN_CAP);
    expect(cut.quipsSeen[0]).toBe('t-10');
  });

  it('везёт переписку через экспорт/импорт, как остальное сохранение', () => {
    const s = recordQuip(recordQuip(newGame(T0), 'openai-1'), 'meta-7');
    const back = importSave(exportSave(s), T0)!;
    expect(back.quipsSeen).toEqual(['openai-1', 'meta-7']);
  });
});

describe('тени переписки', () => {
  it('молчат в пустой игре', () => {
    const s = newGame(T0);
    expect(quipCheck('shadow_quips_5')(s)).toBe(false);
    expect(quipCheck('shadow_quips_50')(s)).toBe(false);
    expect(quipCheck('shadow_quips_lab')(s)).toBe(false);
    expect(newlyEarnedShadows(s)).not.toContain('shadow_quips_5');
  });

  it('считают пороги 5 и 50 ровно по границе', () => {
    const four: GameState = { ...newGame(T0), quipsSeen: QUIPS.slice(0, 4).map((q) => q.id) };
    expect(quipCheck('shadow_quips_5')(four)).toBe(false);
    const five: GameState = { ...newGame(T0), quipsSeen: QUIPS.slice(0, 5).map((q) => q.id) };
    expect(quipCheck('shadow_quips_5')(five)).toBe(true);
    expect(newlyEarnedShadows(five)).toContain('shadow_quips_5');
    const many: GameState = { ...newGame(T0), quipsSeen: QUIPS.slice(0, 49).map((q) => q.id) };
    expect(quipCheck('shadow_quips_50')(many)).toBe(false);
    const fifty: GameState = { ...newGame(T0), quipsSeen: QUIPS.slice(0, 50).map((q) => q.id) };
    expect(quipCheck('shadow_quips_50')(fifty)).toBe(true);
  });

  it('закрывают «Своих людей» только полным набором одной лаборатории', () => {
    const openai = QUIPS.filter((q) => q.lab === 'openai').map((q) => q.id);
    const almost: GameState = { ...newGame(T0), quipsSeen: openai.slice(1) };
    expect(quipCheck('shadow_quips_lab')(almost)).toBe(false);
    // По одной реплике восьми Лабораторий — не набор: условие требует ВСЕ id одной.
    const spread: GameState = {
      ...newGame(T0),
      quipsSeen: QUIPS.filter((_, i) => i % 8 === 0).map((q) => q.id),
    };
    expect(quipCheck('shadow_quips_lab')(spread)).toBe(false);
    const full: GameState = { ...newGame(T0), quipsSeen: openai };
    expect(quipCheck('shadow_quips_lab')(full)).toBe(true);
  });

  it('ничего не увеличивают: проверка — чистое чтение состояния', () => {
    const s: GameState = { ...newGame(T0), quipsSeen: QUIPS.slice(0, 50).map((q) => q.id) };
    const before = JSON.stringify(s);
    for (const a of SHADOW_ACHIEVEMENTS.filter((x) => x.id.startsWith('shadow_quips'))) {
      expect(typeof a.check(s)).toBe('boolean');
    }
    expect(JSON.stringify(s)).toBe(before);
  });
});
