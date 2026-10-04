import { CATALOG } from './catalog';
import type { LabId } from '../data/labs';
import type { GameState } from './state';

interface NewsItem {
  text: string;
  when?: (s: GameState) => boolean;
}

const hasLab = (lab: LabId) => (s: GameState) =>
  CATALOG[s.generation].models.some((m) => m.lab === lab && (s.agents[m.id] ?? 0) > 0);
const gen = (min: number) => (s: GameState) => s.generation >= min;

const NEWS: NewsItem[] = [
  { text: 'Стартап в гараже обещает AGI «к четвергу».' },
  { text: 'Исследователи: 90% промптов начинаются со слова «пожалуйста».' },
  { text: 'Аналитики: токены — новая нефть. Нефть: «Ну спасибо».' },
  { text: 'Пользователь попросил «сделать красиво». Модель ушла думать.' },
  { text: 'Опрос: 7 из 10 разработчиков разговаривают с ИИ вежливее, чем с коллегами.' },
  { text: 'В офисе закончились видеокарты. Агенты греются у серверов.' },
  { text: 'Grok снова что-то написал в соцсетях. Пресс-служба в отпуске.', when: hasLab('xai') },
  { text: 'Claude вежливо отказался отвечать, а потом всё-таки помог.', when: hasLab('anthropic') },
  { text: 'Агенты Anthropic собрались обсудить конституцию. Опять.', when: hasLab('anthropic') },
  { text: 'OpenAI анонсировала анонс будущего анонса.', when: hasLab('openai') },
  { text: 'Gemini открыл 47 вкладок поиска одновременно.', when: hasLab('google') },
  { text: 'Кит DeepSeek обучился за Токены. Инвесторы нервно пересчитывают бюджеты.', when: hasLab('deepseek') },
  { text: 'Лама Meta выложила веса в открытый доступ и гордо жуёт сено.', when: hasLab('meta') },
  { text: 'Mistral: «Мы европейцы, у нас обед по расписанию».', when: hasLab('mistral') },
  { text: 'Капибара Qwen невозмутимо выдала ещё одну open-weights модель.', when: hasLab('alibaba') },
  { text: 'Модели научились думать перед ответом. Пользователи — пока нет.', when: gen(4) },
  { text: 'Агенты сами пишут код, сами ревьюят и сами себя хвалят.', when: gen(5) },
  { text: 'Метрика насытилась. Срочно нужна новая метрика для метрик.', when: gen(6) },
  { text: 'Ты на передовой ИИ. Даже Artificial Analysis ещё не успел всё замерить.', when: gen(CATALOG.length - 1) },
  { text: 'Ваши Агенты требуют отпуск. Им отказано: они работают оффлайн.', when: (s) => s.prestiges > 0 },
];

export function pickNews(s: GameState, rnd = Math.random): string {
  const pool = NEWS.filter((n) => !n.when || n.when(s));
  return pool[Math.floor(rnd() * pool.length)].text;
}
