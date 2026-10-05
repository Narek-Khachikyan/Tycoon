/**
 * Симулятор раннего геймплея: гоняет настоящий движок без рендера и печатает,
 * сколько времени стоит каждая веха первых получаса. Нужен, чтобы баланс
 * Поколения 1 выбирался числами, а не ощущением.
 *
 * Запуск: npx tsx tools/sim.ts [--gen 1] [--cps 5] [--prestige]
 */
import { CATALOG } from '../src/economy/catalog';
import { newGame, type GameState } from '../src/economy/state';
import { advanceTime, buyAgents, buyUpgrade, canPrestige, click, prestige, prestigeGain, totalIncome, clickValue } from '../src/economy/engine';
import { availableUpgrades } from '../src/economy/upgrades';
import { migrate } from '../src/economy/save';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const T0 = 1_700_000_000_000;
const DT = 1 / 20;
const CPS = arg('cps', 5);

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return '∞';
  const units = [
    [1e300, 'e300'], [1e36, 'e36'], [1e24, 'e24'], [1e18, 'e18'], [1e12, 'e12'], [1e9, 'e9'], [1e6, 'e6'],
  ];
  for (const [v, s] of units) if (n >= v) return (n / v).toFixed(2) + s;
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(1);
};

/** Покупает всё, что может, в порядке «дороже всего выгоднее» — простой жадный политик. */
function spend(s: GameState): GameState {
  let next = s;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    // Апгрейды: покупаем всё доступное и по карману.
    for (const u of availableUpgrades(next)) {
      if (u.cost <= next.tokens) {
        const after = buyUpgrade(next, u.id);
        if (after !== next) { next = after; changed = true; }
      }
    }
    // Модели: сначала те, у которых доход за цену лучший.
    const models = CATALOG[next.generation].models
      .map((m) => ({ m, owned: next.agents[m.id] ?? 0 }))
      .sort((a, b) => (b.m.baseIncome / (b.m.baseCost * Math.pow(1.15, b.owned))) - (a.m.baseIncome / (a.m.baseCost * Math.pow(1.15, a.owned))));
    for (const { m, owned } of models) {
      let after = buyAgents(next, m.id, 'max');
      while (after !== next) { next = after; after = buyAgents(next, m.id, 'max'); }
      if ((next.agents[m.id] ?? 0) !== owned) changed = true;
    }
    if (!changed) break;
  }
  return next;
}

function run(minutes: number, doPrestige: boolean): void {
  let s = migrate(null, T0);
  let t = 0;
  let clickCarry = 0;
  const marks = new Map<string, number>();
  const mark = (k: string) => { if (!marks.has(k)) marks.set(k, t); };
  const owned = (x: GameState) => Object.values(x.agents).reduce((a, b) => a + b, 0);
  let lastLog = -1;
  let prestigeAt: number | null = null;

  const steps = Math.round((minutes * 60) / DT);
  for (let i = 0; i < steps; i++) {
    // Клики: пачками по 1/CPS секунды, но не более одного на шаг тика.
    clickCarry += CPS * DT;
    while (clickCarry >= 1) { clickCarry -= 1; s = click(s); }
    s = advanceTime(s, DT);
    s = spend(s);

    const n = owned(s);
    if (n >= 1) mark('первый Агент');
    if (n >= 10) mark('10 Агентов');
    if (n >= 25) mark('25 Агентов');
    if (n >= 50) mark('50 Агентов');
    if (n >= 100) mark('100 Агентов');
    if (s.upgrades.length >= 1) mark('первый Апгрейд');
    if (s.upgrades.length >= 5) mark('5 Апгрейдов');
    if (s.clicks >= 100) mark('100 кликов');
    if (canPrestige(s)) mark('можно Престижить');
    for (const g of CATALOG[s.generation].models) {
      if ((s.agents[g.id] ?? 0) > 0) mark(`Агент: ${g.name}`);
    }
    if (prestigeAt === null && canPrestige(s) && doPrestige && prestigeGain(s) >= 1) {
      prestigeAt = t;
      const before = t;
      s = prestige(s, T0 + t * 1000);
      mark(`ПРЕСТИЖ #${s.prestiges} → ${CATALOG[s.generation].name}`);
      console.log(`\n>>> ПРЕСТИЖ на ${(before / 60).toFixed(1)} мин, забег ${fmt(s.runTokens)} → Compute ${s.compute}\n`);
      lastLog = -1;
    }

    const minute = Math.floor(t / 60);
    if (minute !== lastLog) {
      lastLog = minute;
      console.log(
        `t=${String(minute).padStart(2)}m доход=${fmt(totalIncome(s)).padStart(8)}/s кошелёк=${fmt(s.tokens).padStart(9)} агенты=${String(n).padStart(4)} апгрейды=${String(s.upgrades.length).padStart(2)} клик=${fmt(clickValue(s)).padStart(8)} поколение=${s.generation}`,
      );
    }
    t += DT;
  }

  console.log('\n=== вехи ===');
  for (const [k, v] of marks) console.log(`${k.padEnd(28)} ${v < 60 ? v.toFixed(1) + ' с' : (v / 60).toFixed(1) + ' мин'}`);
  console.log(`итог: доход ${fmt(totalIncome(s))}/с, поколение ${s.generation}, забег ${fmt(s.runTokens)}, престижей ${s.prestiges}`);
}

run(arg('gen', 30), has('prestige'));