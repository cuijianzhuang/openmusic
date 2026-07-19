import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, MicOff } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { ChatMessage, ChatReplyRef, RoomUser } from '../types';
import { isChatMutedForUser } from '../lib/chatMute';
import { getClientId } from '../lib/clientId';
import Tooltip from './Tooltip';
import { usePureModeStore } from '../stores/pureModeStore';
import { ChatReactionPicker } from './ChatMessageReactions';
import ChatImageLightbox from './ChatImageLightbox';
import ChatMessageList, { type ChatMessageListHandle } from './ChatMessageList';
import ChatInputBar, { type ChatInputBarHandle, type PendingChatImage } from './ChatInputBar';
import ChatMutePicker from './ChatMutePicker';
import { compactReplyText } from '../lib/chatPanelUtils';
import { useChatRoomMeta, useChatRoomSlice } from '../lib/chatRoomSlice';
import { fetchChatUploadEnabled } from '../api/chatImage';
import { fetchStickerSearchEnabled } from '../api/stickerSearch';

export default function ChatPanel({ className = '' }: { className?: string }) {
  const chatRoomSlice = useChatRoomSlice();
  const roomMeta = useChatRoomMeta();
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const isOwner = useRoomStore((s) => s.isOwner);
  const isAdmin = useRoomStore((s) => s.isAdmin);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const canModerate = isOwner || isAdmin;
  const { sendChat, recallChat, setChatMute, loadChatHistory, toggleChatReaction } = useSocket();

  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [showMutePicker, setShowMutePicker] = useState(false);
  const [muteSaving, setMuteSaving] = useState(false);
  const [muteError, setMuteError] = useState('');
  const [chatUploadEnabled, setChatUploadEnabled] = useState(false);
  const [stickerSearchEnabled, setStickerSearchEnabled] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingChatImage | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [chatScrollRoot, setChatScrollRoot] = useState<HTMLDivElement | null>(null);

  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatOverlayHostRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<ChatMessageListHandle>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const isMobileLayout = useMediaQuery('(max-width: 1023px)');
  const pureMode = usePureModeStore((s) => s.enabled);

  const myUserId = mySocketId || getClientId();
  const chatMuted = chatRoomSlice ? isChatMutedForUser(chatRoomSlice, myUserId) : false;

  useEffect(() => {
    void fetchChatUploadEnabled().then(setChatUploadEnabled);
    void fetchStickerSearchEnabled().then(setStickerSearchEnabled);
  }, []);

  useEffect(() => {
    if (!chatRoomSlice?.id) return;
    setReplyTo(null);
    setPendingImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setReactionPickerMessageId(null);
  }, [chatRoomSlice?.id]);

  useEffect(() => {
    if (!showMutePicker) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMutePicker(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showMutePicker]);

  const handleStickToBottom = useCallback(() => {
    messageListRef.current?.stickToBottom();
  }, []);

  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyTo({
      id: msg.id,
      userId: msg.userId,
      nickname: msg.nickname,
      text: compactReplyText(msg.text, msg.imageUrl, msg.imageKey, msg.asSticker),
      imageUrl: msg.imageUrl?.startsWith('data:') ? null : (msg.imageUrl || null),
      imageKey: msg.imageKey || null,
      asSticker: Boolean(msg.asSticker || (msg.imageKey && msg.imageKey.startsWith('local-sticker:'))),
    });
    const isSelf = msg.userId === mySocketId || msg.nickname === nickname;
    if (!isSelf) {
      inputBarRef.current?.applyReplyMention(msg.nickname);
      return;
    }
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [mySocketId, nickname]);

  const handleMentionUser = useCallback((user: RoomUser) => {
    inputBarRef.current?.applyReplyMention(user.nickname);
  }, []);

  const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const res = await toggleChatReaction(messageId, emoji);
    if (!res.success && res.error) {
      setMuteError(res.error);
    }
  }, [toggleChatReaction]);

  const handleRecall = useCallback(async (msg: ChatMessage) => {
    const res = await recallChat(msg.id);
    if (!res.success && res.error) {
      setMuteError(res.error);
    }
  }, [recallChat]);

  const handlePendingImageChange = useCallback((image: PendingChatImage | null) => {
    setPendingImage((current) => {
      if (current?.previewUrl && current.previewUrl !== image?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return image;
    });
  }, []);

  const toggleMuteAll = async () => {
    if (muteSaving || !chatRoomSlice) return;
    setMuteSaving(true);
    const res = await setChatMute({ muteAll: !chatRoomSlice.muteAll });
    setMuteSaving(false);
    if (!res.success) setMuteError(res.error || '操作失败');
  };

  const toggleUserMute = async (user: RoomUser) => {
    if (muteSaving || user.id === myUserId || !chatRoomSlice) return;
    setMuteSaving(true);
    const muted = !(chatRoomSlice.mutedUserIds || []).includes(user.id);
    const res = await setChatMute({ userId: user.id, muted });
    setMuteSaving(false);
    if (!res.success) setMuteError(res.error || '操作失败');
  };

  if (!chatRoomSlice || !roomMeta) return null;

  const desktopMutePickerPortal = showMutePicker && !isMobileLayout && chatPanelRef.current ? (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-3">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        onClick={() => setShowMutePicker(false)}
        aria-label="关闭禁言管理"
      />
      <div className="relative z-10 flex w-[min(320px,92%)] max-h-[min(72%,360px)] flex-col rounded-2xl border border-white/10 glass p-4 shadow-2xl animate-fade-in">
        <ChatMutePicker
          slice={chatRoomSlice}
          myUserId={myUserId}
          muteSaving={muteSaving}
          onClose={() => setShowMutePicker(false)}
          onToggleMuteAll={() => { void toggleMuteAll(); }}
          onToggleUserMute={(user) => { void toggleUserMute(user); }}
        />
      </div>
    </div>
  ) : null;

  const mobileMutePickerPortal = showMutePicker && isMobileLayout ? (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setShowMutePicker(false)}
        aria-label="关闭禁言管理"
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[min(75vh,480px)] flex-col rounded-t-2xl border-t border-white/10 glass p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl animate-fade-in">
        <ChatMutePicker
          slice={chatRoomSlice}
          myUserId={myUserId}
          muteSaving={muteSaving}
          onClose={() => setShowMutePicker(false)}
          onToggleMuteAll={() => { void toggleMuteAll(); }}
          onToggleUserMute={(user) => { void toggleUserMute(user); }}
        />
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={chatPanelRef}
      className={`surface-panel relative flex h-full flex-col overflow-hidden rounded-2xl ${className}`}
      onContextMenu={(event) => {
        // 空白区域：禁用浏览器默认菜单；消息体自行 stopPropagation 并弹出自定义菜单
        event.preventDefault();
      }}
    >
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-netease-border/50 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle className="h-4 w-4 text-netease-muted" />
          <h3 className="text-sm font-medium">聊天室</h3>
          {chatRoomSlice.muteAll && (
            <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400/90">全体禁言</span>
          )}
        </div>
        {canModerate && (
          <Tooltip side="bottom" content="禁言管理">
            <button
              type="button"
              onClick={() => setShowMutePicker(true)}
              className="rounded-lg p-1.5 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
              aria-label="禁言管理"
            >
              <MicOff className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>

      {muteError && (
        <p className="flex-shrink-0 px-3 py-1 text-xs text-netease-red">{muteError}</p>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatMessageList
          ref={messageListRef}
          roomMeta={roomMeta}
          myUserId={myUserId}
          mySocketId={mySocketId}
          nickname={nickname}
          pureMode={pureMode}
          chatMuted={chatMuted}
          canModerate={canModerate}
          chatPanelRef={chatPanelRef}
          reactionPickerMessageId={reactionPickerMessageId}
          onReactionPickerChange={setReactionPickerMessageId}
          onReply={handleReply}
          onRecall={handleRecall}
          onMentionUser={handleMentionUser}
          onToggleReaction={handleToggleReaction}
          onPreviewImage={setPreviewImageUrl}
          loadChatHistory={loadChatHistory}
          onScrollRootChange={setChatScrollRoot}
        />
      </div>

      <div ref={chatOverlayHostRef} className="pointer-events-none absolute inset-0 z-30" />

      <ChatReactionPicker
        open={reactionPickerMessageId !== null}
        disabled={chatMuted}
        scrollRoot={chatScrollRoot}
        containerRef={chatPanelRef}
        overlayHostRef={chatOverlayHostRef}
        onClose={() => setReactionPickerMessageId(null)}
        onPick={(emoji) => {
          if (reactionPickerMessageId) {
            void handleToggleReaction(reactionPickerMessageId, emoji);
          }
        }}
      />

      <ChatInputBar
        ref={inputBarRef}
        roomMeta={roomMeta}
        nickname={nickname}
        mySocketId={mySocketId}
        canControlPlayback={canControlPlayback}
        chatMuted={chatMuted}
        chatUploadEnabled={chatUploadEnabled}
        stickerSearchEnabled={stickerSearchEnabled}
        isMobileLayout={isMobileLayout}
        replyTo={replyTo}
        onReplyChange={setReplyTo}
        pendingImage={pendingImage}
        onPendingImageChange={handlePendingImageChange}
        chatScrollRoot={chatScrollRoot}
        sendChat={sendChat}
        onStickToBottom={handleStickToBottom}
        onPreviewImage={setPreviewImageUrl}
      />

      {desktopMutePickerPortal && createPortal(desktopMutePickerPortal, chatPanelRef.current!)}
      {mobileMutePickerPortal && createPortal(mobileMutePickerPortal, document.body)}

      <ChatImageLightbox
        imageUrl={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    </div>
  );
}
