import React, { useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { LABS, LAB_IDS } from '../data/labs';
import { canPrestige, isContentFinale } from '../economy/engine';
import { labAgents, SYNERGY_PER_AGENT, synergyUpgradeId } from '../economy/upgrades';
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
// Ось эллипса на 83% высоты бокса: ступни восьми Маскотов в сетке 24×24 стоят вразброс от
// 71% (Четырёхцвет, Китик) до 92% (Искорка, Ветерок), и 83% — их средняя линия. Тень такой
// высоты накрывает любые из этих ног, поэтому Маскоты нигде не отрываются от пола.
const SHADOW_CENTER_Y = MASCOT_SIZE * 0.83;

// Нижняя граница ширины колонки ленты Маскотов, и число колонок на этот раз считает сама
// сетка: фиксированный repeat() на 320 px делил восемь колонок по 33 px, и Маскоты в 48 px
// наезжали друг на друга, а крайние ещё и обрезались краями Сцены. Порог задаёт не Маскот,
// а его счётчик — самая широкая обычная строка formatNumber, «×1.23e300» в sci, это 62.7 px
// в Pixelify Sans 12.8 px вместе с жёстким контуром. Восемь таких колонок — 512 px —
// влезают в Сцену десктопа, поэтому там все восемь Лабораторий по-прежнему стоят в ряд.
const MASCOT_COL_MIN = 64;

// Пыль в воздухе Сцены: восемнадцать точек, которые делают кадр живым, а не статичным.
// Таблица строится один раз на модуль: OfficeColumn перерисовывается каждый тик, и Math.random
// в теле компонента перемешивал бы пыль двадцать раз в секунду.
const MOTE_COUNT = 18;
const MOTES = Array.from({ length: MOTE_COUNT }, (_, i) => {
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

  // Прогрев следующей Сцены: без неё Престиж на секунду показывает пустой кадр, потому что
  // картинка начинает грузиться только когда src уже назначен. Обход массива тут же зациклился
  // бы на последнем индексе, поэтому сосед отсекается по SCENE_COUNT.
  useEffect(() => {
    const next = sceneIndex + 1;
    if (next >= SCENE_COUNT) return;
    const preload = new Image();
    preload.src = SCENE_SRC[next];
  }, [sceneIndex]);

  const activeLabs = LAB_IDS.filter((l) => labAgents(state, l) > 0);
  const totalAgents = activeLabs.reduce((sum, l) => sum + labAgents(state, l), 0);
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
      {/* Баннер Поколения и Флагмана */}
      <div
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
            onClick={triggerPrestige}
            className="pixel-btn pixel-btn-gold"
            style={{ fontSize: '1rem', padding: '10px 16px' }}
          >
            Совершить престиж
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
        <img
          className="scene__img"
          src={SCENE_SRC[sceneIndex]}
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
                <div style={{ position: 'relative', zIndex: 1, lineHeight: 0 }}>
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
          {MOTES.map((_, i) => (
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
              return (
                <div key={labId} style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
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
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{lab.mascot}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ×<Num>{formatNumber(count, notation)}</Num>{' '}
                    {formatCount(count, 'Агент', 'Агента', 'Агентов')}
                  </span>
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