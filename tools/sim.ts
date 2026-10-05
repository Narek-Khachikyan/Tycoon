/**
 * Симулятор раннего геймплея: гоняет настоящий движок без рендера и печатает,
 * сколько времени стоит каждая веха первых получаса, и как ведёт себя второй забег.
 *
 * Нужен, чтобы ритм прогрессии выбирался числами, а не ощущением. Правки баланса без него
 * означали бы вслепую: единственный способ узнать, что лестница Ранга перевёрнута или что
 * Compute дают слишком щедро, — это посмотреть на кривую.
 *
 * Запуск:
 *   npx tsx tools/sim.ts                     первый забег, 40 минут
 *   npx tsx tools/sim.ts --prestige          с престижами (порог --compute)
 *   npx tsx tools/sim.ts --gen 90 --prestige --compute 25   два забега подряд
 *
 * Политика игрока жадная и осознанно простая: покупает всё доступное по порядку цены,
 * престижит, когда взял флагман и хватает Compute на следующий круг. Настоящий игрок
 * отличается тем, что крутит Температуру, — но симулятор этого не делает намеренно:
 * он должен задавать МИНИМАЛЬНЫЙ темп, а шкала может только его ускорить.
 */
import { CATALOG } from '../src/economy/catalog';
import { newGame, type GameState } from '../src/economy/state';
import {
  advanceTime,
  buyAgents,
  buyPerk,
  buyUpgrade,
  canPrestige,
  click,
  prestige,
  prestigeGain,
  totalIncome,
  clickValue,
} from '../src/economy/engine';
import { availableUpgrades } from '../src/economy/upgrades';
import { PERKS } from '../src/economy/perks';
import { migrate } from '../src/economy/save';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const T0 = 1_700_000_000_000;
const DT = 1 / 20;
const CPS = arg('cps', 5);
/** Compute, ради которого стоит начинать новый круг: столько наберится к моменту престижа. */
const TARGET_COMPUTE = arg('compute', 25);

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return '∞';
  const units: [number, string][] = [
    [1e300, 'e300'], [1e36, 'e36'], [1e24, 'e24'], [1e18, 'e18'], [1e12, 'e12'],
    [1e9, 'e9'], [1e6, 'e6'], [1e3, 'K'],
  ];
  for (const [v, s] of units) if (n >= v) return (n / v).toFixed(2) + s;
  return n.toFixed(1);
};

/** Покупает Перк, если хватает Compute. Дороже — раньше: дешёвые кончаются первыми. */
function buyAffordablePerk(s: GameState): GameState {
  const free = s.compute - s.computeSpent;
  const sorted = [...PERKS].sort((a, b) => b.cost - a.cost);
  for (const p of sorted) {
    if (p.cost <= free && !s.perks.includes(p.id)) return buyPerk(s, p.id);
  }
  return s;
}

/**
 * Один проход покупок: Перк, все доступные Апгрейды, затем Агенты по кругу.
 *
 * Несколько проходов, потому что покупка Агента может открыть Синергию, а та — новый
 * Апгрейд: один проход оставил бы на экране покупки, до которых игрок уже дорос.
 */
function spend(s: GameState): GameState {
  let next = buyAffordablePerk(s);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const u of availableUpgrades(next)) {
      if (u.cost <= next.tokens) {
        const after = buyUpgrade(next, u.id);
        if (after !== next) { next = after; changed = true; }
      }
    }
    // Агенты — по кругу, а не «все у лучшей Модели»: так растёт число Лабораторий в офисе,
    // а с ним и Синергия, и состав Сцены. Модели без Агентов пропускать нельзя, иначе
    // политика никогда не поднимется выше первой ступени.
    const models = CATALOG[next.generation].models
      .map((m) => ({ m, owned: next.agents[m.id] ?? 0 }))
      .sort((a, b) => (b.m.baseIncome / (b.m.baseCost * Math.pow(1.15, b.owned))) -
                     (a.m.baseIncome / (a.m.baseCost * Math.pow(1.15, a.owned))));
    for (const { m, owned } of models) {
      let after = buyAgents(next, m.id, 'max');
      while (after !== next) { next = after; after = buyAgents(next, m.id, 'max'); }
      if ((next.agents[m.id] ?? 0) !== owned) changed = true;
    }
    if (!changed) break;
  }
  return next;
}

const MIN = (v: number) => (v < 60 ? `${v.toFixed(1)} с` : `${(v / 60).toFixed(1)} мин`);

function run(minutes: number, doPrestige: boolean): void {
  let s = migrate(null, T0);
  let t = 0;
  let clickCarry = 0;
  const marks = new Map<string, number>();
  const mark = (k: string) => { if (!marks.has(k)) marks.set(k, t); };
  const owned = (x: GameState) => Object.values(x.agents).reduce((a, b) => a + b, 0);
  let lastLog = -1;

  const steps = Math.round((minutes * 60) / DT);
  for (let i = 0; i < steps; i++) {
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

    // Новый круг имеет смысл, когда взяты флагман и хватает Compute на следующий шаг.
    if (canPrestige(s) && doPrestige && prestigeGain(s) >= TARGET_COMPUTE &&
        (s.prestiges === 0 || s.compute - s.computeSpent >= TARGET_COMPUTE)) {
      mark(`ПРЕСТИЖ #${s.prestiges + 1} → ${CATALOG[s.generation + 1].name}`);
      s = prestige(s, T0 + t * 1000);
      console.log(
        `>>> ПРЕСТИЖ #${s.prestiges} на ${MIN(t)} всего (${(t / 60).toFixed(1)} мин) → ` +
        `${CATALOG[s.generation].name}, Compute ${s.compute}, Перков ${s.perks.length}`,
      );
      mark('первый Compute');
      mark(`престиж #${s.prestiges}`);
      lastLog = -1;
    }

    const minute = Math.floor(t / 60);
    if (minute !== lastLog) {
      lastLog = minute;
      console.log(
        `t=${String(minute).padStart(2)}м доход=${fmt(totalIncome(s)).padStart(8)}/с ` +
        `кошелёк=${fmt(s.tokens).padStart(9)} агенты=${String(n).padStart(4)} ` +
        `апгрейды=${String(s.upgrades.length).padStart(2)} клик=${fmt(clickValue(s)).padStart(8)} ` +
        `поколение=${s.generation} compute=${s.compute}`,
      );
    }
    t += DT;
  }

  console.log('\n=== вехи ===');
  for (const [k, v] of marks) console.log(`${k.padEnd(30)} ${MIN(v)}`);
  console.log(
    `итог: доход ${fmt(totalIncome(s))}/с, поколение ${s.generation}, ` +
    `забег ${fmt(s.runTokens)}, престижей ${s.prestiges}, перков ${s.perks.length}`,
  );
}

run(arg('gen', 40), has('prestige'));
