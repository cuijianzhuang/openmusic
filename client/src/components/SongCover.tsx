import { useEffect, useState } from 'react';
import { getCoverUrl } from '../api/music';
import { getCoverPixelSize, getFallbackCoverUrl, type CoverSize } from '../lib/coverUrl';
import { useSignedApiUrl } from '../lib/signedApiUrl';
import type { Song } from '../types';

interface Props {
  song: Pick<Song, 'id' | 'source' | 'pic'>;
  size?: CoverSize;
  className?: string;
  eager?: boolean;
}

function coverIdentity(song: Pick<Song, 'id' | 'source' | 'pic'>): string {
  return `${song.source || 'netease'}:${song.id}:${song.pic || ''}`;
}

export default function SongCover({
  song,
  size = 'thumb',
  className = '',
  eager = false,
}: Props) {
  const identity = coverIdentity(song);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === identity;

  // 切歌后必须清掉失败态，否则底栏单例封面会一直卡在黑底占位
  useEffect(() => {
    setFailedFor(null);
  }, [identity]);

  const raw = getCoverUrl(song, size);
  const signed = useSignedApiUrl(raw);
  const src = failed || !signed ? getFallbackCoverUrl() : signed;
  const pixelSize = getCoverPixelSize(size);

  return (
    <img
      key={identity}
      src={src}
      alt=""
      className={className}
      width={pixelSize}
      height={pixelSize}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      {...(eager ? { fetchPriority: 'high' as const } : {})}
      onError={() => setFailedFor(identity)}
    />
  );
}
