package com.openmusic.app;

import android.graphics.Bitmap;

/**
 * 前端同步过来的当前曲目状态，供前台媒体通知 / MediaSession 使用。
 */
public final class PlaybackMediaState {
    private static final PlaybackMediaState INSTANCE = new PlaybackMediaState();

    private String title = "OpenMusic";
    private String artist = "";
    private String album = "OpenMusic";
    private String artworkUrl = "";
    private Bitmap artwork;
    private boolean playing;
    private boolean hasTrack;
    private long durationMs;
    private long positionMs;
    /** 有暂停/播放权限且房间允许系统播放键 */
    private boolean playBound = false;
    /** 有拖进度权限（通知栏「上一首」= 回退） */
    private boolean prevBound = false;
    /** 有切歌权限且房间允许系统切歌键 */
    private boolean nextBound = false;

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
        this.title = emptyTo(title, hasTrack ? "未知歌曲" : "OpenMusic");
        this.artist = artist != null ? artist : "";
        this.album = emptyTo(album, "OpenMusic");
        String nextArt = artworkUrl != null ? artworkUrl : "";
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
            this.playBound = false;
            this.prevBound = false;
            this.nextBound = false;
        }
    }

    public synchronized void setPlayback(boolean playing, long durationMs, long positionMs) {
        this.playing = playing && hasTrack;
        this.durationMs = Math.max(0, durationMs);
        this.positionMs = Math.max(0, positionMs);
        if (this.durationMs > 0) {
            this.positionMs = Math.min(this.positionMs, this.durationMs);
        }
    }

    public synchronized void setControls(boolean playBound, boolean prevBound, boolean nextBound) {
        this.playBound = playBound;
        this.prevBound = prevBound;
        this.nextBound = nextBound;
    }

    public synchronized void setArtwork(Bitmap bitmap, String forUrl) {
        if (bitmap == null) {
            if (forUrl == null || forUrl.isEmpty() || forUrl.equals(this.artworkUrl)) {
                this.artwork = null;
            }
            return;
        }
        if (forUrl == null || !forUrl.equals(this.artworkUrl)) return;
        this.artwork = bitmap;
    }

    public synchronized String getTitle() { return title; }
    public synchronized String getArtist() { return artist; }
    public synchronized String getAlbum() { return album; }
    public synchronized String getArtworkUrl() { return artworkUrl; }
    public synchronized Bitmap getArtwork() { return artwork; }
    public synchronized boolean isPlaying() { return playing; }
    public synchronized boolean hasTrack() { return hasTrack; }
    public synchronized long getDurationMs() { return durationMs; }
    public synchronized long getPositionMs() { return positionMs; }
    public synchronized boolean isPlayBound() { return playBound; }
    public synchronized boolean isPrevBound() { return prevBound; }
    public synchronized boolean isNextBound() { return nextBound; }

    private static String emptyTo(String value, String fallback) {
        if (value == null) return fallback;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }
}
