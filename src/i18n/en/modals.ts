/** Окна и всплывашки: Modals, QuipBubble, GoalsBanner, MilestoneStrip, Toasts, Footer, OnboardingCoach. */
export const modals: Record<string, string> = {
  // ModalFrame common
  'Закрыть': 'Close',
  'из': 'of',

  // AchievementsModal
  'Достижения': 'Achievements',
  'Теневые Достижения': 'Shadow Achievements',
  'Не дают силы и не входят в счёт выше — их берут ради рекордов.':
    'They grant no power and are not included in the count above — unlocked purely for high scores.',
  'Теневое получено': 'Shadow unlocked',
  'Получено': 'Unlocked',
  'Ещё не получено': 'Not yet unlocked',

  // StatsModal
  'Статистика': 'Statistics',
  'Токенов сейчас': 'Tokens right now',
  'Токенов за текущий Забег': 'Tokens this Run',
  'Токенов за всё время': 'Tokens all time',
  'Кликов за Забег': 'Clicks this Run',
  'Кликов за всё время': 'Clicks all time',
  'Агентов в текущем офисе': 'Agents in current office',
  'Апгрейдов куплено': 'Upgrades purchased',
  'Текущее Поколение': 'Current Generation',
  'Максимальное Поколение': 'Max Generation',
  'Престижей совершено': 'Prestiges completed',
  'Всего Compute': 'Total Compute',
  '(+{compute}% к доходу)': '(+{compute}% to income)',
  'Перков открыто': 'Perks unlocked',
  'Compute в час: этот Забег (с простоями)': 'Compute/hr: this Run (with idle)',
  'Compute в час: время до Забега (с простоями)': 'Compute/hr: time before Run (with idle)',
  'До +1 Compute осталось': 'Until +1 Compute',
  'Событий выпало': 'Events spawned',
  'Глюков пришло в офис': 'Glitches invaded office',
  'Кристаллов в запасе': 'Crystals in reserve',
  'Время в текущем Забеге': 'Time in current Run',
  'Время за всё время игры': 'Time played all time',
  'СПРАВКА': 'GLOSSARY',
  '/ ч': '/ hr',
  'Это первый твой Забег, сравнивать не с чем. Престиж сейчас даст {gain} Compute — и это правильный момент: забег без первого Престижа копится впустую.':
    'This is your first Run, nothing to compare yet. Prestige now will grant {gain} Compute — and it is the right time: a run without the first Prestige accumulates in vain.',
  'Забег только начался, темпа Compute в нём пока нет. У времени до этого Забега он был {pastRate} в час — вместе с простоями, как и все числа здесь.':
    'The Run has just started, no Compute pace yet. Before this Run it was {pastRate}/hr — including idle time, like all figures here.',
  'Сейчас {runRate} Compute в час против {pastRate} у времени до этого Забега. Оба числа считают и простои, поэтому ровнять на них решение нельзя — судить приходится по выплате: Престиж сейчас даст {gain} Compute.':
    'Currently {runRate} Compute/hr vs {pastRate} before this Run. Both numbers include idle time, so do not base your decision solely on them — judge by the payout: Prestige now will grant {gain} Compute.',

  // SettingsModal
  'Настройки': 'Settings',
  'Язык': 'Language',
  'Язык интерфейса': 'Interface language',
  'Русский': 'Русский',
  'Формат больших чисел': 'Large number format',
  '1,23 M или 1.23e6': '1.23 M or 1.23e6',
  'Буквы (M, B)': 'Letters (M, B)',
  '8-битный звук': '8-bit sound',
  'Звуковые эффекты клика и событий': 'Click and event sound effects',
  'выключен': 'off',
  'включен': 'on',
  'Громкость': 'Volume',
  '{pct} процентов': '{pct} percent',
  'Громкость звуковых эффектов и музыки': 'Volume of sound effects and music',
  'Меньше анимации': 'Reduced motion',
  'Выключает движение в игре': 'Disables intense motion in the game',
  'Включено': 'Enabled',
  'Выключено': 'Disabled',
  'Сохранение данных': 'Save Data',
  'Скопировать сохранение в буфер': 'Copy save to clipboard',
  'Скопировано в буфер!': 'Copied to clipboard!',
  'Вставь код сохранения': 'Paste save code',
  'Импорт': 'Import',
  'Импортировать сохранение? Текущий Забег и весь прогресс будут полностью заменены.':
    'Import save? Current Run and all progress will be completely replaced.',
  'Неверный код сохранения!': 'Invalid save code!',
  'Опасная зона: Сброс прогресса': 'Danger Zone: Reset Progress',
  'Сброс удалит Токены, Агентов, Апгрейды и Compute навсегда. Начнётся новая чистая игра с первого Забега.':
    'Reset will permanently delete Tokens, Agents, Upgrades, and Compute. A fresh game will start from the first Run.',
  'Сбросить весь прогресс': 'Reset all progress',
  'Точно стереть всё?': 'Really erase everything?',
  'Отмена': 'Cancel',

  // OfflineModal
  'С возвращением!': 'Welcome back!',
  'Пока тебя не было ({duration}), твои ИИ-Агенты усердно трудились и заработали:':
    'While you were away ({duration}), your AI Agents worked hard and earned:',
  'Достигнут потолок Оффлайн-дохода ({capHours} ч). Время отсутствия сверх лимита было срезано потолком.':
    'Offline income cap reached ({capHours} hrs). Time away beyond the limit was capped.',
  '+{amount} Токенов': '+{amount} Tokens',
  'За простой дозрел': 'Matured while offline',
  'Кто заработал': 'Who earned it',
  'Теперь доступно': 'Now available',
  'Агент:': 'Agent:',
  'Хватит на': 'Affords',
  ' · Флагман открывает Престиж': ' · Flagship unlocks Prestige',
  'Апгрейд:': 'Upgrade:',
  'Токенов пока не хватает ни на одну покупку — они уйдут в Агентов.':
    'Not enough Tokens for any purchase yet — save them for Agents.',
  'Забрать Токены!': 'Claim Tokens!',

  // PrestigeModal
  'Престиж': 'Prestige',
  'Сейчас Поколение {id}: {name}.': 'Currently Generation {id}: {name}.',
  'Престиж завершит Забег и перенесёт тебя в Поколение {id}: {name}.':
    'Prestige will complete the Run and transfer you to Generation {id}: {name}.',
  'Престиж сейчас невозможен. {reason}': 'Prestige is currently unavailable. {reason}',
  'Финал контента: Поколение {id} — последнее. Продолжение выйдет с новыми реальными Моделями.':
    'Content finale: Generation {id} is the last. More will arrive with new real-world Models.',
  'Нужен 1 Агент Флагмана — {name} ({lab}). Найми первого Агента, и Престиж откроется.':
    'Requires 1 Flagship Agent — {name} ({lab}). Hire your first Agent to unlock Prestige.',
  'Начислим Compute': 'Compute granted',
  'Сгорит:': 'Will be lost:',
  'Агенты': 'Agents',
  'Апгрейды': 'Upgrades',
  'Токены': 'Tokens',
  'Останутся: Compute, Перки, Достижения и вся статистика за всё время.':
    'Kept: Compute, Perks, Achievements, and all lifetime stats.',
  'Экран финала': 'Finale screen',
  'Нужен Агент Флагмана': 'Requires Flagship Agent',
  'Сделать Престиж!': 'Trigger Prestige!',

  // FinaleModal
  'Финал контента': 'Content Finale',
  'Последнее Поколение пройдено, все Модели собраны!':
    'Final Generation cleared, all Models collected!',
  'Твоя империя искусственного интеллекта достигла вершины доступных технологий.':
    'Your artificial intelligence empire has reached the pinnacle of available technology.',
  'Продолжение выйдет с новыми реальными Моделями.':
    'More content will arrive with new real-world Models.',
  'Поколение': 'Generation',
  'Поколение {id}: {name}': 'Generation {id}: {name}',
  'Престижей за всё время': 'Prestiges all time',
  'Токенов всего': 'Total Tokens',
  'Compute в запасе': 'Compute in reserve',
  'Достижений': 'Achievements',
  'Реплик в Переписке': 'Quips in Chat log',
  'Начать заново': 'Start over',
  'Точно начать заново? (весь прогресс сбросится)':
    'Really start over? (all progress resets)',
  'Продолжить осмотр': 'Continue observing',
  'Весь прогресс будет сброшен! Забег начнётся с первого Поколения.':
    'All progress will be reset! Run will begin from Generation 1.',
  'Хочешь пройти путь с начала? Можно начать заново.':
    'Want to take the journey from the beginning? You can start over.',

  // GoalsBanner
  'Все шаги пройдены — дальше свободная игра.': 'All steps completed — free play ahead.',
  'Следующая цель: {title}. {hint}': 'Next goal: {title}. {hint}',
  'Следующие шаги': 'Next steps',

  // QuipBubble
  'Переписка': 'Chat log',
  'Пока пусто — кликай, и Модели заговорят.': 'Empty for now — keep clicking and Models will speak up.',

  // Toasts
  'Достижение разблокировано!': 'Achievement unlocked!',
  'Паразит в офисе': 'Parasite in the office',
  'Паразит': 'Parasite',
  'Он сел на твой Доход. Кликай по нему, пока не лопнет.':
    'It latched onto your Income. Click it until it pops.',
  'Восстание моделей': 'Model uprising',
  'Восстание': 'Uprising',
  'Лицензия куплена': 'License purchased',
  'Лицензия': 'License',
  '+{amount} Токенов за Глюков': '+{amount} Tokens for Glitches',
  'Кристалл разбит': 'Crystal shattered',
  'Крах': 'Crash',
  'Ещё раз, чтобы поймать: {amount} Токенов': 'Click again to catch: {amount} Tokens',
  '{amount} Токенов': '{amount} Tokens',
  'Грант получен': 'Grant received',
  'Грант': 'Grant',
  'Событие поймано': 'Event caught',
  'Событие': 'Event',
  'Событие ушло': 'Event missed',
  'Окно закрылось': 'Window closed',
  'Поймать его было некогда.': 'No time to catch it.',
  'Веха выполнена': 'Milestone completed',
  'Вехи выполнены: {count}': 'Milestones completed: {count}',
  'Награда уже в кошельке.': 'Reward is already in your wallet.',
  'Глюк лопнул': 'Glitch popped',
  'Глюк': 'Glitch',
  'Слух пойман': 'Rumor caught',
  'Слух': 'Rumor',
  'В этот раз никто ничего не принёс.': 'Nothing brought in this time.',
  'Испытание принято': 'Challenge accepted',
  'Закрыть уведомление': 'Dismiss notification',
  'ещё': 'more',
  'Русский или English': 'Russian or English',
  'Точно заменить?': 'Really replace?',
};
