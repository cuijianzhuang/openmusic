import { useEffect, useState, type ReactNode } from 'react';
import type { RoomVisualFxSettings, RoomVisualMode } from '../../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX, defaultLyricFxPatch } from '../../lib/roomVisualPreset';
import { defaultLyricTypographyPatch } from '../../lib/lyricStyle';
import RoomVisualPresetGrid from '../RoomVisualPresetGrid';
import ImmersiveLyricFxControls from './ImmersiveLyricFxControls';
import ImmersiveAppearanceControls from './ImmersiveAppearanceControls';
import {
  FxMineradioSlider,
  FxMineradioToggle,
  FxSectionLabel,
  MOTION_FX_SLIDERS,
  ADVANCED_FX_SLIDERS,
} from '../RoomVisualFxSettingsBody';

export type ImmersiveFxTab = 'preset' | 'appearance' | 'lyrics' | 'motion' | 'advanced';

const TAB_META: { id: ImmersiveFxTab; label: string }[] = [
  { id: 'preset', label: '预设' },
  { id: 'appearance', label: '外观' },
  { id: 'lyrics', label: '歌词' },
  { id: 'motion', label: '动态' },
  { id: 'advanced', label: '高级' },
];

interface Props {
  value: RoomVisualFxSettings;
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void;
  onReset: () => void;
  visualMode: RoomVisualMode;
  onVisualModeChange: (mode: RoomVisualMode) => void;
  onDraggingChange?: (dragging: boolean) => void;
  coverUrl?: string | null;
}

type LocalSliderDef = {
  key: keyof RoomVisualFxSettings;
  label: string;
  min: number;
  max: number;
  step: number;
};

function motionSlidersForMode(mode: RoomVisualMode) {
  if (mode === 'topography') {
    return MOTION_FX_SLIDERS.filter((s) => s.key !== 'coverResolution' && s.key !== 'cinemaShake').map((s) => {
      if (s.key === 'intensity') return { ...s, label: '起伏幅度' };
      if (s.key === 'depth') return { ...s, label: '地形密度' };
      if (s.key === 'speed') return { ...s, label: '起伏速度' };
      if (s.key === 'cameraDistance') return { ...s, label: '镜头远近' };
      return s;
    });
  }
  return MOTION_FX_SLIDERS;
}

function advancedSlidersForMode(mode: RoomVisualMode) {
  if (mode === 'topography') {
    return ADVANCED_FX_SLIDERS.filter((s) => s.key === 'colorBoost' || s.key === 'bloomStrength');
  }
  return ADVANCED_FX_SLIDERS;
}

function renderSliders(
  defs: Array<(typeof MOTION_FX_SLIDERS)[number] | LocalSliderDef>,
  value: RoomVisualFxSettings,
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void,
  draggingKey: string | null,
  setDraggingKey: (key: string | null) => void,
) {
  return defs.map((def) => {
    const hidden = draggingKey !== null && draggingKey !== def.key;
    const key = def.key as keyof RoomVisualFxSettings;
    const current = value[key] as number;
    const defaultValue = (DEFAULT_ROOM_VISUAL_FX[key] as number) ?? current;
    return (
      <div key={String(def.key)} className={hidden ? 'pointer-events-none invisible' : ''}>
        <FxMineradioSlider
          def={def as never}
          value={current}
          defaultValue={defaultValue}
          onDragStart={() => setDraggingKey(String(def.key))}
          onLiveChange={(v) => {
            onPatch('patch' in def && def.patch ? def.patch(v, value) : { [def.key]: v });
          }}
          onReset={() => {
            onPatch('patch' in def && def.patch ? def.patch(defaultValue, value) : { [def.key]: defaultValue });
          }}
        />
      </div>
    );
  });
}

function FxSeg({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="fx-seg">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FxFold({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`fx-fold ${open ? 'open' : ''}`}>
      <button type="button" className="fx-fold-head w-full text-left" onClick={onToggle}>
        <span className="fx-fold-title">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <span className="arrow">▶</span>
      </button>
      <div className="fx-fold-body">{children}</div>
    </div>
  );
}

export default function ImmersiveFxSettingsPanel({
  value,
  onPatch,
  onReset,
  visualMode,
  onVisualModeChange,
  onDraggingChange,
  coverUrl,
}: Props) {
  const [tab, setTab] = useState<ImmersiveFxTab>('preset');
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({
    lyricToggles: true,
    lyricPosition: true,
    motionCore: true,
    shelf3d: true,
    advancedCore: true,
  });
  const dragging = draggingKey !== null;

  const toggleFold = (key: string) => {
    setOpenFolds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    onDraggingChange?.(dragging);
  }, [dragging, onDraggingChange]);

  useEffect(() => {
    if (!draggingKey) return;
    const end = () => setDraggingKey(null);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [draggingKey]);

  return (
    <div className="fx-panel-layout">
      <div className="fx-panel-tabs" role="tablist" aria-label="视觉设置分类">
        {TAB_META.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="fx-tab-scroll">
        {tab === 'preset' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <FxSectionLabel>视觉预设</FxSectionLabel>
            <div className={dragging ? 'pointer-events-none invisible' : ''}>
              <RoomVisualPresetGrid value={visualMode} onChange={onVisualModeChange} />
            </div>
          </div>
        ) : null}

        {tab === 'appearance' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <ImmersiveAppearanceControls
              value={value}
              onPatch={onPatch}
              coverUrl={coverUrl}
              dragging={dragging}
              draggingKey={draggingKey}
              setDraggingKey={setDraggingKey}
            />
          </div>
        ) : null}

        {tab === 'lyrics' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <FxFold
              title="歌词开关"
              subtitle="沉浸歌词与溢光"
              open={openFolds.lyricToggles}
              onToggle={() => toggleFold('lyricToggles')}
            >
              <div className={`fx-toggle-grid ${dragging ? 'pointer-events-none invisible' : ''}`}>
                <FxMineradioToggle
                  label="粒子歌词"
                  checked={value.particleLyrics}
                  onChange={(particleLyrics) => onPatch({ particleLyrics })}
                />
                <FxMineradioToggle
                  label="歌词溢光"
                  checked={value.lyricGlow}
                  onChange={(lyricGlow) => onPatch({ lyricGlow })}
                />
                <FxMineradioToggle
                  label="鼓点溢光"
                  checked={value.lyricGlowBeat}
                  onChange={(lyricGlowBeat) => onPatch({ lyricGlowBeat })}
                />
                <FxMineradioToggle
                  label="歌词光粒"
                  checked={value.lyricGlowParticles}
                  onChange={(lyricGlowParticles) => onPatch({ lyricGlowParticles })}
                />
                <FxMineradioToggle
                  label="歌词镜头绑定"
                  checked={value.lyricCameraLock}
                  onChange={(lyricCameraLock) => onPatch({ lyricCameraLock })}
                />
              </div>
            </FxFold>

            <FxFold
              title="歌词外观"
              subtitle="颜色 / 字体 / 位置"
              open={openFolds.lyricPosition}
              onToggle={() => toggleFold('lyricPosition')}
            >
              <ImmersiveLyricFxControls
                value={value}
                onPatch={onPatch}
                draggingKey={draggingKey}
                setDraggingKey={setDraggingKey}
                dragging={dragging}
              />
            </FxFold>

            <div className={`fx-actions ${dragging ? 'pointer-events-none invisible' : ''}`}>
              <button
                type="button"
                className="fx-mini-btn"
                onClick={() => onPatch({ ...defaultLyricFxPatch(), ...defaultLyricTypographyPatch() })}
              >
                恢复默认
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'motion' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <FxFold
              title="画面基础"
              subtitle="律动 / 景深 / 镜头"
              open={openFolds.motionCore}
              onToggle={() => toggleFold('motionCore')}
            >
              {renderSliders(motionSlidersForMode(visualMode), value, onPatch, draggingKey, setDraggingKey)}

              <FxSectionLabel>镜头与叠加</FxSectionLabel>
              <div className={`fx-toggle-grid ${dragging ? 'pointer-events-none invisible' : ''}`}>
                {visualMode !== 'topography' ? (
                  <FxMineradioToggle
                    label="电影镜头"
                    checked={value.cinema}
                    onChange={(cinema) => onPatch({ cinema })}
                  />
                ) : null}
                <FxMineradioToggle
                  label={visualMode === 'topography' ? '浮动方块' : '浮空粒子层'}
                  checked={value.floatLayer}
                  disabled={visualMode !== 'emily' && visualMode !== 'topography'}
                  title={
                    visualMode !== 'emily' && visualMode !== 'topography'
                      ? '仅 emily / 声波地形可用'
                      : undefined
                  }
                  onChange={(floatLayer) => onPatch({ floatLayer })}
                />
                {visualMode !== 'topography' ? (
                  <>
                    <FxMineradioToggle
                      label="粒子溢光"
                      checked={value.bloom && value.bloomStrength > 0.01}
                      onChange={(bloom) =>
                        onPatch(
                          bloom
                            ? {
                                bloom: true,
                                ...(value.bloomStrength <= 0.01
                                  ? { bloomStrength: DEFAULT_ROOM_VISUAL_FX.bloomStrength }
                                  : {}),
                              }
                            : { bloom: false },
                        )
                      }
                    />
                    <FxMineradioToggle
                      label="轮廓高亮"
                      checked={value.edge}
                      onChange={(edge) => onPatch({ edge })}
                    />
                  </>
                ) : null}
              </div>
            </FxFold>

            <FxFold
              title="3D / 手势"
              subtitle="歌单架 / 摄像头交互"
              open={openFolds.shelf3d}
              onToggle={() => toggleFold('shelf3d')}
            >
              <FxSectionLabel>3D 歌单架</FxSectionLabel>
              <FxSeg
                value={value.shelfMode}
                onChange={(shelfMode) => onPatch({ shelfMode: shelfMode as RoomVisualFxSettings['shelfMode'] })}
                options={[
                  { value: 'off', label: '关闭' },
                  { value: 'side', label: '侧栏' },
                  { value: 'stage', label: '舞台' },
                ]}
              />

              <FxSectionLabel>歌单架镜头</FxSectionLabel>
              <FxSeg
                value={value.shelfCameraMode}
                onChange={(shelfCameraMode) =>
                  onPatch({ shelfCameraMode: shelfCameraMode as RoomVisualFxSettings['shelfCameraMode'] })
                }
                options={[
                  { value: 'dynamic', label: '动态镜头' },
                  { value: 'static', label: '静态镜头' },
                ]}
              />

              <FxSectionLabel>歌单架显示</FxSectionLabel>
              <FxSeg
                value={value.shelfPresence}
                onChange={(shelfPresence) =>
                  onPatch({ shelfPresence: shelfPresence as RoomVisualFxSettings['shelfPresence'] })
                }
                options={[
                  { value: 'auto', label: '自动隐藏' },
                  { value: 'always', label: '常驻' },
                ]}
              />

              <FxSectionLabel>歌单架外观</FxSectionLabel>
              <div className={`lyric-color-row ${dragging ? 'pointer-events-none invisible' : ''}`}>
                <input
                  type="color"
                  className="lyric-color-picker"
                  value={value.shelfAccentColor}
                  title="歌单架颜色"
                  onChange={(e) => onPatch({ shelfAccentColor: e.target.value.toLowerCase() })}
                />
                <div className="fx-color-row-label">
                  歌单架颜色
                  <small>{value.shelfAccentColor}</small>
                </div>
                <button
                  type="button"
                  className="fx-mini-btn ghost"
                  onClick={() => onPatch({ shelfAccentColor: DEFAULT_ROOM_VISUAL_FX.shelfAccentColor })}
                >
                  默认
                </button>
              </div>

              <FxSectionLabel>歌单架参数</FxSectionLabel>
              {renderSliders(
                [
                  { key: 'shelfSize', label: '歌单架大小', min: 0.65, max: 1.45, step: 0.01 },
                  { key: 'shelfOffsetX', label: '左右位置', min: -1.6, max: 1.6, step: 0.01 },
                  { key: 'shelfOffsetY', label: '上下位置', min: -1.6, max: 1.6, step: 0.01 },
                  { key: 'shelfOffsetZ', label: '前后景深', min: -1.6, max: 1.6, step: 0.01 },
                  { key: 'shelfAngleY', label: '侧向角度', min: -35, max: 15, step: 1 },
                  { key: 'shelfOpacity', label: '整体透明度', min: 0.2, max: 1, step: 0.01 },
                  { key: 'shelfBgOpacity', label: '背景透明度', min: 0.15, max: 1, step: 0.01 },
                ],
                value,
                onPatch,
                draggingKey,
                setDraggingKey,
              )}

              <FxSectionLabel>摄像头交互</FxSectionLabel>
              <FxSeg
                value={value.cameraInteraction}
                onChange={(cameraInteraction) =>
                  onPatch({ cameraInteraction: cameraInteraction as RoomVisualFxSettings['cameraInteraction'] })
                }
                options={[
                  { value: 'off', label: '关闭' },
                  { value: 'gesture', label: '手势触碰' },
                ]}
              />
            </FxFold>
          </div>
        ) : null}

        {tab === 'advanced' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <FxFold
              title="粒子高级参数"
              subtitle="尺寸 / 流速 / 色彩"
              open={openFolds.advancedCore}
              onToggle={() => toggleFold('advancedCore')}
            >
              {renderSliders(advancedSlidersForMode(visualMode), value, onPatch, draggingKey, setDraggingKey)}
            </FxFold>

            <div className={`fx-actions ${dragging ? 'pointer-events-none invisible' : ''}`}>
              <button type="button" className="fx-mini-btn" onClick={onReset}>
                恢复默认
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
