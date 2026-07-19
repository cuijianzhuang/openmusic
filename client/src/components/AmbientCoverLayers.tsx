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
  // The proxy endpoint itself is protected by API signing. Build the local proxy
  // URL first so the signature covers /api/media-proxy and its `url` query.
  const proxiedCover = useMemo(() => toProxiedMediaUrl(coverUrl), [coverUrl]);
  const signedCover = useSignedApiUrl(proxiedCover);
  const displayUrl = signedCover || '';

  useEffect(() => {
    setLoaded(false);
    setTuning(tuneCoverBackdrop(null));

    if (!displayUrl) return;

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
      <div className="absolute inset-0 bg-surface-canvas" />

      <img
        src={displayUrl}
        alt=""
        crossOrigin="anonymous"
        className="absolute inset-0 h-full w-full object-cover transition-[opacity,filter] duration-700"
        style={{
          opacity: loaded ? tuning.coverOpacity : 0,
          filter: `blur(46px) brightness(${tuning.imgBrightness}) saturate(1.32) contrast(.96)`,
          transform: 'scale(1.14)',
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

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(255,255,255,0.08),transparent_42%),linear-gradient(90deg,rgba(0,0,0,.25),transparent_25%,transparent_75%,rgba(0,0,0,.25))]" />
      <div className="absolute inset-0 shadow-[inset_0_0_180px_rgba(0,0,0,.42)]" />
    </div>
  );
}
