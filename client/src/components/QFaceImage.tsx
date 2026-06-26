import { useEffect, useRef, useState } from 'react';
import {
  getQQFaceItem,
  getQQFaceUrl,
  isQFaceImageDecoded,
  markQFaceImageRendered,
  QFaceLoadPriority,
  requestQFaceImage,
  subscribeQFaceImageState,
  type QFaceLoadPriority as QFacePriority,
} from '../lib/qface';
import Tooltip from './Tooltip';

interface Props {
  id: string;
  className?: string;
  /** P0：当前可见区域 */
  priority?: QFacePriority;
  /** P1：即将进入视野（rootMargin 预取） */
  nearPriority?: QFacePriority;
  /** IntersectionObserver root，如聊天滚动区 / 表情面板 */
  observeRoot?: Element | null;
  placeholderClassName?: string;
}

const NEAR_ROOT_MARGIN = '96px';

export default function QFaceImage({
  id,
  className,
  priority = QFaceLoadPriority.PANEL,
  nearPriority = QFaceLoadPriority.NEAR,
  observeRoot = null,
  placeholderClassName,
}: Props) {
  const face = getQQFaceItem(id);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [decoded, setDecoded] = useState(() => isQFaceImageDecoded(id));

  useEffect(() => {
    return subscribeQFaceImageState(id, (state) => {
      setDecoded(state === 'decoded' || state === 'rendered');
    });
  }, [id]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const schedule = (loadPriority: QFacePriority) => {
      void requestQFaceImage(id, loadPriority);
    };

    const visibleObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) schedule(priority);
      },
      { root: observeRoot, threshold: 0.01 },
    );

    const nearObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) schedule(nearPriority);
      },
      { root: observeRoot, rootMargin: NEAR_ROOT_MARGIN, threshold: 0.01 },
    );

    visibleObserver.observe(anchor);
    nearObserver.observe(anchor);
    return () => {
      visibleObserver.disconnect();
      nearObserver.disconnect();
    };
  }, [id, nearPriority, observeRoot, priority]);

  return (
    <Tooltip content={face.text} side="bottom">
      <span ref={anchorRef} className="inline-flex align-middle">
        {decoded ? (
          <img
            src={getQQFaceUrl(id)}
            alt={face.text}
            className={className}
            decoding="async"
            onLoad={() => markQFaceImageRendered(id)}
          />
        ) : (
          <span
            className={placeholderClassName || className}
            aria-hidden="true"
          />
        )}
      </span>
    </Tooltip>
  );
}
