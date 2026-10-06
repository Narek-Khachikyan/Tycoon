import React, { useEffect, useState } from 'react';
import { LABS } from '../data/labs';
import { QUIPS } from '../data/quips';
import { quipsSeenOf, useGameStore } from '../store/useGameStore';
import { Icon } from './Icon';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { useDialogFocus } from './useDialogFocus';
import { THREE_COL_MIN } from '../layout';
import { useT } from '../i18n/useT';

export interface QuipBubbleProps {
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

export const QuipBubble: React.FC<QuipBubbleProps> = ({ placement = "office" }) => {
  const lastQuip = useGameStore((s) => s.lastQuip);
  const agents = useGameStore((s) => s.state.agents);
  const isSingle = useIsSingleCol();
  const t = useT();

  if (!lastQuip) return null;

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
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{t(lab.name)}</div>
        )}
        <div style={{ fontSize: "0.9rem", color: "var(--text-main)" }}>{t(lastQuip.text)}</div>
      </div>
    </div>
  );
};

interface QuipLogProps {
  isOpen: boolean;
  onClose: () => void;
}

const QuipCount: React.FC<{ seen: number; total: number }> = ({ seen, total }) => {
  const t = useT();
  return (
    <span style={{ fontSize: "0.9rem", color: "var(--text-muted)", fontWeight: 400 }}>
      (<Num>{seen}</Num> {t('из')} <Num>{total}</Num>)
    </span>
  );
};

export const QuipLogModal: React.FC<QuipLogProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, onClose);
  const t = useT();
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
              textTransform: "uppercase",
            }}
          >
            {t('Переписка')} <QuipCount seen={seen.size} total={QUIPS.length} />
          </h2>
          <button
            className="pixel-btn"
            onClick={onClose}
            aria-label={t('Закрыть')}
            title={t('Закрыть')}
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
              {t('Пока пусто — кликай, и Модели заговорят.')}
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
                    {t(LABS[q.lab].name)}
                  </div>
                  <div style={{ fontSize: "0.9rem", color: "var(--text-main)" }}>{t(q.text)}</div>
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
          {t('Закрыть')}
        </button>
      </div>
    </div>
  );
};
