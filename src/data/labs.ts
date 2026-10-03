export type LabId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'meta'
  | 'mistral'
  | 'alibaba';

export interface Lab {
  id: LabId;
  name: string;
  color: string;
  mascot: string;
}

export const LABS: Record<LabId, Lab> = {
  openai: { id: 'openai', name: 'OpenAI', color: '#3ad29f', mascot: 'Узелок' },
  anthropic: { id: 'anthropic', name: 'Anthropic', color: '#ff8a4c', mascot: 'Искорка' },
  google: { id: 'google', name: 'Google', color: '#4c8dff', mascot: 'Четырёхцвет' },
  xai: { id: 'xai', name: 'xAI', color: '#2b2b3a', mascot: 'Кубик' },
  deepseek: { id: 'deepseek', name: 'DeepSeek', color: '#3f6bff', mascot: 'Китик' },
  meta: { id: 'meta', name: 'Meta', color: '#38b6ff', mascot: 'Лама' },
  mistral: { id: 'mistral', name: 'Mistral', color: '#ffb02e', mascot: 'Ветерок' },
  alibaba: { id: 'alibaba', name: 'Alibaba', color: '#a066ff', mascot: 'Капибара' },
};

export const LAB_IDS = Object.keys(LABS) as LabId[];
