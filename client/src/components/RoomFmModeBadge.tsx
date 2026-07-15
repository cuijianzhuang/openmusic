import { getFmModeLabel, normalizeFmMode } from '../api/music/fmMode';
import Tooltip from './Tooltip';

interface Props {
  fmMode?: string | null;
  className?: string;
}

export default function RoomFmModeBadge({ fmMode, className = '' }: Props) {
  const mode = normalizeFmMode(fmMode);
  const label = getFmModeLabel(mode);

  return (
    <Tooltip content={`私人漫游：${label}`}>
      <span
        className={`inline-flex h-5 items-center gap-1 whitespace-nowrap text-[10px] leading-none text-netease-muted ${className}`}
      >
        <span className="font-medium text-[#ec4141]">漫游</span>
        <span>{label}</span>
      </span>
    </Tooltip>
  );
}
