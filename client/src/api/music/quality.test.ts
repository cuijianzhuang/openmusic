import test from 'node:test';
import assert from 'node:assert/strict';
import { useSiteFeaturesStore } from '../../stores/siteFeaturesStore';

test('酷狗支持 Meting 的全部高级音质并按 SVIP 开关过滤', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
  const { getQualityOptionsForSource } = await import('./quality');
  useSiteFeaturesStore.setState({ svipQualityEnabled: { netease: false, tencent: false, kugou: false, qishui: false }, qishuiSvip: true });
  assert.deepEqual(getQualityOptionsForSource('qishui').map((option) => option.value), ['standard', 'exhigh']);
  assert.deepEqual(getQualityOptionsForSource('kugou').map((option) => option.value), ['standard', 'exhigh', 'lossless', 'hires']);
  useSiteFeaturesStore.setState({ svipQualityEnabled: { netease: false, tencent: false, kugou: true, qishui: false } });
  assert.deepEqual(getQualityOptionsForSource('kugou').map((option) => option.value), [
    'standard', 'exhigh', 'lossless', 'hires', 'atmos', 'master',
    'viper_atmos', 'viper_tape', 'viper_clear', 'viper_hifi', 'acappella', 'multitrack',
  ]);
});

test('酷狗音质别名可归一化并显示平台名称', async () => {
  const { normalizeRoomAudioQuality, getQualityLabel } = await import('./quality');
  const quality = normalizeRoomAudioQuality({ kugou: 'viper_tape' });
  assert.equal(quality.kugou, 'viper_tape');
  assert.equal(getQualityLabel('viper_hifi', 'kugou'), '蝰蛇 HiFi 音质');
  assert.equal(getQualityLabel('acappella', 'kugou'), '人声伴奏');
});
