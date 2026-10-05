import React, { useEffect, useState } from 'react';
import { LABS } from '../data/labs';
import { QUIPS } from '../data/quips';
import { quipsSeenOf, useGameStore } from '../store/useGameStore';
import { Icon } from './Icon';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { useDialogFocus } from './useDialogFocus';
import { THREE_COL_MIN } from '../layout';

export interface QuipBubbleProps {
  /**
   * Место монтажа:
   * - "office" (по умолчанию): на Сцене Офиса (абсолютное позиционирование). На десктопе
   *   (>= THREE_COL_MIN) это единственный пузырь на экране.
   * - "prompt": в колонке Клика над кнопкой «Отправить промпт». На десктопе скрывается,
   *   чтобы не дублировать пузырь в Офисе. На мобильном (< THREE_COL_MIN) оживает, так как
   *   вкладка «Офис» спрятана за нижней навигацией.
   */
  placement?: "office" | "prompt";
}

function useIsSingleCol(): boolean {
  const [isSingle, setIsSingle] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < THREE_COL_MIN : false
  );

  useEffect(() => {
    const handleResize = () => setIsSingle(window.innerWidth < THREE_COL_MIN);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isSingle;
}

/**
 * Пузырь реплики говорящей Модели: портрет Маскота говорящего плюс текст.
 *
 * Слой декоративный (pointerEvents none): пузырь не должен перехватывать клики по Глюкам,
 * Золотому Токену или кнопке «Отправить промпт». На десктопе живёт на Сцене Офиса. На
 * узком экране колонка Офиса скрыта во вкладке, поэтому пузырь переезжает в ClickColumn
 * над кнопкой действия.
 */
export const QuipBubble: React.FC<QuipBubbleProps> = ({ placement = "office" }) => {
  const lastQuip = useGameStore((s) => s.lastQuip);
  const agents = useGameStore((s) => s.state.agents);
  const isSingle = useIsSingleCol();

  if (!lastQuip) return null;

  // На десктопе пузырь в ClickColumn не нужен — там уже открыт полноценный Офис.
  if (placement === "prompt" && !isSingle) {
    return null;
  }

  const empty = Object.values(agents).every((n) => (n ?? 0) <= 0);
  const lab = lastQuip.lab ? LABS[lastQuip.lab] : null;
  const isPrompt = placement === "prompt";

  return (
    <div
      key={lastQuip.nonce}
      className="quip-bubble pixel-card"
      style={{
        position: isPrompt ? "relative" : "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        ...(isPrompt
          ? { margin: "0 auto 12px auto" }
          : empty
          ? { top: "30%" }
          : { bottom: "104px" }),
        zIndex: 4,
        pointerEvents: "none",
        maxWidth: isPrompt ? "min(360px, 94%)" : "min(320px, 86%)",
        width: isPrompt ? "max-content" : undefined,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        boxSizing: "border-box",
      }}
    >
      {lab && lastQuip.lab && <MascotSprite lab={lastQuip.lab} size={32} />}
      <div style={{ minWidth: 0 }}>
        {lab && (
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{lab.name}</div>
        )}
        <div style={{ fontSize: "0.9rem", color: "var(--text-main)" }}>{lastQuip.text}</div>
      </div>
    </div>
  );
};

interface QuipLogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * «Переписка»: собранные реплики говорящих Моделей с портретами Маскотов.
 *
 * Читает quipsSeen из состояния и QUIPS из данных: порядок — каталожный, счётчик —
 * «N / всего». Пустая — тоже состояние, а не отсутствие окна: новичок должен увидеть,
 * что коллекция существует, до первой реплики. Оформление — как остальные окна
 * (скрим, pixel-card, вход toast-fade — только opacity, поэтому при reducedMotion
 * картина та же). Фокус — через useDialogFocus, как везде.
 *
 * Каркас окна лежит в Modals.tsx, и этот файл его не импортирует: общий файл компонентов
 * завести нельзя, а копия шести окон — это ровно то расхождение, из-за которого Переписка
 * выглядела шире соседних окон. Поэтому размеры, отступы и шапка здесь повторяют значения
 * Modals.tsx буквально: если каркас поменяется, это место надо поправить вместе с ним.
 */
export const QuipLogModal: React.FC<QuipLogProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  // Хук обязан стоять до раннего выхода: иначе окно то открывалось бы с ловушкой, то без неё.
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, onClose);
  if (!isOpen) return null;

  const seen = new Set(quipsSeenOf(state));
  const found = QUIPS.filter((q) => seen.has(q.id));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "var(--bg-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Тот же слой, что у окон в Modals.tsx: тосты лежат выше (100), оверлей Престижа
        // ниже (40), а Переписка с остальными окнами не пересекается.
        zIndex: 50,
        padding: "16px",
        animation: "toast-fade 0.18s ease-out",
      }}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiplog-title"
        className="pixel-card"
        style={{
          width: "100%",
          // 520 и 85vh — те же значения, что у пяти окон в Modals.tsx: одинаковая ширина
          // и высота означают, что переход в Переписку не «прыгает» карточкой на экране.
          maxWidth: "520px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          padding: "20px",
          gap: "14px",
          animation: "toast-fade 0.18s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
            flexShrink: 0,
          }}
        >
          <h2
            id="quiplog-title"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px",
              minWidth: 0,
              fontSize: "1.2rem",
              color: "var(--gold)",
              // Капс даёт text-transform, а не текст в DOM: иначе скринридер читал бы
              // «П Е Р Е П И С К А» по буквам, а имя окна — это то, что он произносит.
              textTransform: "uppercase",
            }}
          >
            Переписка <QuipCount seen={seen.size} total={QUIPS.length} />
          </h2>
          <button
            className="pixel-btn"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            style={{ padding: "4px 10px", flexShrink: 0 }}
          >
            <Icon name="close" />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {found.length === 0 ? (
            <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Пока пусто — кликай, и Модели заговорят.
            </div>
          ) : (
            found.map((q) => (
              <div
                key={q.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 10px",
                  backgroundColor: "var(--bg-card)",
                  borderRadius: "6px",
                }}
              >
                <MascotSprite lab={q.lab} size={28} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {LABS[q.lab].name}
                  </div>
                  <div style={{ fontSize: "0.9rem", color: "var(--text-main)" }}>{q.text}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <button
          className="pixel-btn"
          onClick={onClose}
          style={{ alignSelf: "flex-end", flexShrink: 0 }}
        >
          Закрыть
        </button>
      </div>
    </div>
  );
};

/**
 * Счётчик у названия Переписки: «7 из 42». Слово «из», а не слеш, — и для глаза, и для
 * произносимого вслух. Цифры пиксельным шрифтом, который по ADR-0003 выдерживает только
 * строку без кириллицы, поэтому «из» стоит рядом числом, а не внутри него.
 */
const QuipCount: React.FC<{ seen: number; total: number }> = ({ seen, total }) => (
  <span style={{ fontSize: "0.9rem", color: "var(--text-muted)", fontWeight: 400 }}>
    (<Num>{seen}</Num> из <Num>{total}</Num>)
  </span>
);
