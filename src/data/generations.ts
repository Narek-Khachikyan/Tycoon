import type { LabId } from './labs';

/**
 * Ручная нарезка Моделей по Поколениям (ADR-0001).
 * iq / speed / price — резервные значения Справки AA (Intelligence Index, t/s, $ за 1M blended 3:1).
 * Если для `aa`-слага есть запись в aa-snapshot.json, она имеет приоритет, кроме полей из `pin`.
 * Значения сняты с AA при последней синхронизации, а не выдуманы: снимок может устареть или
 * исчезнуть, а каталог обязан оставаться верным. Обновить — `npm run sync:aa` с AA_API_KEY.
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
      ['llama-2-chat-7b', 'Llama 2 7B', 'meta', 5.7, 0, 0.1],
      ['llama-65b', 'LLaMA 65B', 'meta', 5, 0, 0],
      ['mistral-7b-instruct', 'Mistral 7B', 'mistral', 5, 0, 0.162],
      ['llama-2-chat-13b', 'Llama 2 13B', 'meta', 5.3, 0, 0],
      ['palm-2', 'PaLM 2', 'google', 5.4, 0, 0],
      ['claude-instant', 'Claude Instant', 'anthropic', 5, 0, 0],
      ['llama-2-chat-70b', 'Llama 2 70B', 'meta', 5.3, 0, 0],
      ['gpt-35-turbo', 'GPT-3.5 Turbo', 'openai', 5.5, 0, 0.75],
    ]),
  },
  {
    id: 2,
    name: 'Эра GPT-4',
    period: '2023 H2',
    theme: { accent: '#35a7ff' },
    models: m([
      ['deepseek-llm-67b-chat', 'DeepSeek LLM 67B', 'deepseek', 5.3, 0, 0],
      ['qwen-chat-72b', 'Qwen 72B', 'alibaba', 5.4, 0, 0],
      ['mixtral-8x7b-instruct', 'Mixtral 8x7B', 'mistral', 5.1, 0, 0.512],
      ['gemini-1-0-pro', 'Gemini 1.0 Pro', 'google', 5.3, 0, 0],
      ['claude-2', 'Claude 2.0', 'anthropic', 5.5, 0, 0],
      ['claude-21', 'Claude 2.1', 'anthropic', 5.6, 0, 0],
      ['gpt-4', 'GPT-4', 'openai', 6.7, 0, 37.5],
      ['gpt-4-turbo', 'GPT-4 Turbo', 'openai', 7, 0, 15],
    ]),
  },
  {
    id: 3,
    name: 'Мультимодальная',
    period: '2024 H1',
    theme: { accent: '#a174ff' },
    models: m([
      ['llama-3-instruct-8b', 'Llama 3 8B', 'meta', 4.8, 0, 0.07],
      ['claude-3-haiku', 'Claude 3 Haiku', 'anthropic', 5.6, 0, 0.5],
      ['mistral-large', 'Mistral Large', 'mistral', 5.8, 0, 6],
      ['grok-1', 'Grok-1', 'xai', 6.3, 0, 0],
      ['deepseek-v2', 'DeepSeek V2', 'deepseek', 5.5, 0, 0],
      ['gemini-1-5-flash-may-2024', 'Gemini 1.5 Flash', 'google', 5.9, 0, 0],
      ['qwen2-72b-instruct', 'Qwen2 72B', 'alibaba', 6.3, 0, 0],
      ['llama-3-instruct-70b', 'Llama 3 70B', 'meta', 5.5, 0, 1.175],
      ['claude-3-sonnet', 'Claude 3 Sonnet', 'anthropic', 5.9, 0, 0],
      ['gemini-1-5-pro-may-2024', 'Gemini 1.5 Pro', 'google', 6.4, 0, 0],
      ['claude-3-opus', 'Claude 3 Opus', 'anthropic', 8.7, 0, 30],
      ['gpt-4o-2024-05-13', 'GPT-4o', 'openai', 7.3, 0, 7.5],
    ]),
  },
  {
    id: 4,
    name: 'Omni',
    period: '2024 H2',
    theme: { accent: '#1fc9c0' },
    models: m([
      ['gpt-4o-mini', 'GPT-4o mini', 'openai', 6.7, 0, 0.262],
      ['claude-3-5-haiku', 'Claude 3.5 Haiku', 'anthropic', 8.9, 0, 0],
      ['mistral-large-2', 'Mistral Large 2', 'mistral', 7.6, 0, 0],
      ['grok-2-1212', 'Grok 2', 'xai', 7.1, 0, 0],
      ['llama-3-1-instruct-405b', 'Llama 3.1 405B', 'meta', 7.3, 0, 0],
      ['qwen2-5-72b-instruct', 'Qwen2.5 72B', 'alibaba', 7.7, 0, 0.48],
      ['deepseek-v2-5', 'DeepSeek V2.5', 'deepseek', 6.6, 0, 0],
      ['gemini-1-5-pro', 'Gemini 1.5 Pro 002', 'google', 7.9, 0, 0],
      ['claude-35-sonnet', 'Claude 3.5 Sonnet', 'anthropic', 7.9, 0, 6],
      ['o1-preview', 'o1-preview', 'openai', 11.4, 0, 28.875],
    ]),
  },
  {
    id: 5,
    name: 'Reasoning',
    period: 'конец 2024 – начало 2025',
    theme: { accent: '#ff4f8b' },
    models: m([
      ['llama-3-3-instruct-70b', 'Llama 3.3 70B', 'meta', 7.7, 85.248, 0.712],
      ['mistral-small-3', 'Mistral Small 3', 'mistral', 6.7, 0, 0.058],
      ['gemini-2-0-flash', 'Gemini 2.0 Flash', 'google', 8.9, 0, 0],
      ['qwen-2-5-max', 'Qwen2.5 Max', 'alibaba', 8, 0, 0],
      ['gpt-4-5', 'GPT-4.5', 'openai', 9.6, 0, 0],
      ['deepseek-v3', 'DeepSeek V3', 'deepseek', 8.5, 0, 0.463],
      ['grok-3', 'Grok 3', 'xai', 12.1, 0, 8],
      ['claude-3-7-sonnet-thinking', 'Claude 3.7 Sonnet', 'anthropic', 17.7, 0, 0],
      ['deepseek-r1', 'DeepSeek R1', 'deepseek', 13.1, 0, 1.763],
      ['o1', 'o1', 'openai', 15.2, 0, 26.25],
      ['o3-mini-high', 'o3-mini', 'openai', 11, 0, 1.925],
    ]),
  },
  {
    id: 6,
    name: 'Агентная',
    period: '2025 H1',
    theme: { accent: '#b6e024' },
    models: m([
      ['llama-4-scout', 'Llama 4 Scout', 'meta', 8.1, 55.315, 0.313],
      ['mistral-small-3-2', 'Mistral Small 3.2', 'mistral', 8.2, 0, 0.106],
      ['gemini-2-5-flash', 'Gemini 2.5 Flash', 'google', 9.9, 0, 0.85],
      ['qwen3-235b-a22b-instruct', 'Qwen3 235B', 'alibaba', 8.3, 0, 1.225],
      ['deepseek-r1-qwen3-8b', 'DeepSeek R1 Distill', 'deepseek', 8.1, 0, 0],
      ['claude-4-sonnet-thinking', 'Claude 4 Sonnet', 'anthropic', 18.9, 0, 0],
      ['claude-4-opus-thinking', 'Claude 4 Opus', 'anthropic', 20.6, 0, 30],
      ['o4-mini', 'o4-mini', 'openai', 16.7, 0, 1.925],
      ['gemini-2-5-pro', 'Gemini 2.5 Pro', 'google', 16.1, 0, 3.438],
      ['o3', 'o3', 'openai', 20.2, 129.186, 3.5],
    ]),
  },
  {
    id: 7,
    name: 'GPT-5',
    period: '2025 H2',
    theme: { accent: '#7483ff' },
    models: m([
      ['mistral-large-3', 'Mistral Large 3', 'mistral', 9.3, 81.552, 0.75],
      ['gpt-oss-120b', 'gpt-oss-120B', 'openai', 11.6, 188.544, 0.261],
      ['claude-4-5-haiku-reasoning', 'Claude Haiku 4.5', 'anthropic', 16.9, 109.741, 2],
      ['deepseek-v3-2', 'DeepSeek V3.2', 'deepseek', 16, 0, 0.315],
      ['qwen3-max', 'Qwen3 Max', 'alibaba', 15.6, 0, 2.4],
      ['claude-4-5-sonnet-thinking', 'Claude Sonnet 4.5', 'anthropic', 20.7, 0, 6],
      ['gemini-3-flash', 'Gemini 3 Flash', 'google', 17.9, 0, 1.125],
      ['grok-4', 'Grok 4', 'xai', 22.5, 0, 6],
      ['gpt-5', 'GPT-5', 'openai', 23, 0, 3.438],
      ['claude-opus-4-5-thinking', 'Claude Opus 4.5', 'anthropic', 29.1, 0, 10],
      ['gpt-5-1', 'GPT-5.1', 'openai', 24.7, 0, 3.438],
      ['gemini-3-pro', 'Gemini 3 Pro', 'google', 28, 0, 4.5],
      ['gpt-5-codex', 'GPT-5 Codex', 'openai', 24.9, 0, 3.438],
      ['gpt-5-2', 'GPT-5.2', 'openai', 30.4, 0, 4.813],
    ]),
  },
  {
    id: 8,
    name: 'Фронтир',
    period: '2026',
    theme: { accent: '#e05cff' },
    models: m([
      ['mistral-small-4', 'Mistral Small 4', 'mistral', 11.3, 170.91, 0.262],
      ['gemini-3-6-flash', 'Gemini 3.6 Flash', 'google', 34, 0, 1.5],
      ['qwen3-8-27b', 'Qwen3 8 27B', 'alibaba', 33.7, 46.602, 1.125],
      ['deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 36, 110.467, 1.98],
      ['gemini-3-8-flash', 'Gemini 3.8 Flash', 'google', 40.9, 243.468, 1.5],
      ['deepseek-v4-1-flash', 'DeepSeek V4.1 Flash', 'deepseek', 39.5, 207.371, 0.525],
      ['gpt-5-6-terra', 'GPT-5.6 Terra', 'openai', 42.1, 115.386, 4.5],
      ['grok-4-6', 'Grok 4.6', 'xai', 44.3, 0, 3],
      ['qwen3-8-max', 'Qwen3 8 Max', 'alibaba', 45.4, 36.96, 3],
      ['grok-4-7', 'Grok 4.7', 'xai', 46.4, 75.979, 3],
      ['gpt-5-6-sol', 'GPT-5.6 Sol', 'openai', 47, 0, 8],
      ['gpt-6-sol', 'GPT-6 Sol', 'openai', 47.6, 91.319, 4],
      ['claude-opus-5', 'Claude Opus 5', 'anthropic', 50.8, 0, 10],
      ['gpt-6-1-sol', 'GPT-6.1 Sol', 'openai', 51.8, 58.225, 4],
      ['gemini-4-argon', 'Gemini 4 Argon', 'google', 52.6, 0, 4],
      ['gpt-6-astra', 'GPT-6 Astra', 'openai', 52.7, 65.114, 20],
      ['claude-fable-5-1', 'Claude Fable 5.1', 'anthropic', 53.4, 68.822, 20],
      ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'anthropic', 56, 138.411, 4],
      ['claude-opus-5-5', 'Claude Opus 5.5', 'anthropic', 57.6, 96.725, 8],
    ]),
  },
];
