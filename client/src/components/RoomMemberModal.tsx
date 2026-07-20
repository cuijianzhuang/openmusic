import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crown, Search, Sparkles, Trash2, UserPlus, X } from 'lucide-react';
import type { RoomMemberSettings, RoomMemberTier, RoomUser } from '../types';
import {
  BADGE_LABEL_PRESETS,
  DEFAULT_MEMBER_SETTINGS,
  DEFAULT_MEMBER_TIER,
  MEMBER_BORDER_STYLE_ID,
  WELCOME_TEMPLATE_PRESETS,
  getSelectableBadgeColorPresets,
  normalizeBadgeColor,
  normalizeWelcomeTemplateId,
  buildWelcomeText,
} from '../lib/memberTierPresets';
import MemberTierBadge from './MemberTierBadge';
import MemberQueueFrame from './MemberQueueFrame';

interface Props {
  open: boolean;
  users: RoomUser[];
  creatorId?: string;
  adminIds?: string[];
  memberTiers: Record<string, RoomMemberTier>;
  memberSettings: RoomMemberSettings;
  saving?: boolean;
  onClose: () => void;
  onSaveSettings: (settings: RoomMemberSettings) => void;
  onSaveTier: (userId: string, tier: Omit<RoomMemberTier, 'userId' | 'assignedAt'>) => void;
  onRemoveTier: (userId: string) => void;
}

type DraftTier = Omit<RoomMemberTier, 'userId' | 'assignedAt'>;

function buildDraftFromTier(tier?: RoomMemberTier): DraftTier {
  if (!tier) {
    return { ...DEFAULT_MEMBER_TIER };
  }
  return {
    badgeLabel: tier.badgeLabel,
    badgeColor: tier.badgeColor,
    borderStyleId: MEMBER_BORDER_STYLE_ID,
    borderColor: tier.borderColor,
  };
}

export default function RoomMemberModal({
  open,
  users,
  creatorId,
  adminIds = [],
  memberTiers,
  memberSettings,
  saving = false,
  onClose,
  onSaveSettings,
  onSaveTier,
  onRemoveTier,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTier>(buildDraftFromTier());
  const [settingsDraft, setSettingsDraft] = useState<RoomMemberSettings>({
    ...DEFAULT_MEMBER_SETTINGS,
    ...memberSettings,
  });

  useEffect(() => {
    if (!open) return;
    setSettingsDraft({ ...DEFAULT_MEMBER_SETTINGS, ...memberSettings });
  }, [open, memberSettings]);

  const assignableUsers = useMemo(() => {
    const adminSet = new Set(adminIds);
    return users.filter((user) => user.id !== creatorId && !adminSet.has(user.id));
  }, [users, creatorId, adminIds]);

  useEffect(() => {
    if (selectedUserId && !assignableUsers.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [assignableUsers, selectedUserId]);

  const onlineUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assignableUsers
      .filter((user) => !keyword || user.nickname.toLowerCase().includes(keyword))
      .sort((a, b) => {
        const aTier = memberTiers[a.id] ? 1 : 0;
        const bTier = memberTiers[b.id] ? 1 : 0;
        if (aTier !== bTier) return bTier - aTier;
        return a.nickname.localeCompare(b.nickname, 'zh-CN');
      });
  }, [assignableUsers, memberTiers, query]);

  const selectedUser = onlineUsers.find((user) => user.id === selectedUserId) || null;
  const previewNickname = selectedUser?.nickname || '贵宾昵称';
  const previewWelcome = buildWelcomeText(
    normalizeWelcomeTemplateId(settingsDraft.welcomeTemplateId),
    settingsDraft.welcomeCustomText || '',
    draft.badgeLabel,
    previewNickname,
  );
  const selectableColors = getSelectableBadgeColorPresets();

  if (!open) return null;

  const selectUser = (userId: string) => {
    setSelectedUserId(userId);
    setDraft(buildDraftFromTier(memberTiers[userId]));
  };

  const handleSaveTier = () => {
    if (!selectedUserId) return;
    onSaveTier(selectedUserId, {
      badgeLabel: draft.badgeLabel.trim().slice(0, 8) || '贵宾',
      badgeColor: normalizeBadgeColor(draft.badgeColor),
      borderStyleId: MEMBER_BORDER_STYLE_ID,
      borderColor: normalizeBadgeColor(draft.borderColor),
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative flex max-h-[min(78vh,620px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-netease-dark shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-netease-border/50 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Sparkles className="h-4 w-4 text-amber-300" />
              贵宾角标管理
            </h2>
            <p className="mt-0.5 text-xs text-netease-muted">为在线用户赋予角标，进房欢迎与点歌边框自动生效</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-netease-muted hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-b border-netease-border/60 p-3 lg:border-b-0 lg:border-r">
            <div className="relative mb-2.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-netease-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索在线用户昵称"
                className="w-full rounded-xl border border-netease-border bg-netease-card py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-amber-400/50"
              />
            </div>
            <div className="min-h-0 max-h-[180px] flex-1 space-y-1 overflow-y-auto pr-0.5 lg:max-h-none">
              {assignableUsers.length === 0 ? (
                <p className="py-6 text-center text-xs text-netease-muted">暂无可赋予贵宾身份的在线用户</p>
              ) : onlineUsers.length === 0 ? (
                <p className="py-6 text-center text-xs text-netease-muted">没有匹配的在线用户</p>
              ) : onlineUsers.map((user) => {
                const tier = memberTiers[user.id];
                const active = selectedUserId === user.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => selectUser(user.id)}
                    className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                      active ? 'border-amber-400/50 bg-amber-400/15' : 'border-netease-border bg-netease-card hover:bg-netease-hover'
                    }`}
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 text-xs font-bold text-white">
                      {user.nickname.charAt(0).toUpperCase()}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm text-white">{user.nickname}</p>
                    {tier ? <MemberTierBadge tier={tier} /> : (
                      <span className="rounded-full bg-netease-hover px-2 py-0.5 text-[10px] text-netease-muted">普通</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-3 sm:p-4">
            {!selectedUser ? (
              <div className="flex min-h-[120px] flex-col items-center justify-center py-6 text-center text-netease-muted">
                <UserPlus className="mb-3 h-8 w-8 opacity-50" />
                <p className="text-sm">从左侧选择在线用户</p>
                <p className="mt-1 text-xs">赋予角标后，Ta 进房将收到欢迎消息，点歌将带专属边框</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-netease-border bg-netease-card p-3">
                  <p className="mb-2 text-xs text-netease-muted">预览 · {selectedUser.nickname}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <MemberTierBadge tier={draft} />
                    <span className="text-sm text-white">{selectedUser.nickname}</span>
                  </div>
                  <div className="mt-3">
                    <MemberQueueFrame tier={draft} variant="preview" innerClassName="bg-netease-card px-3 py-2">
                      <p className="text-sm font-medium text-white">示例歌曲 · 点歌边框预览</p>
                      <p className="text-xs text-netease-muted">Ta 点的歌会在队列中展示此边框</p>
                    </MemberQueueFrame>
                  </div>
                </div>

                <section className="space-y-2">
                  <label className="text-xs font-medium text-netease-muted">角标名称</label>
                  <input
                    value={draft.badgeLabel}
                    onChange={(event) => setDraft((prev) => ({ ...prev, badgeLabel: event.target.value.slice(0, 8) }))}
                    maxLength={8}
                    placeholder="如：赞助、老铁、VIP"
                    className="w-full rounded-xl border border-netease-border bg-netease-card px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {BADGE_LABEL_PRESETS.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, badgeLabel: label }))}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          draft.badgeLabel === label
                            ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                            : 'border-netease-border bg-netease-card text-netease-muted hover:border-white/20 hover:text-white'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <label className="text-xs font-medium text-netease-muted">角标颜色</label>
                  <div className="flex flex-wrap gap-2">
                    {selectableColors.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, badgeColor: preset.color }))}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-transform ${
                          normalizeBadgeColor(draft.badgeColor) === preset.color ? 'ring-2 ring-white/70 scale-105' : ''
                        }`}
                        style={{ backgroundColor: preset.color, color: '#111' }}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <label className="text-xs font-medium text-netease-muted">边框颜色</label>
                  <div className="flex flex-wrap gap-2">
                    {selectableColors.map((preset) => (
                      <button
                        key={`border-${preset.id}`}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, borderColor: preset.color }))}
                        className={`h-8 w-8 rounded-full border-2 transition-transform ${
                          normalizeBadgeColor(draft.borderColor) === preset.color ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: preset.color }}
                        aria-label={preset.name}
                      />
                    ))}
                  </div>
                </section>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveTier}
                    className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
                  >
                    保存角标
                  </button>
                  {memberTiers[selectedUser.id] && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => onRemoveTier(selectedUser.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      移除贵宾
                    </button>
                  )}
                </div>
              </div>
            )}

            <section className="mt-4 space-y-2.5 border-t border-netease-border/60 pt-4">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-300" />
                <h3 className="text-sm font-medium text-white">进房欢迎语（聊天室展示）</h3>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-netease-border bg-netease-card px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-white">进房欢迎消息</p>
                  <p className="mt-0.5 text-xs text-netease-muted">贵宾进房时在聊天室发送欢迎消息</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settingsDraft.welcomeEnabled}
                  disabled={saving}
                  onClick={() => setSettingsDraft((prev) => ({ ...prev, welcomeEnabled: !prev.welcomeEnabled }))}
                  className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    settingsDraft.welcomeEnabled ? 'bg-amber-500' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      settingsDraft.welcomeEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {WELCOME_TEMPLATE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSettingsDraft((prev) => ({ ...prev, welcomeTemplateId: preset.id }))}
                    className={`rounded-xl border px-3 py-2 text-left ${
                      settingsDraft.welcomeTemplateId === preset.id
                        ? 'border-amber-400/50 bg-amber-400/15'
                        : 'border-netease-border bg-netease-card hover:bg-netease-hover'
                    }`}
                  >
                    <p className="text-sm font-medium text-white">{preset.name}</p>
                    <p className="text-[11px] text-netease-muted">{preset.preview}</p>
                  </button>
                ))}
              </div>
              {settingsDraft.welcomeTemplateId === 'custom' && (
                <textarea
                  value={settingsDraft.welcomeCustomText || ''}
                  onChange={(event) => setSettingsDraft((prev) => ({ ...prev, welcomeCustomText: event.target.value.slice(0, 200) }))}
                  rows={2}
                  placeholder="支持 {badge} 与 {nickname} 占位符"
                  className="w-full rounded-xl border border-netease-border bg-netease-card px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              )}
              <div className="rounded-xl border border-netease-border bg-netease-card px-4 py-3">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-amber-300/80">欢迎预览</p>
                <p className="text-sm leading-6 text-white/95">{previewWelcome}</p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => onSaveSettings({
                  welcomeEnabled: settingsDraft.welcomeEnabled,
                  welcomeTemplateId: normalizeWelcomeTemplateId(settingsDraft.welcomeTemplateId),
                  welcomeCustomText: settingsDraft.welcomeCustomText?.trim() || '',
                })}
                className="rounded-xl border border-netease-border px-4 py-2 text-sm text-white hover:bg-netease-hover disabled:opacity-50"
              >
                保存欢迎设置
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
