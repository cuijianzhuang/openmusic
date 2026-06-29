import { useState } from 'react';
import { getCoverUrl } from '../api/music';
import { getCoverPixelSize, getFallbackCoverUrl, type CoverSize } from '../lib/coverUrl';
import type { Song } from '../types';

interface Props {
  song: Pick<Song, 'id' | 'source' | 'pic'>;
  size?: CoverSize;
  className?: string;
  eager?: boolean;
}

export default function SongCover({
  song,
  size = 'thumb',
  className = '',
  eager = false,
}: Props) {
  const [failed, setFailed] = useState(false);
  const src = failed ? getFallbackCoverUrl() : getCoverUrl(song, size);
  const pixelSize = getCoverPixelSize(size);

  return (
    <img
      src={src}
      alt=""
      className={className}
      width={pixelSize}
      height={pixelSize}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      {...(eager ? { fetchPriority: 'high' as const } : {})}
      onError={() => setFailed(true)}
    />
  );
}
