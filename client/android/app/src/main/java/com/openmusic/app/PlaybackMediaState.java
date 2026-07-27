package com.openmusic.app;

import android.graphics.Bitmap;
import android.os.SystemClock;

/**
 * 前端同步过来的当前曲目状态，供前台媒体通知 / MediaSession 使用。
 * 播放中由原生按锚点外推进度，避免 WebView 后台节流导致进度条「前进又回跳」。
 */
public final class PlaybackMediaState {
    private static final PlaybackMediaState INSTANCE = new PlaybackMediaState();
    /** 小于此漂移的进度回写视为噪声，忽略（毫秒） */
    private static final long POSITION_CORRECT_THRESHOLD_MS = 2000;

    private String title = "OpenMusic";
    private String artist = "";
    private String album = "OpenMusic";
    private String artworkUrl = "";
    private Bitmap artwork;
    private boolean playing;
    private boolean hasTrack;
    private long durationMs;
    private long positionMs;
    /** SystemClock.elapsedRealtime()，与 positionMs 成对，供 MediaSession setState 外推 */
    private long positionAnchorElapsedMs;
    /** 有暂停/播放权限且房间允许系统播放键 */
    private boolean playBound = false;
    /** 有拖进度权限（通知栏「上一首」= 回退 / scrub） */
    private boolean prevBound = false;
    /** 有切歌权限且房间允许系统切歌键 */
    private boolean nextBound = false;
    /** 曲目/控件/播放图标等变化时需要重绘通知 */
    private boolean notificationDirty = true;

    private PlaybackMediaState() {}

    public static PlaybackMediaState get() {
        return INSTANCE;
    }

    public synchronized void setTrack(
        String title,
        String artist,
        String album,
        String artworkUrl,
        boolean hasTrack
    ) {
        String nextTitle = emptyTo(title, hasTrack ? "未知歌曲" : "OpenMusic");
        String nextArtist = artist != null ? artist : "";
        String nextAlbum = emptyTo(album, "OpenMusic");
        String nextArt = artworkUrl != null ? artworkUrl : "";

        boolean changed = !nextTitle.equals(this.title)
            || !nextArtist.equals(this.artist)
            || !nextAlbum.equals(this.album)
            || !nextArt.equals(this.artworkUrl)
            || this.hasTrack != hasTrack;

        this.title = nextTitle;
        this.artist = nextArtist;
        this.album = nextAlbum;
        if (!nextArt.equals(this.artworkUrl)) {
            this.artwork = null;
        }
        this.artworkUrl = nextArt;
        this.hasTrack = hasTrack;
        if (!hasTrack) {
            this.artwork = null;
            this.artworkUrl = "";
            this.playing = false;
            this.durationMs = 0;
            this.positionMs = 0;
            this.positionAnchorElapsedMs = SystemClock.elapsedRealtime();
            this.playBound = false;
            this.prevBound = false;
            this.nextBound = false;
            changed = true;
        }
        if (changed) notificationDirty = true;
    }

    /**
     * @param forcePosition 切歌/显式 seek/进后台锚点时强制采用传入进度
     * @return 是否发生了任何需同步到 MediaSession 的变更（含纯进度锚点校正）
     */
    public synchronized boolean setPlayback(
        boolean playing,
        long durationMs,
        long positionMs,
        boolean forcePosition
    ) {
        long now = SystemClock.elapsedRealtime();
        long nextDuration = Math.max(0, durationMs);
        long incoming = Math.max(0, positionMs);
        if (nextDuration > 0) {
            incoming = Math.min(incoming, nextDuration);
        }

        boolean wasPlaying = this.playing;
        boolean nextPlaying = playing && hasTrack;
        boolean sessionChanged = false;

        // 暂停：冻结外推位置（忽略滞后 JS 时间），并重绘暂停图标
        if (wasPlaying && !nextPlaying) {
            this.positionMs = forcePosition ? incoming : getExtrapolatedPositionMsUnlocked(now);
            this.positionAnchorElapsedMs = now;
            this.playing = false;
            if (nextDuration > 0) this.durationMs = nextDuration;
            notificationDirty = true;
            return true;
        }

        if (nextDuration > 0 && nextDuration != this.durationMs) {
            this.durationMs = nextDuration;
            notificationDirty = true;
            sessionChanged = true;
        }

        // 播放中小幅漂移（含滞后回写）忽略，保留锚点继续外推
        if (!forcePosition && wasPlaying && nextPlaying && hasTrack) {
            long extrapolated = getExtrapolatedPositionMsUnlocked(now);
            if (Math.abs(incoming - extrapolated) < POSITION_CORRECT_THRESHOLD_MS) {
                return sessionChanged;
            }
        }

        this.positionMs = incoming;
        if (this.durationMs > 0) {
            this.positionMs = Math.min(this.positionMs, this.durationMs);
        }
        this.positionAnchorElapsedMs = now;
        this.playing = nextPlaying;
        if (wasPlaying != nextPlaying) {
            notificationDirty = true;
        }
        return true;
    }

    /** 兼容旧调用 */
    public synchronized boolean setPlayback(boolean playing, long durationMs, long positionMs) {
        return setPlayback(playing, durationMs, positionMs, false);
    }

    public synchronized void setControls(boolean playBound, boolean prevBound, boolean nextBound) {
        if (this.playBound == playBound && this.prevBound == prevBound && this.nextBound == nextBound) {
            return;
        }
        this.playBound = playBound;
        this.prevBound = prevBound;
        this.nextBound = nextBound;
        notificationDirty = true;
    }

    public synchronized void setArtwork(Bitmap bitmap, String forUrl) {
        if (bitmap == null) {
            if (forUrl == null || forUrl.isEmpty() || forUrl.equals(this.artworkUrl)) {
                if (this.artwork != null) {
                    this.artwork = null;
                    notificationDirty = true;
                }
            }
            return;
        }
        if (forUrl == null || !forUrl.equals(this.artworkUrl)) return;
        this.artwork = bitmap;
        notificationDirty = true;
    }

    /** 强制下次 refresh 重绘通知（如服务刚 startForeground） */
    public synchronized void invalidateNotificationFingerprint() {
        notificationDirty = true;
    }

    /** @return 是否需要重绘通知；调用后清除脏标记 */
    public synchronized boolean takeNotificationDirty() {
        if (!notificationDirty) return false;
        notificationDirty = false;
        return true;
    }

    public synchronized String getTitle() { return title; }
    public synchronized String getArtist() { return artist; }
    public synchronized String getAlbum() { return album; }
    public synchronized String getArtworkUrl() { return artworkUrl; }
    public synchronized Bitmap getArtwork() { return artwork; }
    public synchronized boolean isPlaying() { return playing; }
    public synchronized boolean hasTrack() { return hasTrack; }
    public synchronized long getDurationMs() { return durationMs; }

    /**
     * MediaSession setState 用的锚点位置（未外推）。
     * 配合 {@link #getPositionUpdatedAtElapsed()} 与 speed=1，由系统平滑推进进度条。
     */
    public synchronized long getPositionMs() { return positionMs; }

    /** 与 getPositionMs 配对的 elapsedRealtime 锚点 */
    public synchronized long getPositionUpdatedAtElapsed() {
        return positionAnchorElapsedMs;
    }

    /** 当前外推后的进度（JS 未传 position 时沿用） */
    public synchronized long getExtrapolatedPositionMs() {
        return getExtrapolatedPositionMsUnlocked(SystemClock.elapsedRealtime());
    }

    public synchronized boolean isPlayBound() { return playBound; }
    public synchronized boolean isPrevBound() { return prevBound; }
    public synchronized boolean isNextBound() { return nextBound; }

    private long getExtrapolatedPositionMsUnlocked(long nowElapsed) {
        long pos = positionMs;
        if (playing && positionAnchorElapsedMs > 0) {
            pos += (nowElapsed - positionAnchorElapsedMs);
        }
        if (durationMs > 0) {
            pos = Math.min(pos, durationMs);
        }
        return Math.max(0, pos);
    }

    private static String emptyTo(String value, String fallback) {
        if (value == null) return fallback;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }
}
