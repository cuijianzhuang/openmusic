import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronDown, Check } from 'lucide-react';
import type { SearchResult } from '../types';
import { songKey } from '../api/music';
import SongCover from './SongCover';
import SongRowBadges from './SongRowBadges';
import FavoriteButton from './FavoriteButton';
import { RESULT_BODY_HEIGHT } from './SearchSkeleton';
import {
  getStoredSongResultPageSize,
  setStoredSongResultPageSize,
  SONG_RESULT_PAGE_SIZE_OPTIONS,
  type SongResultPageSize,
} from '../lib/songResultPagination';

interface Props {
  results: SearchResult[];
  addingId: string | null;
  onAdd: (song: SearchResult) => void;
  keyword?: string;
  alwaysShowActions?: boolean;
  onPageResultsChange?: (songs: SearchResult[]) => void;
  fillHeight?: boolean;
}

function PageSizeSelect({
  value,
  onChange,
}: {
  value: SongResultPageSize;
  onChange: (size: SongResultPageSize) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ left: number; bottom: number; minWidth: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setMenuStyle({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 6,
      minWidth: Math.max(rect.width, 88),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const menu = open && menuStyle && createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label="每页条数"
      className="fixed z-[100] rounded-xl border border-white/10 bg-netease-bg/95 py-1 shadow-xl backdrop-blur-md animate-fade-in"
      style={{
        left: menuStyle.left,
        bottom: menuStyle.bottom,
        minWidth: menuStyle.minWidth,
      }}
    >
      {SONG_RESULT_PAGE_SIZE_OPTIONS.map((size) => (
        <button
          key={size}
          type="button"
          role="option"
          aria-selected={value === size}
          onClick={() => {
            onChange(size);
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
            value === size
              ? 'bg-netease-red/10 text-netease-red'
              : 'text-white/80 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Check className={`h-3.5 w-3.5 flex-shrink-0 ${value === size ? 'opacity-100' : 'opacity-0'}`} />
          <span>{size} 条</span>
        </button>
      ))}
    </div>,
    document.body,
  );

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5">
      <span className="whitespace-nowrap text-[11px] text-netease-muted">每页</span>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1 rounded-lg border border-netease-border/60 bg-netease-card px-2 py-1 text-xs text-white/90 transition-colors hover:border-netease-red/40 hover:text-white"
      >
        <span>{value} 条</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  );
}

export default function SongResultList({
  results,
  addingId,
  onAdd,
  keyword,
  alwaysShowActions = false,
  onPageResultsChange,
  fillHeight = false,
}: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<SongResultPageSize>(getStoredSongResultPageSize);
  const [jumpInput, setJumpInput] = useState('');

  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const pageResults = results.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [keyword, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  useEffect(() => {
    onPageResultsChange?.(pageResults);
  }, [pageResults, onPageResultsChange]);

  const handlePageSizeChange = useCallback((next: SongResultPageSize) => {
    setPageSize(next);
    setStoredSongResultPageSize(next);
    setPage(1);
  }, []);

  const handleJumpToPage = useCallback(() => {
    const target = Number.parseInt(jumpInput.trim(), 10);
    if (!Number.isFinite(target)) return;
    const clamped = Math.min(Math.max(1, target), totalPages);
    setPage(clamped);
    setJumpInput(String(clamped));
  }, [jumpInput, totalPages]);

  if (results.length === 0) return null;

  return (
    <div
      className={`flex min-h-0 flex-col ${fillHeight ? 'h-full' : ''}`}
      style={fillHeight ? undefined : { height: RESULT_BODY_HEIGHT }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
        <div className="space-y-2">
          {pageResults.map((song) => {
            const key = songKey(song);
            return (
              <div
                key={key}
                className="group flex cursor-pointer items-center gap-2 rounded-xl p-2.5 transition-colors hover:bg-netease-card/80 active:bg-netease-card/80 sm:gap-3 sm:p-3"
                onDoubleClick={() => onAdd(song)}
                title="双击点歌"
              >
                <SongCover
                  song={song}
                  className="h-12 w-12 flex-shrink-0 rounded-lg bg-netease-card object-cover"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">{song.name}</p>
                  <p className="truncate text-xs text-netease-muted">{song.artist}{song.album ? ` · ${song.album}` : ''}</p>
                </div>
                <SongRowBadges song={song} />
                <FavoriteButton
                  song={song}
                  showOnHover={!alwaysShowActions}
                  className="h-7 w-7 text-netease-muted hover:text-rose-300"
                  iconClassName="h-3.5 w-3.5"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); onAdd(song); }}
                  disabled={addingId === key}
                  className={`flex flex-shrink-0 items-center gap-1 rounded-full bg-netease-red/10 px-2.5 py-1 text-xs font-medium text-netease-red transition-all hover:bg-netease-red hover:text-white disabled:opacity-50 ${alwaysShowActions ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
                >
                  {addingId === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  点歌
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto flex-shrink-0 space-y-2 overflow-visible border-t border-netease-border/40 bg-netease-bg/90 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PageSizeSelect value={pageSize} onChange={handlePageSizeChange} />
          <span className="text-xs text-netease-muted">
            {page} / {totalPages}
            <span className="ml-1 text-netease-muted/50">共 {results.length} 首</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(1)}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-netease-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              title="首页"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
              首页
            </button>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-netease-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              上一页
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJumpToPage()}
              placeholder={String(page)}
              className="w-12 rounded-lg border border-netease-border/60 bg-netease-card px-2 py-1 text-center text-xs text-white focus:border-netease-red/50 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              aria-label="跳转到页码"
            />
            <button
              type="button"
              onClick={handleJumpToPage}
              className="rounded-lg px-2 py-1 text-xs text-netease-muted transition-colors hover:bg-white/5 hover:text-white"
            >
              跳转
            </button>
          </div>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-netease-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            下一页
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
