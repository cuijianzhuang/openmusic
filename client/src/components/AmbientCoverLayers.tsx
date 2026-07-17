import { useEffect, useMemo, useState } from 'react';
import { measureCoverLuminance, tuneCoverBackdrop, type CoverBackdropTuning } from '../lib/coverBackdrop';
import { toProxiedMediaUrl } from '../lib/mediaProxyUrl';
import { useSignedApiUrl } from '../lib/signedApiUrl';

interface Props {
  coverUrl: string;
  className?: string;
}

export default function AmbientCoverLayers({ coverUrl, className = 'absolute inset-0' }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [tuning, setTuning] = useState<CoverBackdropTuning>(() => tuneCoverBackdrop(null));
  const signedCover = useSignedApiUrl(coverUrl);
  const displayUrl = useMemo(() => (signedCover ? toProxiedMediaUrl(signedCover) : ''), [signedCover]);

  useEffect(() => {
    setLoaded(false);
    setTuning(tuneCoverBackdrop(null));

    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      setTuning(tuneCoverBackdrop(measureCoverLuminance(probe)));
    };
    probe.onerror = () => {
      setTuning(tuneCoverBackdrop(null));
    };
    probe.src = displayUrl;

    return () => {
      probe.onload = null;
      probe.onerror = null;
    };
  }, [displayUrl]);

  return (
    <div className={`${className} overflow-hidden`} aria-hidden>
      <div className="absolute inset-0 bg-[#0d0d0d]" />

      <img
        src={displayUrl}
        alt=""
        crossOrigin="anonymous"
        className="absolute inset-0 h-full w-full object-cover saturate-110 transition-[opacity,filter] duration-700"
        style={{
          opacity: loaded ? tuning.coverOpacity : 0,
          filter: `blur(28px) brightness(${tuning.imgBrightness})`,
          transform: 'scale(1.05)',
        }}
        onLoad={() => setLoaded(true)}
      />

      <div
        className="absolute inset-0 transition-[background-color] duration-700"
        style={{ backgroundColor: `rgba(0, 0, 0, ${tuning.baseOverlay})` }}
      />

      <div
        className="absolute inset-0 transition-[background] duration-700"
        style={{
          background: `linear-gradient(to bottom, rgba(0, 0, 0, ${tuning.gradientTop}), transparent, rgba(0, 0, 0, ${tuning.gradientBottom}))`,
        }}
      />
    </div>
  );
}
