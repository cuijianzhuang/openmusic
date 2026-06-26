import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content?: ReactNode;
  side?: TooltipSide;
  delay?: number;
  disabled?: boolean;
  children: ReactElement;
}

function mergeRefs<T>(...refs: Array<((node: T | null) => void) | React.MutableRefObject<T | null> | null | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else ref.current = node;
    }
  };
}

function hasTooltipContent(content: ReactNode): boolean {
  if (content == null || content === false) return false;
  if (typeof content === 'string') return content.trim().length > 0;
  return true;
}

function getTooltipStyle(rect: DOMRect, side: TooltipSide): CSSProperties {
  const gap = 8;
  switch (side) {
    case 'top':
      return {
        position: 'fixed',
        top: rect.top - gap,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, -100%)',
      };
    case 'bottom':
      return {
        position: 'fixed',
        top: rect.bottom + gap,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, 0)',
      };
    case 'left':
      return {
        position: 'fixed',
        top: rect.top + rect.height / 2,
        left: rect.left - gap,
        transform: 'translate(-100%, -50%)',
      };
    case 'right':
      return {
        position: 'fixed',
        top: rect.top + rect.height / 2,
        left: rect.right + gap,
        transform: 'translate(0, -50%)',
      };
    default:
      return { position: 'fixed', top: rect.top, left: rect.left };
  }
}

export default function Tooltip({
  content,
  side = 'top',
  delay = 320,
  disabled = false,
  children,
}: TooltipProps) {
  const tipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0 });

  const enabled = !disabled && hasTooltipContent(content);

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setStyle(getTooltipStyle(el.getBoundingClientRect(), side));
  }, [side]);

  const show = useCallback(() => {
    if (!enabled) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, delay);
  }, [delay, enabled, updatePosition]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setOpen(false);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!open) return;
    const handle = () => updatePosition();
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
  }, [open, updatePosition]);

  if (!isValidElement(children)) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  const childRef = (child as { ref?: React.Ref<HTMLElement> }).ref;

  const wrapped = cloneElement(child, {
    ref: mergeRefs<HTMLElement>((node) => { anchorRef.current = node; }, childRef),
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      (child.props.onMouseEnter as ((e: MouseEvent<HTMLElement>) => void) | undefined)?.(event);
      show();
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      (child.props.onMouseLeave as ((e: MouseEvent<HTMLElement>) => void) | undefined)?.(event);
      hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      (child.props.onFocus as ((e: FocusEvent<HTMLElement>) => void) | undefined)?.(event);
      show();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      (child.props.onBlur as ((e: FocusEvent<HTMLElement>) => void) | undefined)?.(event);
      hide();
    },
    'aria-describedby': open && enabled ? tipId : undefined,
    title: undefined,
  });

  return (
    <>
      {wrapped}
      {open && enabled && createPortal(
        <div
          id={tipId}
          role="tooltip"
          style={style}
          className="pointer-events-none z-[220] max-w-[min(280px,calc(100vw-24px))] animate-fade-in rounded-lg border border-white/10 bg-[#1a1a1a]/95 px-2.5 py-1.5 text-xs leading-snug text-white/90 shadow-xl backdrop-blur-md"
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
