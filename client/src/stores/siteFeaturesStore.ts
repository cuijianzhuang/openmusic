import { create } from 'zustand';

interface SiteFeaturesStore {
  /** 管理端是否开放 SVIP 音质选项 */
  svipQualityEnabled: boolean;
  hydrated: boolean;
  setSvipQualityEnabled: (enabled: boolean) => void;
}

export const useSiteFeaturesStore = create<SiteFeaturesStore>((set) => ({
  svipQualityEnabled: false,
  hydrated: false,
  setSvipQualityEnabled: (svipQualityEnabled) => set({
    svipQualityEnabled: Boolean(svipQualityEnabled),
    hydrated: true,
  }),
}));

export function applySiteFeatures(features: { svipQualityEnabled?: boolean } | null | undefined) {
  if (!features || typeof features !== 'object') return;
  useSiteFeaturesStore.getState().setSvipQualityEnabled(Boolean(features.svipQualityEnabled));
}

export function isSvipQualityEnabled(): boolean {
  return useSiteFeaturesStore.getState().svipQualityEnabled;
}
