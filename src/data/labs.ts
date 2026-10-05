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
  /**
   * Фирменный цвет Лаборатории, приподнятый до читаемости на тёмной базе.
   *
   * Подпись Лаборатории печатается этим цветом прямо на карточке Модели, то есть текстом
   * меньше 18 px, а порог для такого текста один и тот же — 4.5:1, отдельного послабления
   * на «фирменный» нет. Фирменные образцы xAI, DeepSeek и Alibaba его не держали (3.18, 3.39
   * и 4.17 на `--bg-card`), поэтому подняты на 20%, 20% и 7% светлоты: до 4.6–4.7:1 и без
   * потери узнаваемости. Остальные пять из восьми проходят без правки.
   */
  color: string;
  mascot: string;
}

export const LABS: Record<LabId, Lab> = {
  openai: { id: 'openai', name: 'OpenAI', color: '#3ad29f', mascot: 'Облачко' },
  anthropic: { id: 'anthropic', name: 'Anthropic', color: '#ff8a4c', mascot: 'Краб' },
  google: { id: 'google', name: 'Google', color: '#4c8dff', mascot: 'Четырёхцвет' },
  xai: { id: 'xai', name: 'xAI', color: '#8a9099', mascot: 'Сфера' },
  deepseek: { id: 'deepseek', name: 'DeepSeek', color: '#6589ff', mascot: 'Китик' },
  meta: { id: 'meta', name: 'Meta', color: '#38b6ff', mascot: 'Плюш' },
  mistral: { id: 'mistral', name: 'Mistral', color: '#ffb02e', mascot: 'Ветерок' },
  alibaba: { id: 'alibaba', name: 'Alibaba', color: '#a771ff', mascot: 'Капибара' },
};

export const LAB_IDS = Object.keys(LABS) as LabId[];
