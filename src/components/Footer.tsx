import React from 'react';

export const Footer: React.FC = () => {
  return (
    // Полоса целиком описана классом: ритм, кегль и цвет подвала — те же числа, что у шапки,
    // и держать их инлайном здесь означало бы, что подвал настраивается отдельно от шкалы.
    <footer className="footer-bar">
      <span className="footer-bar__lead">
        Данные метрик, задержек и цен предоставлены{' '}
        {/* Атрибуция обязательна, поэтому её нельзя терять ни переносом, ни обрезкой: цвет
            ссылки, видимый фокус и высота под пальцем живут в классе footer-aa-link, потому
            что инлайн-переопределение убило бы их все. */}
        <a
          href="https://artificialanalysis.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-aa-link"
        >
          Artificial Analysis ↗
        </a>
      </span>
      {/* Разделитель — украшение, а не текст: без aria-hidden скринридер читал бы его знаком. */}
      <span aria-hidden="true">•</span>
      <span>Token Clicker MVP</span>
    </footer>
  );
};
