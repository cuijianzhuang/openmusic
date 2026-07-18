import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** 自定义下拉框（替代原生 select，深色主题） */
export function AdminSelect<T extends string>({
  value,
  options,
  onChange,
  className = '',
  ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-black/20 px-3 py-2.5 text-sm text-white transition-colors ${
          open ? 'border-netease-red/50' : 'border-white/10 hover:border-white/25'
        }`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-netease-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 min-w-full overflow-y-auto rounded-xl border border-white/10 bg-netease-dark py-1 shadow-2xl animate-fade-in"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={value === opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                value === opt.value
                  ? 'bg-netease-red/10 text-netease-red'
                  : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Check className={`h-3.5 w-3.5 shrink-0 ${value === opt.value ? 'opacity-100' : 'opacity-0'}`} />
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 拨动开关（替代原生 checkbox 的启用/停用场景） */
export function AdminSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`group flex cursor-pointer items-center gap-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'text-white' : 'text-netease-muted hover:text-white'
      }`}
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? 'bg-netease-red' : 'bg-white/15 group-hover:bg-white/25'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      {label}
    </button>
  );
}

/** 自定义复选框（替代原生 checkbox） */
export function AdminCheckbox({
  checked,
  onChange,
  label,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex cursor-pointer items-center gap-2 text-left text-xs transition-colors ${
        checked ? 'text-white' : 'text-netease-muted hover:text-white'
      } ${className}`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ${
          checked ? 'border-netease-red bg-netease-red' : 'border-white/25 bg-black/20 hover:border-white/40'
        }`}
      >
        <Check className={`h-3 w-3 text-white transition-opacity ${checked ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
      </span>
      {label}
    </button>
  );
}
