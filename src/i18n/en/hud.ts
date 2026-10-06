/** Шапка, подвал, вкладки, нижняя навигация, оверлеи, термо-шкала. */
export const hud: Record<string, string> = {
  // --- HEADER ---
  'TOKEN CLICKER': 'TOKEN CLICKER',
  'Поколение {id}: {name} ({period})': 'Gen {id}: {name} ({period})',
  'Бонус к доходу от Compute': 'Income bonus from Compute',
  'Включить звук': 'Unmute sound',
  'Выключить звук': 'Mute sound',
  'Достижения': 'Achievements',
  'Достижения: {unlocked} из {total}': 'Achievements: {unlocked} of {total}',
  'Инфо': 'Info',
  'Настройки': 'Settings',

  // --- MOBILE NAV TABS ---
  'Промпт': 'Prompt',
  'Офис': 'Office',
  'Магазин': 'Shop',

  // --- FOOTER ---
  'Данные метрик, задержек и цен предоставлены': 'Metrics, latency, and pricing data provided by',

  // --- NEWS TICKER ---
  'НОВОСТИ:': 'NEWS:',
  'СЛУХ': 'RUMOR',
  '◆ СЛУХ': '◆ RUMOR',
  'Слух: {text} Нажми, чтобы забрать разовую выплату': 'Rumor: {text} Click to claim one-time payout',
  'Сменить новость': 'Next headline',
  'Продолжить ленту': 'Resume ticker',
  'Остановить ленту': 'Pause ticker',
  'Кто-то слил чужой запас Токенов. Забрать можно один раз.': 'Someone leaked another stash of Tokens. You can claim it once.',
  'Отдел закупок скупил грант и забыл про тебя.': 'Procurement bought up a grant and forgot about you.',
  'Лаборатория делит прибыль. Тебя забыли в списке.': 'The lab is splitting profits. They forgot you on the roster.',
  'На бирже Токенов прыгнули. Прыгай и ты.': 'Token market jumped. Jump in too.',
  'Ретроспектива: в этом офисе нашли тайник с Токенами.': 'Retrospective: a Token cache was found in this office.',
  'Тимлид ушёл в отпуск. Кошелёк остался.': 'Tech lead went on vacation. Wallet left behind.',

  // --- PRESTIGE OVERLAY ---
  'ПРЕСТИЖ': 'PRESTIGE',
  'Поколение {num}: {name}': 'Generation {num}: {name}',
  '+{gain} Compute навсегда': '+{gain} Compute permanently',
  'нажми, чтобы продолжить': 'click to continue',

  // --- COMMON CLICK HUD ---
  'Токенов': 'Tokens',
  '+{val} / сек': '+{val} / sec',
  '/ сек': '/ sec',
  'Нанятый Агент приносит Доход сам — загляни в магазин': 'Hired Agents generate Income automatically — check the shop',
  'Отправить промпт': 'Send prompt',
  'Токен за клик': 'Token per click',
  'Токена за клик': 'Tokens per click',
  'Токенов за клик': 'Tokens per click',
  'за клик': 'per click',
  'Прогресс до следующей покупки': 'Progress to next purchase',
  'Можно нанять Агента — загляни в магазин': 'Agent ready for hire — check the shop',
  'До следующей покупки: не хватает': 'Until next purchase: need',
  'Диалог с моделью:': 'Chat with model:',

  // --- THERMAL DIAL & SECTION ---
  'Температура': 'Temperature',
  'Перегрев: Доход падает': 'Overheat: Income dropping',
  'Почти перегрев': 'Near overheat',
  'Копится перегрев': 'Overheat building up',
  'Стабильно': 'Stable',
  'Температура генерации': 'Generation temperature',
  '{temp} из {max}, Доход ×{mult}, {status}': '{temp} of {max}, Income ×{mult}, {status}',
  'перегруз': 'overload',
  'Перегрев': 'Overheat',
  'Доход ×': 'Income ×',
  'перегрев {pct}%': 'overheat {pct}%',
  'галлюцинации {rate}/мин': 'hallucinations {rate}/min',
  'риска нет': 'no risk',
  'Тяни мышью или жми ← → с Ctrl. Чем горячее — тем выше Доход, но копится перегрев.':
    'Drag with mouse or press ← → with Ctrl. The hotter it is, the higher the Income, but overheat builds up.',
  ' Сейчас оглушение: жар сброшен, Доход вернётся.':
    ' Currently stunned: heat reset, Income will recover.',
  'Сейчас:': 'Current:',
  'зона перегруза начинается с {share}% шкалы': 'overload zone starts at {share}% of dial',
  'перегрев': 'overheat',
};
