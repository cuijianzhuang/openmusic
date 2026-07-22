/** 歌名旁实际音质标：网易红 / QQ 绿 / 酷狗蓝，简洁短标 */

import type { MusicSource } from '../types';

interface Props {
  label?: string | null;
  source?: MusicSource | null;
  className?: string;
}

type QualityTier = 'standard' | 'high' | 'lossless' | 'hires' | 'vip';

function resolveTier(label: string): QualityTier {
  const t = label.toLowerCase();
  if (/母带|master|jymaster|杜比|dolby|全景|环绕|atmos|sky|空间|臻音|jyeffect/.test(t)) {
    return 'vip';
  }
  if (/高解析|hi-?res|hires/.test(t)) return 'hires';
  if (/无损|lossless|flac|sq/.test(t)) return 'lossless';
  if (/极高|较高|高品|hq|exhigh|higher|320/.test(t)) return 'high';
  return 'standard';
}

function shortenLabel(label: string): string {
  const map: Record<string, string> = {
    标准: '标准',
    标准品质: '标准',
    较高: '较高',
    极高: '极高',
    HQ高品质: 'HQ',
    无损: 'SQ',
    SQ无损品质: 'SQ',
    高解析度无损: 'Hi-Res',
    高清臻音: '臻音',
    沉浸环绕声: '环绕声',
    超清母带: '母带',
    杜比全景声: '杜比全景声',
    臻品全景声: '全景声',
    臻品母带: '母带',
  };
  return map[label] || label;
}

const NETEASE_TIER_CLASS: Record<QualityTier, string> = {
  standard: 'border-white/25 text-white/55',
  high: 'border-white/40 text-white/80',
  lossless: 'border-white/55 text-white/90',
  hires: 'border-white/70 text-white',
  vip: 'border-[#ec4141]/80 text-[#ec4141]',
};

const TENCENT_TIER_CLASS: Record<QualityTier, string> = {
  standard: 'border-[#31c27c]/35 text-[#31c27c]/70',
  high: 'border-[#31c27c]/50 text-[#31c27c]/85',
  lossless: 'border-[#31c27c]/70 text-[#31c27c]',
  hires: 'border-[#31c27c]/85 text-[#31c27c]',
  vip: 'border-[#31c27c] text-[#31c27c]',
};

/** 酷狗：统一蓝边；无音质返回时按标准档展示 */
const KUGOU_TIER_CLASS: Record<QualityTier, string> = {
  standard: 'border-[#2688ee]/45 text-[#2688ee]/80',
  high: 'border-[#2688ee]/60 text-[#2688ee]/90',
  lossless: 'border-[#2688ee]/75 text-[#2688ee]',
  hires: 'border-[#2688ee]/85 text-[#2688ee]',
  vip: 'border-[#2688ee] text-[#2688ee]',
};

function tierClassForSource(source: MusicSource | null | undefined, tier: QualityTier): string {
  if (source === 'tencent') return TENCENT_TIER_CLASS[tier];
  if (source === 'kugou') return KUGOU_TIER_CLASS[tier];
  return NETEASE_TIER_CLASS[tier];
}

export default function PlaybackQualityTag({ label, source, className = '' }: Props) {
  // 酷狗上游不回传音质，默认按「标准」展示
  const raw = label?.trim() || (source === 'kugou' ? '标准' : '');
  if (!raw) return null;

  const short = shortenLabel(raw);
  const tier = source === 'kugou' && !label?.trim() ? 'standard' : resolveTier(raw);
  const tierClass = tierClassForSource(source, tier);

  return (
    <span
      className={
        `inline-flex flex-shrink-0 items-center rounded-[2px] border px-[3px] py-px ` +
        `text-[9px] font-medium leading-[1.2] tracking-wide ` +
        `${tierClass} ${className}`
      }
      title={`实际音质：${raw}`}
    >
      {short}
    </span>
  );
}
