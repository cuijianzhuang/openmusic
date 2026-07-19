import { resolveEffectiveAudioQuality } from '../stores/userQualityStore';
import { useRoomStore } from '../stores/roomStore';
import { getQualityLabel } from '../api/music/quality';
import type { RoomAudioQuality } from '../types';
import Tooltip from './Tooltip';

interface Props {
  audioQuality?: RoomAudioQuality | null;
  className?: string;
  onClick?: () => void;
}

const META_TEXT = 'status-chip whitespace-nowrap';

export default function RoomQualityBadge({ audioQuality, className = '', onClick }: Props) {
  const roomQuality = useRoomStore((s) => s.room?.audioQuality);
  const quality = resolveEffectiveAudioQuality(audioQuality ?? roomQuality);

  const content = (
    <>
      <Tooltip content={`红点音质：${getQualityLabel(quality.netease)}`}>
        <span className="whitespace-nowrap">
          <span className="text-netease-red">红点</span>
          {' '}
          {getQualityLabel(quality.netease)}
        </span>
      </Tooltip>
      <span className="text-white/20" aria-hidden>·</span>
      <Tooltip content={`绿点音质：${getQualityLabel(quality.tencent)}`}>
        <span className="whitespace-nowrap">
          <span className="text-[#31c27c]">绿点</span>
          {' '}
          {getQualityLabel(quality.tencent)}
        </span>
      </Tooltip>
    </>
  );

  if (!onClick) {
    return <div className={`${META_TEXT} ${className}`}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${META_TEXT} text-left font-normal transition-opacity hover:opacity-80 ${className}`}
      aria-label="设置我的音质"
    >
      {content}
    </button>
  );
}
