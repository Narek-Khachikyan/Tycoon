import React from 'react';
import type { LabId } from '../data/labs';

interface MascotProps {
  lab: LabId;
  size?: number;
  animated?: boolean;
  className?: string;
}

export const MascotSprite: React.FC<MascotProps> = ({
  lab,
  size = 32,
  animated = false,
  className = '',
}) => {
  const animClass = animated ? 'animate-mascot-bob' : '';

  const renderGraphic = () => {
    switch (lab) {
      case 'openai': // Узелок: бирюзовый технологичный узел/нода
        return (
          <g>
            <rect x="7" y="3" width="10" height="4" fill="#10a37f" />
            <rect x="5" y="7" width="14" height="10" fill="#3ad29f" />
            <rect x="3" y="11" width="18" height="2" fill="#20b686" />
            <rect x="8" y="10" width="3" height="3" fill="#ffffff" />
            <rect x="13" y="10" width="3" height="3" fill="#ffffff" />
            <rect x="9" y="11" width="1" height="1" fill="#113327" />
            <rect x="14" y="11" width="1" height="1" fill="#113327" />
            <rect x="10" y="14" width="4" height="1" fill="#113327" />
            <rect x="7" y="17" width="10" height="4" fill="#10a37f" />
            {/* Антенна-узелок */}
            <rect x="11" y="1" width="2" height="2" fill="#a7f3d0" />
          </g>
        );
      case 'anthropic': // Искорка: персиковая лучистая искорка
        return (
          <g>
            <rect x="11" y="2" width="2" height="3" fill="#ff7f50" />
            <rect x="9" y="5" width="6" height="4" fill="#ff8a4c" />
            <rect x="5" y="9" width="14" height="6" fill="#ffb088" />
            <rect x="2" y="11" width="3" height="2" fill="#ff7f50" />
            <rect x="19" y="11" width="3" height="2" fill="#ff7f50" />
            <rect x="8" y="11" width="2" height="2" fill="#4a1a05" />
            <rect x="14" y="11" width="2" height="2" fill="#4a1a05" />
            <rect x="9" y="14" width="6" height="1" fill="#ff4500" />
            <rect x="9" y="15" width="6" height="4" fill="#ff8a4c" />
            <rect x="11" y="19" width="2" height="3" fill="#ff7f50" />
          </g>
        );
      case 'google': // Четырёхцвет: геометричный 4-цветный робот
        return (
          <g>
            {/* 4 цвета: синий, красный, желтый, зеленый */}
            <rect x="6" y="5" width="6" height="6" fill="#4285f4" />
            <rect x="12" y="5" width="6" height="6" fill="#ea4335" />
            <rect x="6" y="11" width="6" height="6" fill="#fbbc05" />
            <rect x="12" y="11" width="6" height="6" fill="#34a853" />
            {/* Лицо */}
            <rect x="8" y="8" width="2" height="2" fill="#ffffff" />
            <rect x="14" y="8" width="2" height="2" fill="#ffffff" />
            <rect x="8" y="8" width="1" height="1" fill="#1e293b" />
            <rect x="14" y="8" width="1" height="1" fill="#1e293b" />
            <rect x="10" y="13" width="4" height="2" fill="#ffffff" />
            {/* Наушники */}
            <rect x="4" y="8" width="2" height="4" fill="#3b82f6" />
            <rect x="18" y="8" width="2" height="4" fill="#ef4444" />
          </g>
        );
      case 'xai': // Кубик: темный футуристичный куб с кибер-визором
        return (
          <g>
            {/* Серые подняты до холодного графита: на почти чёрном полу Сцены куб был не виден
                (1.24:1). Заливка держит 3.18:1 на --bg-card в магазине и 4.26:1 на самом
                тёмном полу, оставаясь самой тёмной заливкой спрайтов, а визор — самым
                ярким пятном. */}
            <rect x="5" y="5" width="14" height="14" fill="#6d7480" stroke="#8b95a7" strokeWidth="1" />
            {/* Неоновый визор */}
            <rect x="7" y="10" width="10" height="3" fill="#38bdf8" />
            <rect x="8" y="11" width="3" height="1" fill="#ffffff" />
            {/* Гексагон / X паттерн */}
            <rect x="9" y="15" width="2" height="2" fill="#98a2b4" />
            <rect x="13" y="15" width="2" height="2" fill="#98a2b4" />
          </g>
        );
      case 'deepseek': // Китик: синий пиксельный кит с фонтанчиком
        return (
          <g>
            {/* Фонтанчик */}
            <rect x="11" y="2" width="2" height="2" fill="#7dd3fc" />
            <rect x="9" y="4" width="6" height="2" fill="#38bdf8" />
            {/* Тело кита */}
            <rect x="4" y="6" width="15" height="10" fill="#3f6bff" />
            <rect x="6" y="14" width="11" height="3" fill="#93c5fd" />
            <rect x="2" y="9" width="3" height="4" fill="#2563eb" />
            {/* Глаз и улыбка */}
            <rect x="14" y="9" width="2" height="2" fill="#ffffff" />
            <rect x="15" y="9" width="1" height="1" fill="#0f172a" />
            <rect x="15" y="12" width="2" height="1" fill="#1e3a8a" />
            {/* Хвостик */}
            <rect x="2" y="7" width="2" height="3" fill="#3f6bff" />
            <rect x="2" y="12" width="2" height="3" fill="#3f6bff" />
          </g>
        );
      case 'meta': // Лама: пушистая голубая лама с ушками
        return (
          <g>
            {/* Ушки */}
            <rect x="8" y="3" width="2" height="4" fill="#0284c7" />
            <rect x="14" y="3" width="2" height="4" fill="#0284c7" />
            {/* Голова */}
            <rect x="7" y="6" width="10" height="9" fill="#38b6ff" />
            {/* Мордочка */}
            <rect x="8" y="11" width="8" height="4" fill="#e0f2fe" />
            <rect x="11" y="12" width="2" height="1" fill="#0369a1" />
            {/* Глазки */}
            <rect x="8" y="8" width="2" height="2" fill="#0c4a6e" />
            <rect x="14" y="8" width="2" height="2" fill="#0c4a6e" />
            {/* Тело шея */}
            <rect x="8" y="15" width="8" height="5" fill="#38b6ff" />
          </g>
        );
      case 'mistral': // Ветерок: теплый вихрь с улыбкой
        return (
          <g>
            <rect x="7" y="4" width="10" height="3" fill="#ffb02e" />
            <rect x="5" y="7" width="14" height="4" fill="#f59e0b" />
            <rect x="4" y="11" width="16" height="5" fill="#d97706" />
            <rect x="7" y="16" width="10" height="3" fill="#b45309" />
            <rect x="11" y="19" width="4" height="2" fill="#78350f" />
            {/* Глазки-ветерки */}
            <rect x="8" y="11" width="2" height="2" fill="#ffffff" />
            <rect x="14" y="11" width="2" height="2" fill="#ffffff" />
            <rect x="9" y="12" width="1" height="1" fill="#451a03" />
            <rect x="15" y="12" width="1" height="1" fill="#451a03" />
            <rect x="10" y="14" width="4" height="1" fill="#451a03" />
          </g>
        );
      case 'alibaba': // Капибара: невозмутимая фиолетовая капибара
        return (
          <g>
            {/* Мандаринка на голове */}
            <rect x="11" y="2" width="3" height="3" fill="#f97316" />
            <rect x="12" y="1" width="1" height="1" fill="#15803d" />
            {/* Голова */}
            <rect x="6" y="5" width="12" height="10" fill="#a066ff" />
            <rect x="5" y="6" width="2" height="2" fill="#7c3aed" />
            <rect x="17" y="6" width="2" height="2" fill="#7c3aed" />
            {/* Носик и морда */}
            <rect x="7" y="11" width="10" height="6" fill="#8b5cf6" />
            <rect x="10" y="13" width="4" height="2" fill="#3b0764" />
            {/* Невозмутимые глаза-щелочки */}
            <rect x="7" y="8" width="3" height="1" fill="#2e1065" />
            <rect x="14" y="8" width="3" height="1" fill="#2e1065" />
            {/* Тело */}
            <rect x="6" y="17" width="12" height="4" fill="#7c3aed" />
          </g>
        );
      default:
        return <rect x="4" y="4" width="16" height="16" fill="#64748b" />;
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`${animClass} ${className}`.trim()}
      style={{ imageRendering: 'pixelated' }}
    >
      {renderGraphic()}
    </svg>
  );
};
