import { useGameStore } from '../store/useGameStore';
import { t } from './index';
import type { Message, Params } from './types';

export function useT() {
  const lang = useGameStore((s) => s.state.settings.lang);
  return (message: Message, params?: Params) => t(lang, message, params);
}
