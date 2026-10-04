import type { LabId } from './labs';

/**
 * Ручная нарезка Моделей по Поколениям (ADR-0001).
 * iq / speed / price — резервные значения Справки AA (Intelligence Index, t/s, $ за 1M blended 3:1).
 * Если для `aa`-слага есть запись в aa-snapshot.json, она имеет приоритет, кроме полей из `pin`.
 * Приблизительные значения: запусти `npm run sync:aa` с AA_API_KEY, чтобы подтянуть реальные.
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

type Row = [id: string, name: string, lab: LabId, iq: number, speed: number, price: number];

const m = (rows: Row[]): ModelSeed[] =>
  rows.map(([id, name, lab, iq, speed, price]) => ({ id, name, lab, aa: id, iq, speed, price }));

export const GENERATIONS: GenerationSeed[] = [
  {
    id: 1,
    name: 'Рассвет',
    period: '2023 H1',
    theme: { accent: '#ff7a2f' },
    models: m([
      ['llama-2-chat-7b', 'Llama 2 7B', 'meta', 3, 95, 0.1],
      ['mistral-7b-instruct', 'Mistral 7B', 'mistral', 5, 110, 0.15],
      ['llama-2-chat-13b', 'Llama 2 13B', 'meta', 6, 80, 0.25],
      ['palm-2', 'PaLM 2', 'google', 8, 70, 0.5],
      ['claude-instant', 'Claude Instant', 'anthropic', 9, 75, 1.2],
      ['llama-2-chat-70b', 'Llama 2 70B', 'meta', 10, 40, 0.9],
      ['claude-1', 'Claude 1.3', 'anthropic', 11, 30, 12],
      ['gpt-35-turbo', 'GPT-3.5 Turbo', 'openai', 12, 90, 0.75],
    ]),
  },
  {
    id: 2,
    name: 'Эра GPT-4',
    period: '2023 H2',
    theme: { accent: '#35a7ff' },
    models: m([
      ['deepseek-llm-67b-chat', 'DeepSeek LLM 67B', 'deepseek', 9, 30, 0.8],
      ['qwen-72b-chat', 'Qwen 72B', 'alibaba', 10, 35, 0.9],
      ['grok-1', 'Grok-1', 'xai', 11, 40, 2],
      ['mixtral-8x7b-instruct', 'Mixtral 8x7B', 'mistral', 12, 90, 0.5],
      ['gemini-1-0-pro', 'Gemini 1.0 Pro', 'google', 13, 85, 0.75],
      ['claude-2', 'Claude 2.0', 'anthropic', 14, 30, 12],
      ['claude-21', 'Claude 2.1', 'anthropic', 15, 28, 12],
      ['gpt-4', 'GPT-4', 'openai', 18, 25, 37.5],
      ['gpt-4-turbo', 'GPT-4 Turbo', 'openai', 20, 35, 15],
    ]),
  },
  {
    id: 3,
    name: 'Мультимодальная',
    period: '2024 H1',
    theme: { accent: '#a174ff' },
    models: m([
      ['llama-3-instruct-8b', 'Llama 3 8B', 'meta', 12, 150, 0.1],
      ['claude-3-haiku', 'Claude 3 Haiku', 'anthropic', 14, 130, 0.5],
      ['mistral-large', 'Mistral Large', 'mistral', 17, 35, 6],
      ['grok-1-5', 'Grok-1.5', 'xai', 18, 40, 4],
      ['deepseek-v2', 'DeepSeek V2', 'deepseek', 19, 20, 0.2],
      ['gemini-1-5-flash-may-2024', 'Gemini 1.5 Flash', 'google', 20, 160, 0.13],
      ['qwen2-72b-instruct', 'Qwen2 72B', 'alibaba', 21, 40, 0.6],
      ['llama-3-instruct-70b', 'Llama 3 70B', 'meta', 22, 50, 0.9],
      ['claude-3-sonnet', 'Claude 3 Sonnet', 'anthropic', 23, 60, 6],
      ['gemini-1-5-pro-may-2024', 'Gemini 1.5 Pro', 'google', 25, 60, 2.2],
      ['claude-3-opus', 'Claude 3 Opus', 'anthropic', 26, 25, 30],
      ['gpt-4o-2024-05-13', 'GPT-4o', 'openai', 29, 100, 7.5],
    ]),
  },
  {
    id: 4,
    name: 'Omni',
    period: '2024 H2',
    theme: { accent: '#1fc9c0' },
    models: m([
      ['gpt-4o-mini', 'GPT-4o mini', 'openai', 24, 115, 0.26],
      ['claude-3-5-haiku', 'Claude 3.5 Haiku', 'anthropic', 25, 65, 1.6],
      ['mistral-large-2', 'Mistral Large 2', 'mistral', 27, 45, 3],
      ['grok-2', 'Grok 2', 'xai', 28, 70, 4],
      ['llama-3-1-instruct-405b', 'Llama 3.1 405B', 'meta', 29, 30, 3.5],
      ['qwen2-5-72b-instruct', 'Qwen2.5 72B', 'alibaba', 30, 50, 0.4],
      ['deepseek-v2-5', 'DeepSeek V2.5', 'deepseek', 30, 25, 0.2],
      ['gemini-1-5-pro', 'Gemini 1.5 Pro 002', 'google', 32, 70, 2.2],
      ['claude-35-sonnet', 'Claude 3.5 Sonnet', 'anthropic', 33, 70, 6],
      ['o1-preview', 'o1-preview', 'openai', 38, 40, 26],
    ]),
  },
  {
    id: 5,
    name: 'Reasoning',
    period: 'конец 2024 – начало 2025',
    theme: { accent: '#ff4f8b' },
    models: m([
      ['llama-3-3-instruct-70b', 'Llama 3.3 70B', 'meta', 28, 100, 0.6],
      ['mistral-small-3', 'Mistral Small 3', 'mistral', 29, 130, 0.15],
      ['gemini-2-0-flash', 'Gemini 2.0 Flash', 'google', 35, 200, 0.18],
      ['qwen-2-5-max', 'Qwen2.5 Max', 'alibaba', 36, 40, 2.8],
      ['gpt-4-5', 'GPT-4.5', 'openai', 38, 20, 94],
      ['deepseek-v3', 'DeepSeek V3', 'deepseek', 39, 30, 0.5],
      ['grok-3', 'Grok 3', 'xai', 40, 60, 6],
      ['claude-3-7-sonnet-thinking', 'Claude 3.7 Sonnet', 'anthropic', 42, 75, 6],
      ['deepseek-r1', 'DeepSeek R1', 'deepseek', 46, 25, 1],
      ['o1', 'o1', 'openai', 47, 70, 26],
      ['o3-mini-high', 'o3-mini', 'openai', 50, 150, 1.9],
    ]),
  },
  {
    id: 6,
    name: 'Агентная',
    period: '2025 H1',
    theme: { accent: '#b6e024' },
    models: m([
      ['llama-4-maverick', 'Llama 4 Maverick', 'meta', 36, 140, 0.4],
      ['mistral-medium-3', 'Mistral Medium 3', 'mistral', 39, 80, 0.8],
      ['gemini-2-5-flash', 'Gemini 2.5 Flash', 'google', 47, 250, 0.3],
      ['qwen3-235b-a22b-instruct-reasoning', 'Qwen3 235B', 'alibaba', 47, 60, 1.2],
      ['claude-4-sonnet-thinking', 'Claude 4 Sonnet', 'anthropic', 50, 70, 6],
      ['claude-4-opus-thinking', 'Claude 4 Opus', 'anthropic', 53, 40, 30],
      ['deepseek-r1-0528', 'DeepSeek R1 0528', 'deepseek', 54, 30, 1],
      ['o4-mini', 'o4-mini', 'openai', 57, 130, 1.9],
      ['gemini-2-5-pro', 'Gemini 2.5 Pro', 'google', 59, 150, 3.4],
      ['o3', 'o3', 'openai', 61, 160, 3.5],
      ['grok-4', 'Grok 4', 'xai', 64, 45, 6],
    ]),
  },
  {
    id: 7,
    name: 'GPT-5',
    period: '2025 H2',
    theme: { accent: '#7483ff' },
    models: m([
      ['gpt-oss-120b', 'gpt-oss-120B', 'openai', 58, 300, 0.3],
      ['mistral-medium-3-1', 'Mistral Medium 3.1', 'mistral', 40, 90, 0.8],
      ['claude-4-5-haiku-reasoning', 'Claude Haiku 4.5', 'anthropic', 55, 120, 2],
      ['deepseek-v3-1-reasoning', 'DeepSeek V3.1', 'deepseek', 58, 35, 0.8],
      ['qwen3-max', 'Qwen3 Max', 'alibaba', 57, 35, 2.4],
      ['grok-4-fast-reasoning', 'Grok 4 Fast', 'xai', 60, 200, 0.3],
      ['claude-4-1-opus-thinking', 'Claude Opus 4.1', 'anthropic', 61, 40, 30],
      ['claude-4-5-sonnet-thinking', 'Claude Sonnet 4.5', 'anthropic', 63, 70, 6],
      ['gpt-5', 'GPT-5', 'openai', 68, 120, 3.4],
    ]),
  },
  {
    id: 8,
    name: 'Фронтир',
    period: 'конец 2025',
    theme: { accent: '#e05cff' },
    models: m([
      ['deepseek-v3-2-reasoning', 'DeepSeek V3.2', 'deepseek', 62, 35, 0.3],
      ['grok-4-1-fast-reasoning', 'Grok 4.1 Fast', 'xai', 63, 180, 0.3],
      ['gpt-5-1', 'GPT-5.1', 'openai', 69, 110, 3.4],
      ['claude-opus-4-5-thinking', 'Claude Opus 4.5', 'anthropic', 70, 60, 10],
      ['gemini-3-pro', 'Gemini 3 Pro', 'google', 73, 120, 4.5],
    ]),
  },
];
