import type { LabId } from './labs';

/**
 * Ручная нарезка Моделей по Поколениям (ADR-0001).
 * iq / speed / price — резервные значения Справки AA (Intelligence Index, t/s, $ за 1M blended 3:1).
 * Если для `aa`-слага есть запись в aa-snapshot.json, она имеет приоритет, кроме полей из `pin`.
 *
 * iq задан в ТОЙ ЖЕ шкале, что Intelligence Index в AA, и для 73 моделей из 75 равен реальному
 * замеру. Сид — это fallback, а не параллельная выдуманная шкала: смешивать две шкалы в одной
 * сортировке Ранга нельзя, иначе выдуманное число побеждает реальное.
 *
 * Две модели AA не измеряет вообще — Claude 1.3 и Grok-1.5. Их iq оценён по соседям AA
 * (Claude 2 = 5.5; grok-1 = 6.3, grok-2 = 7.1). Это единственные числа в игре не из AA.
 *
 * `pin` на Поколении 1: индекс AA сжимает модели 2023 года, и на реальных данных Флагманом
 * первого Поколения стал бы Llama 2 7B (5.7 против 5.5 у GPT-3.5 Turbo). Флагман открывает
 * Престиж, поэтому iq Поколения 1 закреплён, а GPT-3.5 Turbo поднят до 5.9, чтобы им и остаться.
 *
 * speed и price у большинства Моделей остаются резервными: AA меряет скорость только для части
 * каталога и отдаёт 0 вместо отсутствующего замера, а ноль в снимке ломает softMod.
 * Обновить реальные значения: `npm run sync:aa` с AA_API_KEY.
 */
export interface ModelSeed {
  id: string;
  name: string;
  lab: LabId;
  aa: string;
  iq: number;
  speed: number;
  price: number;
  pin?: Array<'iq' | 'speed' | 'price'>;
}

export interface GenerationSeed {
  id: number;
  name: string;
  period: string;
  /** Только акцент: база интерфейса общая для всех Поколений (ADR-0002). */
  theme: { accent: string };
  models: ModelSeed[];
}

type Row = [
  id: string,
  name: string,
  lab: LabId,
  iq: number,
  speed: number,
  price: number,
  pin?: Array<'iq' | 'speed' | 'price'>,
];

const m = (rows: Row[]): ModelSeed[] =>
  rows.map(([id, name, lab, iq, speed, price, pin]) => ({ id, name, lab, aa: id, iq, speed, price, pin }));

export const GENERATIONS: GenerationSeed[] = [
  {
    id: 1,
    name: 'Рассвет',
    period: '2023 H1',
    theme: { accent: '#ff7a2f' },
    models: m([
      ['llama-2-chat-7b', 'Llama 2 7B', 'meta', 5.7, 95, 0.1, ['iq']],
      ['mistral-7b-instruct', 'Mistral 7B', 'mistral', 5, 110, 0.162, ['iq']],
      ['llama-2-chat-13b', 'Llama 2 13B', 'meta', 5.3, 80, 0.25, ['iq']],
      ['palm-2', 'PaLM 2', 'google', 5.4, 70, 0.5, ['iq']],
      ['claude-instant', 'Claude Instant', 'anthropic', 5, 75, 1.2, ['iq']],
      ['llama-2-chat-70b', 'Llama 2 70B', 'meta', 5.3, 40, 0.9, ['iq']],
      ['claude-1', 'Claude 1.3', 'anthropic', 4.8, 30, 12, ['iq']],
      ['gpt-35-turbo', 'GPT-3.5 Turbo', 'openai', 5.9, 90, 0.75, ['iq']]
    ]),
  },
  {
    id: 2,
    name: 'Эра GPT-4',
    period: '2023 H2',
    theme: { accent: '#35a7ff' },
    models: m([
      ['deepseek-llm-67b-chat', 'DeepSeek LLM 67B', 'deepseek', 5.3, 30, 0.8],
      ['qwen-chat-72b', 'Qwen 72B', 'alibaba', 5.4, 35, 0.9],
      ['grok-1', 'Grok-1', 'xai', 6.3, 40, 2],
      ['mixtral-8x7b-instruct', 'Mixtral 8x7B', 'mistral', 5.1, 90, 0.512],
      ['gemini-1-0-pro', 'Gemini 1.0 Pro', 'google', 5.3, 85, 0.75],
      ['claude-2', 'Claude 2.0', 'anthropic', 5.5, 30, 12],
      ['claude-21', 'Claude 2.1', 'anthropic', 5.6, 28, 12],
      ['gpt-4', 'GPT-4', 'openai', 6.7, 25, 37.5],
      ['gpt-4-turbo', 'GPT-4 Turbo', 'openai', 7, 35, 15]
    ]),
  },
  {
    id: 3,
    name: 'Мультимодальная',
    period: '2024 H1',
    theme: { accent: '#a174ff' },
    models: m([
      ['llama-3-instruct-8b', 'Llama 3 8B', 'meta', 4.8, 150, 0.07],
      ['claude-3-haiku', 'Claude 3 Haiku', 'anthropic', 5.6, 130, 0.5],
      ['mistral-large', 'Mistral Large', 'mistral', 5.8, 35, 6],
      ['grok-1-5', 'Grok-1.5', 'xai', 6.7, 40, 4],
      ['deepseek-v2', 'DeepSeek V2', 'deepseek', 5.5, 20, 0.2],
      ['gemini-1-5-flash-may-2024', 'Gemini 1.5 Flash', 'google', 5.9, 160, 0.13],
      ['qwen2-72b-instruct', 'Qwen2 72B', 'alibaba', 6.3, 40, 0.6],
      ['llama-3-instruct-70b', 'Llama 3 70B', 'meta', 5.5, 50, 1.175],
      ['claude-3-sonnet', 'Claude 3 Sonnet', 'anthropic', 5.9, 60, 6],
      ['gemini-1-5-pro-may-2024', 'Gemini 1.5 Pro', 'google', 6.4, 60, 2.2],
      ['claude-3-opus', 'Claude 3 Opus', 'anthropic', 8.7, 25, 30],
      ['gpt-4o-2024-05-13', 'GPT-4o', 'openai', 7.3, 100, 7.5]
    ]),
  },
  {
    id: 4,
    name: 'Omni',
    period: '2024 H2',
    theme: { accent: '#1fc9c0' },
    models: m([
      ['gpt-4o-mini', 'GPT-4o mini', 'openai', 6.7, 115, 0.262],
      ['claude-3-5-haiku', 'Claude 3.5 Haiku', 'anthropic', 8.9, 65, 1.6],
      ['mistral-large-2', 'Mistral Large 2', 'mistral', 7.6, 45, 3],
      ['grok-2-1212', 'Grok 2', 'xai', 7.1, 70, 4],
      ['llama-3-1-instruct-405b', 'Llama 3.1 405B', 'meta', 7.3, 30, 3.5],
      ['qwen2-5-72b-instruct', 'Qwen2.5 72B', 'alibaba', 7.7, 50, 0.48],
      ['deepseek-v2-5', 'DeepSeek V2.5', 'deepseek', 6.6, 25, 0.2],
      ['gemini-1-5-pro', 'Gemini 1.5 Pro 002', 'google', 7.9, 70, 2.2],
      ['claude-35-sonnet', 'Claude 3.5 Sonnet', 'anthropic', 7.9, 70, 6],
      ['o1-preview', 'o1-preview', 'openai', 11.4, 40, 28.875]
    ]),
  },
  {
    id: 5,
    name: 'Reasoning',
    period: 'конец 2024 – начало 2025',
    theme: { accent: '#ff4f8b' },
    models: m([
      ['llama-3-3-instruct-70b', 'Llama 3.3 70B', 'meta', 7.7, 85.248, 0.712],
      ['mistral-small-3', 'Mistral Small 3', 'mistral', 6.7, 130, 0.058],
      ['gemini-2-0-flash', 'Gemini 2.0 Flash', 'google', 8.9, 200, 0.18],
      ['qwen-2-5-max', 'Qwen2.5 Max', 'alibaba', 8, 40, 2.8],
      ['gpt-4-5', 'GPT-4.5', 'openai', 9.6, 20, 94],
      ['deepseek-v3', 'DeepSeek V3', 'deepseek', 8.5, 30, 0.463],
      ['grok-3', 'Grok 3', 'xai', 12.1, 60, 8],
      ['claude-3-7-sonnet-thinking', 'Claude 3.7 Sonnet', 'anthropic', 17.7, 75, 6],
      ['deepseek-r1', 'DeepSeek R1', 'deepseek', 13.1, 25, 1.763],
      ['o1', 'o1', 'openai', 15.2, 70, 26.25],
      ['o3-mini-high', 'o3-mini', 'openai', 11, 150, 1.925]
    ]),
  },
  {
    id: 6,
    name: 'Агентная',
    period: '2025 H1',
    theme: { accent: '#b6e024' },
    models: m([
      ['llama-4-maverick', 'Llama 4 Maverick', 'meta', 10, 72.373, 0.422],
      ['mistral-medium-3', 'Mistral Medium 3', 'mistral', 9, 80, 0.8],
      ['gemini-2-5-flash', 'Gemini 2.5 Flash', 'google', 9.9, 250, 0.85],
      ['qwen3-235b-a22b-instruct-reasoning', 'Qwen3 235B', 'alibaba', 9.5, 60, 2.625],
      ['claude-4-sonnet-thinking', 'Claude 4 Sonnet', 'anthropic', 18.9, 70, 6],
      ['claude-4-opus-thinking', 'Claude 4 Opus', 'anthropic', 20.6, 40, 30],
      ['deepseek-r1', 'DeepSeek R1 0528', 'deepseek', 13.1, 30, 1.763],
      ['o4-mini', 'o4-mini', 'openai', 16.7, 130, 1.925],
      ['gemini-2-5-pro', 'Gemini 2.5 Pro', 'google', 16.1, 150, 3.438],
      ['o3', 'o3', 'openai', 20.2, 129.186, 3.5],
      ['grok-4', 'Grok 4', 'xai', 22.5, 45, 6]
    ]),
  },
  {
    id: 7,
    name: 'GPT-5',
    period: '2025 H2',
    theme: { accent: '#7483ff' },
    models: m([
      ['gpt-oss-120b', 'gpt-oss-120B', 'openai', 11.6, 188.544, 0.261],
      ['mistral-medium-3-1', 'Mistral Medium 3.1', 'mistral', 9.2, 90, 0.8],
      ['claude-4-5-haiku-reasoning', 'Claude Haiku 4.5', 'anthropic', 16.9, 109.741, 2],
      ['deepseek-v3-1-reasoning', 'DeepSeek V3.1', 'deepseek', 13.5, 35, 0.855],
      ['qwen3-max', 'Qwen3 Max', 'alibaba', 15.6, 35, 2.4],
      ['grok-4-fast-reasoning', 'Grok 4 Fast', 'xai', 17.9, 200, 0.275],
      ['claude-4-1-opus-thinking', 'Claude Opus 4.1', 'anthropic', 22.8, 40, 30],
      ['claude-4-5-sonnet-thinking', 'Claude Sonnet 4.5', 'anthropic', 20.7, 70, 6],
      ['gpt-5', 'GPT-5', 'openai', 23, 120, 3.438]
    ]),
  },
  {
    id: 8,
    name: 'Фронтир',
    period: 'конец 2025',
    theme: { accent: '#e05cff' },
    models: m([
      ['deepseek-v3-2-reasoning', 'DeepSeek V3.2', 'deepseek', 21.5, 35, 0.315],
      ['grok-4-1-fast-reasoning', 'Grok 4.1 Fast', 'xai', 20.4, 180, 0.3],
      ['gpt-5-1', 'GPT-5.1', 'openai', 24.7, 110, 3.438],
      ['claude-opus-4-5-thinking', 'Claude Opus 4.5', 'anthropic', 29.1, 60, 10],
      ['gemini-3-pro', 'Gemini 3 Pro', 'google', 28, 120, 4.5]
    ]),
  },
];
