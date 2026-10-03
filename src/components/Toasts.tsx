import React, { useEffect } from 'react';
import { useGameStore, type ToastMessage } from '../store/useGameStore';
import { ACHIEVEMENTS } from '../economy/achievements';

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void }> = ({
  toast,
  onRemove,
}) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  const ach = ACHIEVEMENTS.find((a) => a.id === toast.desc);

  return (
    <div
      onClick={() => onRemove(toast.id)}
      className="pixel-card toast-card"
      style={{
        padding: '12px 14px',
        backgroundColor: '#1e293b',
        border: '2px solid #fbbf24',
        boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        maxWidth: '320px',
      }}
    >
      <div style={{ fontSize: '1.6rem' }}>🏆</div>
      <div>
        <div className="pixel-font" style={{ fontSize: '0.85rem', color: '#fbbf24' }}>
          {toast.title}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#f8fafc', fontWeight: 600 }}>
          {ach?.name ?? toast.desc}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          {ach?.desc}
        </div>
      </div>
    </div>
  );
};

export const Toasts: React.FC = () => {
  const toasts = useGameStore((s) => s.toasts);
  const removeToast = useGameStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 100,
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={removeToast} />
      ))}
    </div>
  );
};
