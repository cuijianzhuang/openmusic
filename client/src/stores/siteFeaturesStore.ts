import { create } from 'zustand';

interface SiteFeaturesStore {
  /** 管理端是否开放全站共享会员入口 */
  sharedMembershipEnabled: boolean;
  /** 管理端是否开放 SVIP 音质选项 */
  svipQualityEnabled: boolean;
  /** 各平台实际可用的高级会员能力，不能用全局开关代替。 */
  neteaseSvip: boolean;
  tencentSvip: boolean;
  qishuiVip: boolean;
  qishuiSvip: boolean;
  hydrated: boolean;
  setSvipQualityEnabled: (enabled: boolean) => void;
  setPlatformCapabilities: (features: PlatformCapabilities) => void;
}

export interface PlatformCapabilities {
  sharedMembershipEnabled?: boolean;
  svipQualityEnabled?: boolean;
  neteaseSvip?: boolean;
  tencentSvip?: boolean;
  qishuiVip?: boolean;
  qishuiSvip?: boolean;
}

export const useSiteFeaturesStore = create<SiteFeaturesStore>((set) => ({
  sharedMembershipEnabled: true,
  svipQualityEnabled: false,
  neteaseSvip: false,
  tencentSvip: false,
  qishuiVip: false,
  qishuiSvip: false,
  hydrated: false,
  setSvipQualityEnabled: (svipQualityEnabled) => set({
    svipQualityEnabled: Boolean(svipQualityEnabled),
    hydrated: true,
  }),
  setPlatformCapabilities: (features) => set((state) => ({
    sharedMembershipEnabled: features.sharedMembershipEnabled === undefined
      ? state.sharedMembershipEnabled
      : Boolean(features.sharedMembershipEnabled),
    svipQualityEnabled: features.svipQualityEnabled === undefined
      ? state.svipQualityEnabled
      : Boolean(features.svipQualityEnabled),
    neteaseSvip: features.neteaseSvip === undefined ? state.neteaseSvip : Boolean(features.neteaseSvip),
    tencentSvip: features.tencentSvip === undefined ? state.tencentSvip : Boolean(features.tencentSvip),
    qishuiVip: features.qishuiVip === undefined ? state.qishuiVip : Boolean(features.qishuiVip),
    qishuiSvip: features.qishuiSvip === undefined ? state.qishuiSvip : Boolean(features.qishuiSvip),
    hydrated: true,
  })),
}));

export function applySiteFeatures(features: PlatformCapabilities | null | undefined) {
  if (!features || typeof features !== 'object') return;
  useSiteFeaturesStore.getState().setPlatformCapabilities(features);
}

export function isQishuiVipAvailable(): boolean {
  return useSiteFeaturesStore.getState().qishuiVip;
}

export function isQishuiSvipAvailable(): boolean {
  return useSiteFeaturesStore.getState().qishuiSvip;
}

export function isSvipQualityEnabled(): boolean {
  return useSiteFeaturesStore.getState().svipQualityEnabled;
}

export function isPlatformSvipQualityEnabled(source: 'netease' | 'tencent'): boolean {
  const state = useSiteFeaturesStore.getState();
  return source === 'netease' ? state.neteaseSvip : state.tencentSvip;
}
