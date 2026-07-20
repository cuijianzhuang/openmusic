import type { CSSProperties } from 'react';

export interface BadgeColorPreset {
  id: string;
  name: string;
  color: string;
  glow: string;
}

export interface WelcomeTemplatePreset {
  id: string;
  name: string;
  preview: string;
  template: string;
}

/** 贵宾边框光晕亮度 — 改这几个数即可（0~1 越小越暗） */
export const MEMBER_FRAME_GLOW = {
  outer: 0.28,   // 外圈光晕，越小越暗
  inset: 0.28,   // 向内光晕，越小越暗
  innerMix: 10,  // 向内晕染范围（%），越小越淡
} as const;

/** 兼容旧数据，边框仅使用颜色，固定 style id */
export const MEMBER_BORDER_STYLE_ID = 'solid';

export const BADGE_LABEL_PRESETS = [
  '贵宾',
  '赞助',
  '老铁',
  'VIP',
  'SVIP',
  '榜一',
  '金主',
  '顶流',
  '尊享',
  '御用',
  '大咖',
  '元老',
  '守护',
  '骑士',
  '领主',
  '公爵',
  '合伙人',
  '股东',
  '挚友',
  '家人',
  'MVP',
  '至尊',
  '典藏',
  '限定',
  '年度',
  '传奇',
  '殿堂',
  '核心粉',
  '真爱粉',
  '气氛组',
  '点歌王',
  '歌神',
  '麦霸',
  'DJ',
  '场控',
  '房管',
  '特邀',
  '嘉宾',
  '灵魂粉',
  '荣誉',
] as const;

export const BADGE_COLOR_PRESETS: BadgeColorPreset[] = [
  { id: 'gold', name: '鎏金', color: '#f6d365', glow: 'rgba(246, 211, 101, 0.55)' },
  { id: 'rose', name: '玫瑰金', color: '#f4a5c0', glow: 'rgba(244, 165, 192, 0.5)' },
  { id: 'cyan', name: '极光', color: '#67e8f9', glow: 'rgba(103, 232, 249, 0.45)' },
  { id: 'purple', name: '御紫', color: '#c4b5fd', glow: 'rgba(196, 181, 253, 0.5)' },
  { id: 'emerald', name: '翡翠', color: '#6ee7b7', glow: 'rgba(110, 231, 183, 0.45)' },
  { id: 'crimson', name: '赤焰', color: '#fb7185', glow: 'rgba(251, 113, 133, 0.45)' },
  { id: 'silver', name: '铂金', color: '#e2e8f0', glow: 'rgba(226, 232, 240, 0.4)' },
];

/** 房主/管理员专用色，贵宾角标与边框不可选 */
const ROLE_RESERVED_COLORS = new Set([
  '#fbbf24', // amber-400 房主
  '#38bdf8', // sky-400 管理员
]);

export function getSelectableBadgeColorPresets(): BadgeColorPreset[] {
  return BADGE_COLOR_PRESETS.filter((preset) => !ROLE_RESERVED_COLORS.has(preset.color));
}

export const WELCOME_TEMPLATE_PRESETS: WelcomeTemplatePreset[] = [
  {
    id: 'royal',
    name: '皇家驾临',
    preview: '👑 尊贵贵宾驾临，全场肃静',
    template: '👑 欢迎尊贵 {badge} {nickname} 驾临本房，请享受专属视听盛宴 👑',
  },
  {
    id: 'sparkle',
    name: '星光入场',
    preview: '✨ 贵宾闪耀登场',
    template: '✨ {badge} {nickname} 闪耀登场，音乐殿堂因你而亮 ✨',
  },
  {
    id: 'vip-lounge',
    name: 'VIP lounge',
    preview: '🥂 贵宾已就位',
    template: '🥂 贵宾 {badge} {nickname} 已就位，专属 lounge 体验开启 🥂',
  },
  {
    id: 'spotlight',
    name: '聚光灯',
    preview: '💫 聚光灯亮起',
    template: '💫 聚光灯亮起 —— 欢迎 {badge} {nickname} 加入同步听歌 💫',
  },
  {
    id: 'wave',
    name: '嗨翻全场',
    preview: '🎵 一起嗨起来',
    template: '🎵 {badge} {nickname} 来了！队列已为你预留排面，一起嗨 🎵',
  },
  {
    id: 'custom',
    name: '自定义',
    preview: '房主自定义欢迎语',
    template: '{badge} {nickname} 欢迎回来',
  },
];

export const DEFAULT_MEMBER_SETTINGS = {
  welcomeEnabled: true,
  welcomeTemplateId: 'royal',
  welcomeCustomText: '',
};

export const DEFAULT_MEMBER_TIER = {
  badgeLabel: '贵宾',
  badgeColor: BADGE_COLOR_PRESETS[0].color,
  borderStyleId: MEMBER_BORDER_STYLE_ID,
  borderColor: BADGE_COLOR_PRESETS[0].color,
};

const WELCOME_TEMPLATE_IDS = new Set(WELCOME_TEMPLATE_PRESETS.map((item) => item.id));

export function normalizeBadgeColor(color: string | undefined): string {
  const preset = BADGE_COLOR_PRESETS.find((item) => item.color === color || item.id === color);
  if (preset) return preset.color;
  if (/^#[0-9a-fA-F]{6}$/.test(String(color || ''))) return String(color);
  return DEFAULT_MEMBER_TIER.badgeColor;
}

/** 贵宾角标 — 颜色通过 CSS 变量注入，样式见 index.css */
export function getMemberBadgeStyle(color: string): CSSProperties {
  return {
    color,
    ['--member-badge-color' as string]: color,
  };
}

export function normalizeBorderStyleId(_styleId?: string): string {
  return MEMBER_BORDER_STYLE_ID;
}

export function normalizeWelcomeTemplateId(templateId: string | undefined): string {
  if (templateId && WELCOME_TEMPLATE_IDS.has(templateId)) return templateId;
  return DEFAULT_MEMBER_SETTINGS.welcomeTemplateId;
}

export function buildWelcomeText(
  templateId: string,
  customText: string,
  badgeLabel: string,
  nickname: string,
): string {
  const template = templateId === 'custom'
    ? (customText.trim() || WELCOME_TEMPLATE_PRESETS.find((item) => item.id === 'custom')!.template)
    : (WELCOME_TEMPLATE_PRESETS.find((item) => item.id === templateId)?.template
      || WELCOME_TEMPLATE_PRESETS[0].template);
  const badge = badgeLabel.trim() || '贵宾';
  return template
    .replace(/\{badge\}/g, `「${badge}」`)
    .replace(/\{nickname\}/g, nickname)
    .slice(0, 500);
}

export function getMemberFrameStyle(borderColor: string | undefined): CSSProperties {
  const color = normalizeBadgeColor(borderColor);
  return {
    ['--member-border-color' as string]: color,
    ['--member-glow-outer' as string]: String(MEMBER_FRAME_GLOW.outer),
    ['--member-glow-inset' as string]: String(MEMBER_FRAME_GLOW.inset),
    ['--member-glow-inner-mix' as string]: `${MEMBER_FRAME_GLOW.innerMix}%`,
  };
}
