import { getFmModeLabel, normalizeFmMode } from '../api/music/fmMode';
import Tooltip from './Tooltip';

interface Props {
  fmMode?: string | null;
  fmSource?: 'netease' | 'qishui' | null;
  clickable?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function RoomFmModeBadge({ fmMode, fmSource = 'netease', clickable = false, onClick, className = '' }: Props) {
  const mode = normalizeFmMode(fmMode);
  const label = getFmModeLabel(mode);

  return (
    <Tooltip content={clickable ? '点击切换漫游平台和模式' : `私人漫游：${label}`}>
      <button
        type={clickable ? 'button' : undefined}
        onClick={clickable ? onClick : undefined}
        disabled={!clickable}
        className={`inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 bg-white/[0.04] px-1.5 text-[10px] font-medium leading-none text-netease-muted transition-colors hover:border-white/20 hover:bg-white/[0.07] disabled:opacity-100 ${className}`}
      >
        <span className="font-medium text-[#ec4141]">漫游</span>
        <span>{label} / {fmSource === 'qishui' ? '汽水' : '网易'}</span>
      </button>
    </Tooltip>
  );
}
