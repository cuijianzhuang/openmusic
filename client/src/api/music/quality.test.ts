import test from 'node:test';
import assert from 'node:assert/strict';
import { useSiteFeaturesStore } from '../../stores/siteFeaturesStore';

test('汽水 SVIP 音质开关关闭时隐藏全景声和录音室', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
  const { getQualityOptionsForSource } = await import('./quality');
  useSiteFeaturesStore.setState({ svipQualityEnabled: { netease: false, tencent: false, kugou: false, qishui: false }, qishuiSvip: true });
  assert.deepEqual(getQualityOptionsForSource('qishui').map((option) => option.value), ['standard', 'exhigh']);
});
