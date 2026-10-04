import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { LABS, LAB_IDS, type LabId } from '../data/labs';
import { canPrestige, isContentFinale, labIncomeShare } from '../economy/engine';
import { labAgents, labWork, SYNERGY_PER_AGENT, synergyUpgradeId } from '../economy/upgrades';
import { formatCount, formatNumber } from '../economy/format';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { OFFICE_COL_MIN } from '../layout';

// Сцен четыре, по две эпохи Поколения на каждую (ADR-0002), поэтому индекс Сцены —
// floor(Поколение / 2). Список имён выводится из количества, а не дублируется руками:
// иначе четвёртая Сцена и её файл разъехались бы при добавлении пятой.
const SCENE_COUNT = 4;
const SCENE_SRC = Array.from({ length: SCENE_COUNT }, (_, i) => `/scenes/scene-${i + 1}.png`);

// Жёсткий контур вокруг счётчика Агентов на картинке. Не плашка: она закрывала бы пол Сцены
// прямоугольником, а контур из четырёх смещений держит читаемость на любом фоне, не добавляя
// подложки. Тот же приём, что у .floater.
const BADGE_OUTLINE = '1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000, 0 2px 3px #000';

// Контактная тень под Маскотом. Живёт здесь, а не в MascotSprite: тень — свойство стоящего в
// комнате, а не спрайта, и в магазине, где Маскот стоит в строке списка, пола нет вовсе.
//
// Плоский эллипс, а не filter: drop-shadow() обводит силуэт по альфе и оставляет ореол вокруг
// всех внутренних пробелов блочного спрайта. 0.38 выбрано как середина рабочего диапазона:
// 0.30 уже не читается на почти чёрном полу Сцены 4, а 0.45 на светлом полу Сцены 2
// превращается в яму. Тот же чёрный, что у --bg-scrim и контура .floater.
const CONTACT_SHADOW = 'rgba(0, 0, 0, 0.38)';

const MASCOT_SIZE = 48;
// Геометрия выведена из MASCOT_SIZE, а не зашита пикселями: тень обязана переехать вместе с
// Маскотом при любой смене размера. Треть высоты — приплюснутый эллипс, 0.7 ширины —
// чуть шире самих ног, как в пиксель-арт-референсах.
const SHADOW_W = MASCOT_SIZE * 0.7;
const SHADOW_H = MASCOT_SIZE / 3;
// Ось эллипса на 83% высоты бокса: ступни восьми Маскотов стоят вразброс от
// 70% (краб, кит) до 87% (капибара, вихрь), и 83% — их средняя линия. Тень такой
// высоты накрывает любые из этих ног, поэтому Маскоты нигде не отрываются от пола.
const SHADOW_CENTER_Y = MASCOT_SIZE * 0.83;

// Нижняя граница ширины колонки ленты Маскотов, и число колонок на этот раз считает сама
// сетка: фиксированный repeat() на 320 px делил восемь колонок по 33 px, и Маскоты в 48 px
// наезжали друг на друга, а крайние ещё и обрезались краями Сцены. Порог задаёт не Маскот,
// а его счётчик — самая широкая обычная строка formatNumber, «×1.23e300» в sci, это 62.7 px
// в Pixelify Sans 12.8 px вместе с жёстким контуром. Восемь таких колонок — 512 px —
// влезают в Сцену десктопа, поэтому там все восемь Лабораторий по-прежнему стоят в ряд.
const MASCOT_COL_MIN = 64;

// Ниже этой доли процент не различает Лаборатории: на восьми такая метка повторялась бы
// пять раз из восьми и читалась бы как «у всех всё одинаково».
const SHARE_MIN = 0.01;

// Пыль в воздухе Сцены: точки, которые делают кадр живым, а не статичным. Таблица строится
// один раз на модуль и сразу на максимум точек: OfficeColumn перерисовывается каждый тик,
// и Math.random в теле компонента перемешивал бы пыль двадцать раз в секунду.
const MOTE_MIN = 18;
const MOTE_MAX = 36;
const MOTES = Array.from({ length: MOTE_MAX }, (_, i) => {
  // Золотое сечение по двум осям: ряд равномерный, но не в сетке — по сетке пыль читалась бы
  // как узор, а не как воздух.
  const x = ((i * 0.618034) % 1) * 96;
  const y = 1 - ((i * 0.381966 + 0.17) % 1) * 0.92;
  const dur = 6 + (i % 4) * 0.9;
  return {
    left: `${x.toFixed(2)}%`,
    bottom: `${(y * 100).toFixed(2)}%`,
    size: 2 + (i % 3),
    // Четные плывут влево, нечётные вправо: соседние точки не идут в одну сторону.
    dx: `${(i % 2 ? 1 : -1) * (8 + (i % 4) * 5)}px`,
    dy: `-${18 + (i % 5) * 7}px`,
    dur: `${dur.toFixed(1)}s`,
    // Отрицательные задержки: пыль уже в пути на первом кадре, а не начинает движение
    // спустя первые шесть секунд.
    delay: `-${(((i * 1.7) % dur)).toFixed(2)}s`,
  };
});

const moteStyle = (i: number): React.CSSProperties =>
  ({
    left: MOTES[i].left,
    bottom: MOTES[i].bottom,
    width: MOTES[i].size,
    height: MOTES[i].size,
    '--mote-dx': MOTES[i].dx,
    '--mote-dy': MOTES[i].dy,
    '--mote-dur': MOTES[i].dur,
    '--mote-delay': MOTES[i].delay,
  }) as React.CSSProperties;

// Плотность пыли растёт вместе с офисом: пустой кадр не должен выглядеть гуще забитого.
// Шкала логарифмическая, потому что Агентов бывает и тысяча, и 1e300, а длина округляется
// до целого — иначе список узлов пересоздавался бы двадцать раз в секунду.
const moteCount = (agents: number): number => {
  const full = Math.min(Math.max(Math.log10(agents + 1) / 4, 0), 1);
  return Math.round(MOTE_MIN + (MOTE_MAX - MOTE_MIN) * full);
};

export const OfficeColumn: React.FC<{ full?: boolean }> = ({ full = false }) => {
  const state = useGameStore((s) => s.state);
  const triggerPrestige = useGameStore((s) => s.triggerPrestige);
  const notation = state.settings.notation;

  const gen = CATALOG[state.generation];
  const flagship = gen.flagship;
  const flagshipOwned = (state.agents[flagship.id] ?? 0) >= 1;
  const prestigeReady = canPrestige(state);
  const finale = isContentFinale(state);

  const sceneIndex = Math.min(Math.floor(state.generation / 2), SCENE_COUNT - 1);

  // Кроссфейд Сцены: предыдущий кадр лежит под новым, входящий проявляется
  // opacity 0→1 за 0.4s (класс scene-crossfade--in, только opacity — разрешена
  // и при reducedMotion). Предыдущий убирается по onAnimationEnd входящего,
  // таймеров нет. Пара {prev, curr}, а не очередь: Сцена меняется не чаще,
  // чем игрок жмёт Престиж.
  const [sceneShown, setSceneShown] = useState({ prev: -1, curr: sceneIndex });
  useEffect(() => {
    setSceneShown((s) => (s.curr === sceneIndex ? s : { prev: s.curr, curr: sceneIndex }));
  }, [sceneIndex]);

  // Двухшаговый Престиж, как в магазине: первый Клик только взводит кнопку, второй
  // в течение ARM_MS выполняет переход в новое Поколение — сброс Забега необратим.
  // Логика продублирована локально, общий компонент не выделяем. Звук только
  // на выполнении внутри triggerPrestige. Взвод — текстом и красной заливкой
  // (знак необратимости, как у продажи), без движения: в reducedMotion это те же
  // текст и цвет, ничего отключать не нужно.
  const ARM_MS = 6000;
  const [prestigeArmed, setPrestigeArmed] = useState(false);
  const prestigeTimer = useRef<number | null>(null);
  // Размонтирование гасит one-shot: иначе он сбросил бы подпись уже несуществующей кнопки.
  useEffect(
    () => () => {
      if (prestigeTimer.current !== null) window.clearTimeout(prestigeTimer.current);
    },
    [],
  );
  // Взвод не переживает потерю готовности: armed-кнопка не должна остаться после того,
  // как условия Престижа ушли.
  useEffect(() => {
    if (!prestigeReady || finale) {
      if (prestigeTimer.current !== null) {
        window.clearTimeout(prestigeTimer.current);
        prestigeTimer.current = null;
      }
      setPrestigeArmed(false);
    }
  }, [prestigeReady, finale]);

  const handlePrestige = () => {
    if (!prestigeArmed) {
      setPrestigeArmed(true);
      prestigeTimer.current = window.setTimeout(() => {
        prestigeTimer.current = null;
        setPrestigeArmed(false);
      }, ARM_MS);
      return;
    }
    if (prestigeTimer.current !== null) {
      window.clearTimeout(prestigeTimer.current);
      prestigeTimer.current = null;
    }
    setPrestigeArmed(false);
    triggerPrestige();
  };

  // Прогрев соседних Сцен: без неё Престиж на секунду показывает пустой кадр, потому что
  // картинка начинает грузиться только когда src уже назначен. Вперёд — для следующего
  // Престижа, назад — для возврата взглядом: раньше обратного прелоада не было (аудит).
  // Края массива отсекаются по SCENE_COUNT, чтобы не зациклиться.
  useEffect(() => {
    for (const i of [sceneIndex + 1, sceneIndex - 1]) {
      if (i < 0 || i >= SCENE_COUNT) continue;
      const preload = new Image();
      preload.src = SCENE_SRC[i];
    }
  }, [sceneIndex]);

  const activeLabs = LAB_IDS.filter((l) => labAgents(state, l) > 0);
  const totalAgents = activeLabs.reduce((sum, l) => sum + labAgents(state, l), 0);

  // Прыжок Маскота при покупке Агента его Лаборатории. Предыдущие числа — в ref, как
  // prevOwned в ModelRow: магазин перерисовывается каждый тик, и отмечать покупку в сторе
  // значило бы гонять эффект по всей колонке двадцать раз в секунду. Сравнение идёт по всем
  // LAB_IDS, а не по activeLabs: иначе появление первой покупки новой Лаборатории (0 → 1)
  // не отличить от первого рендера, и Маскот либо не прыгнул бы, либо прыгнули бы все сразу.
  const prevLabCounts = useRef<Partial<Record<LabId, number>>>({});
  const hopNodes = useRef(new Map<LabId, HTMLDivElement>());
  const [hoppingLabId, setHoppingLabId] = useState<LabId | null>(null);

  useEffect(() => {
    const prev = prevLabCounts.current;
    // Первый замер только запоминает числа: иначе все Маскоты с Агентами прыгнули бы
    // на загрузке сохранения. LAB_IDS статичен, поэтому пустой ref — это ровно первый замер.
    let known = false;
    for (const labId of LAB_IDS) {
      if (prev[labId] !== undefined) {
        known = true;
        break;
      }
    }
    if (!known) {
      for (const labId of LAB_IDS) prev[labId] = labAgents(state, labId);
      return;
    }
    // Покупка растит ровно одну Лабораторию, поэтому прыгает первая выросшая; импорт
    // сохранения может вырастить несколько сразу — там прыжка одной достаточно, это редкий
    // путь, а не игровой отклик.
    for (const labId of LAB_IDS) {
      const before = prev[labId] ?? 0;
      const now = labAgents(state, labId);
      prev[labId] = now;
      if (now <= before) continue;
      setHoppingLabId(labId);
      const node = hopNodes.current.get(labId);
      if (!node) continue;
      // Чтение ширины между снятием и возвратом класса — обязательный сброс анимации:
      // иначе быстрая повторная покупка той же Лаборатории не перезапустила бы прыжок,
      // класс ведь не менялся. Тот же приём, что у model-row--pop.
      node.classList.remove('mascot-hop');
      void node.offsetWidth;
      node.classList.add('mascot-hop');
      break;
    }
  }, [state.agents]);

  const synergyLabs = activeLabs.filter((l) =>
    state.upgrades.includes(synergyUpgradeId(state.generation, l))
  );

  return (
    <div
      style={{
        flex: 1,
        // Офис — единственная растягиваемая колонка. Её минимум держит офис читаемым в сетке
        // из трёх колонок, а в одноколоночном режиме он снимается: иначе на узком экране колонка
        // не влезла бы и обёртка пустила горизонтальную прокрутку.
        minWidth: full ? 0 : OFFICE_COL_MIN,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        height: '100%',
        overflowY: 'auto',
        padding: '16px',
        gap: '16px',
      }}
    >
      {/* Баннер Поколения и Флагмана. key пересоздаёт карточку на смене Поколения
          или финала, поэтому появление через существующий toast-fade (только opacity,
          без движения) проигрывается один раз на смену текста. */}
      <div
        key={`${state.generation}-${finale ? 'finale' : 'goal'}`}
        className="pixel-card"
        style={{
          flexShrink: 0,
          padding: '16px',
          borderLeft: `6px solid ${flagshipOwned ? 'var(--gold)' : 'var(--accent-color)'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          animation: 'toast-fade 0.15s ease-out',
        }}
      >
        <div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            ЦЕЛЬ ПОКОЛЕНИЯ
          </div>
          <div style={{ fontSize: '1.25rem', color: 'var(--text-main)', marginTop: '2px' }}>
            Флагман: <span style={{ color: 'var(--gold)' }}>{flagship.name}</span> ({LABS[flagship.lab].name})
          </div>
          <div style={{ fontSize: '0.85rem', color: flagshipOwned ? 'var(--green)' : 'var(--text-muted)', marginTop: '4px' }}>
            {flagshipOwned
              ? 'Флагман нанят! Престиж в следующее поколение разблокирован.'
              : 'Найми хотя бы 1 агента флагмана, чтобы открыть престиж.'}
          </div>
        </div>

        {prestigeReady && !finale && (
          <button
            onClick={handlePrestige}
            className="pixel-btn pixel-btn-gold"
            style={{
              fontSize: '1rem',
              padding: '10px 16px',
              ...(prestigeArmed
                ? { backgroundColor: 'var(--red-solid)', borderColor: 'var(--red)' }
                : undefined),
            }}
          >
            {prestigeArmed ? 'Точно в новое Поколение? Забег сбросится — нажми ещё раз' : 'Совершить престиж'}
          </button>
        )}

        {finale && (
          <div
            style={{
              padding: '8px 14px',
              backgroundColor: 'var(--tint-gold)',
              border: '2px solid var(--gold)',
              borderRadius: '6px',
              textAlign: 'center',
            }}
          >
            <div style={{ color: 'var(--gold)', fontSize: '1rem' }}>Финал контента MVP!</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--gold)' }}>
              Ты на острие ИИ! Жди новые реальные модели в будущих апдейтах.
            </div>
          </div>
        )}
      </div>

      {/* Сцена: Пиксельный офис, в котором стоят Маскоты купленных Лабораторий. Классы нужны,
          чтобы адресовать части Сцены из проверок; оформление живёт в style, как во всём
          остальном интерфейсе. */}
      <div
        className="scene"
        style={{
          flex: 1,
          minHeight: '300px',
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '6px',
          border: '2px solid var(--border)',
          backgroundColor: 'var(--bg-void)',
        }}
      >
        {/* Кроссфейд: предыдущий кадр лежит нижним слоем, новый проявляется поверх
            (класс scene-crossfade--in, только opacity). Предыдущий убирается по концу
            входящей анимации — таймеров нет, текст и HUD-полосы вне картинки (ADR-0002). */}
        {sceneShown.prev >= 0 && sceneShown.prev !== sceneShown.curr ? (
          <>
            <img
              className="scene__img"
              src={SCENE_SRC[sceneShown.prev]}
              alt=""
              draggable={false}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                display: 'block',
                // Арт 384×256 и растягивается нецелым кратным: без этого он читался бы как мыло.
                imageRendering: 'pixelated',
                userSelect: 'none',
              }}
            />
            <img
              className="scene__img scene-crossfade--in"
              src={SCENE_SRC[sceneShown.curr]}
              alt=""
              draggable={false}
              onAnimationEnd={(e) => {
                // Конец здесь — это конец входящего кроссфейда: событие всплывает от
                // потомков Сцены, поэтому чужое имя игнорируется.
                if (e.animationName !== 'scene-crossfade-in') return;
                setSceneShown((s) => (s.prev < 0 ? s : { prev: -1, curr: s.curr }));
              }}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                display: 'block',
                imageRendering: 'pixelated',
                userSelect: 'none',
              }}
            />
          </>
        ) : (
          <img
            className="scene__img"
            src={SCENE_SRC[sceneShown.curr]}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              display: 'block',
              // Арт 384×256 и растягивается нецелым кратным: без этого он читался бы как мыло.
              imageRendering: 'pixelated',
              userSelect: 'none',
            }}
          />
        )}

        {/* HUD-полоса: собственный скрим, поэтому читаемость подписи не зависит от того,
            что нарисовала машина (ADR-0002). */}
        <div
          className="scene__hud"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '8px',
            padding: '9px 12px',
            background: 'linear-gradient(to bottom, var(--bg-scrim) 0%, var(--bg-scrim) 55%, transparent 100%)',
          }}
        >
          <span style={{ fontSize: '1rem', color: 'var(--text-main)' }}>ОФИС АГЕНТОВ</span>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
            <Num>{formatNumber(totalAgents, notation)}</Num>{' '}
            {formatCount(totalAgents, 'Агент', 'Агента', 'Агентов')}
          </span>
        </div>

        {/* Маскоты стоят на общей линии у нижнего края Сцены, а подписи Лабораторий живут
            в ростере под ней — на ровной поверхности, где контраст не зависит от картинки. */}
        <div
          className="scene__mascots"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            display: 'grid',
            // Колонок столько, сколько влезло: на телефоне восемь Лабораторий встают в два
            // ряда, и верхний ряд поднимается выше затемнения — но его счётчики в него ещё
            // помещаются, а лента остаётся прижата к полу.
            gridTemplateColumns: `repeat(auto-fit, minmax(${MASCOT_COL_MIN}px, 1fr))`,
            // Ряды не примыкают друг к другу: сумма двух рядов — 154 px, а затемнение при
            // минимальной Сцене в 300 px накрывает только нижние 114 px, и без зазора верхний
            // счётчик сел бы встык с Маскотом нижнего ряда.
            rowGap: '8px',
            alignItems: 'end',
            padding: '0 8px 12px',
          }}
        >
          {activeLabs.map((labId) => (
            <div
              key={labId}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: 0 }}
            >
              {/* Обёртка нужна, чтобы тень заняла ровно квадрат Маскота: у растянутого SVG своя
                  высота, и ось эллипса иначе плыла бы вместе с ней. */}
              <div style={{ position: 'relative', width: MASCOT_SIZE, height: MASCOT_SIZE }}>
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: SHADOW_CENTER_Y - SHADOW_H / 2,
                    width: SHADOW_W,
                    height: SHADOW_H,
                    marginLeft: -SHADOW_W / 2,
                    borderRadius: '50%',
                    backgroundColor: CONTACT_SHADOW,
                    zIndex: 0,
                    // Декорация: ни клика, ни фокуса.
                    pointerEvents: 'none',
                  }}
                />
                {/* Прыжок висит на родителе узла покачивания, а не на нём самом: animation на том
                    же узле перезаписала бы бесконечное mascot-bob, а вложенный transform
                    складывается с ним — прыжок идёт поверх покачивания, не вместо него. Тень
                    остаётся на полу: прыгает только Маскот, а не его контакт с полом. */}
                <div
                  ref={(node) => {
                    if (node) hopNodes.current.set(labId, node);
                    else hopNodes.current.delete(labId);
                  }}
                  className={hoppingLabId === labId ? 'mascot-hop' : undefined}
                  onAnimationEnd={(e) => {
                    // Покачивание бесконечно и конца не даёт, поэтому конец здесь — это конец
                    // прыжка. Таймеров в игре нет, снятие только по событию анимации.
                    if (e.animationName !== 'mascot-hop') return;
                    e.currentTarget.classList.remove('mascot-hop');
                    setHoppingLabId((cur) => (cur === labId ? null : cur));
                  }}
                  style={{ position: 'relative', zIndex: 1, lineHeight: 0 }}
                >
                  <MascotSprite lab={labId} size={MASCOT_SIZE} animated />
                </div>
              </div>
              <span
                style={{ fontSize: '0.8rem', color: 'var(--text-main)', textShadow: BADGE_OUTLINE }}
              >
                ×<Num>{formatNumber(labAgents(state, labId), notation)}</Num>
              </span>
            </div>
          ))}
        </div>

        {/* Пыль в воздухе Сцены: часть картинки, а не слой поверх неё, поэтому гаснет вместе
            с полом, а не светится поверх затемнения. Держит порядок разметка: у пыли и у
            скрима одинаковый z-index 1, а при равном z-index рисуется тот, кто позже в DOM. */}
        <div className="scene__motes">
          {MOTES.slice(0, moteCount(totalAgents)).map((_, i) => (
            <span key={i} className="mote" style={moteStyle(i)} />
          ))}
        </div>

        {/* Затемнение низа Сцены: под ним читаются и Маскоты, и их счётчики — иначе на
            светлом полу Сцены 2 они стояли бы белым по белому. Скрин лежит под Маскотами
            (zIndex 1 против 2), поэтому гасит пол, а не сами фигурки. */}

        <div
          className="scene__scrim"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            background: 'linear-gradient(to top, var(--bg-scrim), transparent 38%)',
          }}
        />

        {activeLabs.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              pointerEvents: 'none',
            }}
          >
            {/* Подложка непрозрачная: пустое состояние читается на любой из четырёх Сцен. */}
            <div
              style={{
                backgroundColor: 'var(--bg-panel)',
                border: '2px solid var(--border)',
                borderRadius: '6px',
                padding: '18px 24px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>Офис пока пуст</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                Найми своего первого ИИ-агента в магазине справа!
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Ростер: имена Лабораторий, их Маскоты, счётчики Агентов и Синергия — на ровной
          поверхности --bg-card, где приглушённый текст держит 5.5:1. */}
      <div
        className="roster"
        style={{
          flexShrink: 0,
          backgroundColor: 'var(--bg-card)',
          border: '2px solid var(--border)',
          borderRadius: '6px',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>СОСТАВ ЛАБОРАТОРИЙ</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {activeLabs.length}{' '}
            {formatCount(activeLabs.length, 'Лаборатория', 'Лаборатории', 'Лабораторий')} в офисе
          </span>
        </div>

        {activeLabs.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Пока никто не нанят — Сцена ждёт первого агента.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {activeLabs.map((labId) => {
              const lab = LABS[labId];
              const count = labAgents(state, labId);
              const synergyPct = Math.round(count * SYNERGY_PER_AGENT * 100);
              const synergyOn = state.upgrades.includes(synergyUpgradeId(state.generation, labId));
              const work = labWork(state, labId);
              const share = labIncomeShare(state, labId);
              return (
                <div
                  key={labId}
                  style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', rowGap: '2px' }}
                >
                  {/* Цвет Лаборатории живёт только здесь: на --bg-card он не задаёт контраст
                      текста, а плашкой служит лишь ориентиром, у какой Маскот чья. */}
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      backgroundColor: lab.color,
                      border: '1px solid var(--border)',
                      borderRadius: '2px',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{lab.name}</span>
                  {/* Имя Маскота не повторяется: он стоит в ленте прямо над ростером, и его
                      счётчик подписан под ним. Счётчик Агентов здесь остаётся: на Сцене он
                      мелкий и читается только вплотную, а в ростере это основное число строки,
                      и без него карточка в свежем сохранении держит одно имя. */}
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ×<Num>{formatNumber(count, notation)}</Num>{' '}
                    {formatCount(count, 'Агент', 'Агента', 'Агентов')}
                  </span>
                  {/* Название работы приходит из MODEL_TIERS, а не пишется здесь строкой.
                      Без пиксельного шрифта: среди тиров есть «1M контекст», а строка с
                      кириллицей набирается Nunito (ADR-0003). */}
                  {work !== '' && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {work}
                    </span>
                  )}
                  {/* Доля в Доходе — величина сравнительная, и читается она только когда
                      различает: с одной Лабораторией она всегда 100%, а ниже процента
                      неотличима от нуля. На восьми Лабораториях такая мелочь занимала бы
                      пять строк из восьми и читалась как «у всех всё одинаково». */}
                  {activeLabs.length > 1 && share >= SHARE_MIN && (
                    <span className="pixel-font" style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                      {Math.round(share * 100)}%
                    </span>
                  )}
                  {synergyOn && (
                    <span
                      title={`Синергия: +${synergyPct}% к доходу всех моделей ${lab.name}`}
                      style={{ fontSize: '0.75rem', color: 'var(--gold)' }}
                    >
                      +<Num>{synergyPct}</Num>%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {synergyLabs.length > 0 && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Синергия: каждый агент Лаборатории добавляет доход всем её моделям (апгрейд «Общий датасет»).
          </div>
        )}
      </div>
    </div>
  );
};