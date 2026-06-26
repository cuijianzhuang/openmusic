import { getQualityLabel, normalizeRoomAudioQuality } from '../api/music/quality';
import type { RoomAudioQuality } from '../types';
import Tooltip from './Tooltip';

interface Props {
  audioQuality?: RoomAudioQuality | null;
  className?: string;
}

export default function RoomQualityBadge({ audioQuality, className = '' }: Props) {
  const quality = normalizeRoomAudioQuality(audioQuality);

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${className}`}>
      <Tooltip content={`网易云音质：${getQualityLabel(quality.netease)}`}>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5">
          <span className="font-medium text-[#ec4141]">网易</span>
          <span className="text-netease-muted">{getQualityLabel(quality.netease)}</span>
        </span>
      </Tooltip>
      <Tooltip content={`QQ音乐音质：${getQualityLabel(quality.tencent)}`}>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5">
          <span className="font-medium text-[#31c27c]">QQ</span>
          <span className="text-netease-muted">{getQualityLabel(quality.tencent)}</span>
        </span>
      </Tooltip>
    </span>
  );
}
