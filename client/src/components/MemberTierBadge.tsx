import type { RoomMemberTier } from '../types';
import { normalizeBadgeColor } from '../lib/memberTierPresets';

interface Props {
  tier: Pick<RoomMemberTier, 'badgeLabel' | 'badgeColor'>;
  className?: string;
}

export default function MemberTierBadge({ tier, className = '' }: Props) {
  const color = normalizeBadgeColor(tier.badgeColor);
  const label = tier.badgeLabel.trim() || '贵宾';

  return (
    <span
      className={`member-badge-shine inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[9px] font-semibold leading-4 tracking-wide text-black/90 shadow-sm ${className}`}
      style={{
        backgroundColor: color,
        boxShadow: `0 0 12px ${color}66, inset 0 1px 0 rgba(255,255,255,0.45)`,
      }}
    >
      {label}
    </span>
  );
}
