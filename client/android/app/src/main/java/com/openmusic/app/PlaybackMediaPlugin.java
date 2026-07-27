package com.openmusic.app;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 把 Web 端曲目信息同步到原生媒体通知栏，并把通知栏/耳机键操作回传给前端。
 */
@CapacitorPlugin(name = "PlaybackMedia")
public class PlaybackMediaPlugin extends Plugin {
    private static PlaybackMediaPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    public static void emitAction(String action) {
        PlaybackMediaPlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        // 用户从系统媒体控件触发，前端不得按「后台保房」忽略
        data.put("fromUserControl", true);
        plugin.notifyListeners("mediaAction", data, true);
    }

    public static void emitSeek(double positionSec) {
        PlaybackMediaPlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("action", "seekto");
        data.put("positionSec", positionSec);
        data.put("fromUserControl", true);
        plugin.notifyListeners("mediaAction", data, true);
    }

    /** 其它 App 抢走音频焦点 */
    public static void emitAudioFocusLoss() {
        PlaybackMediaPlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("action", "audiofocusloss");
        plugin.notifyListeners("mediaAction", data, true);
    }

    /** 重新获得音频焦点（无暂停权限时仅恢复本机播放） */
    public static void emitAudioFocusGain() {
        PlaybackMediaPlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("action", "audiofocusgain");
        plugin.notifyListeners("mediaAction", data, true);
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        Context context = resolveContext();
        PlaybackMediaState state = PlaybackMediaState.get();
        boolean hasTrack = Boolean.TRUE.equals(call.getBoolean("hasTrack", false));
        state.setTrack(
            call.getString("title"),
            call.getString("artist"),
            call.getString("album"),
            call.getString("artworkUrl"),
            hasTrack
        );
        Boolean playBound = call.getBoolean("playBound");
        Boolean prevBound = call.getBoolean("prevBound");
        Boolean nextBound = call.getBoolean("nextBound");
        Boolean skipBound = call.getBoolean("skipBound");
        if (playBound != null || prevBound != null || nextBound != null || skipBound != null) {
            boolean play = playBound == null || playBound;
            boolean prev = prevBound != null ? prevBound : (skipBound == null || skipBound);
            boolean next = nextBound != null ? nextBound : (skipBound == null || skipBound);
            state.setControls(play, prev, next);
        }
        Boolean playing = call.getBoolean("playing");
        Double durationSec = call.getDouble("durationSec");
        Double positionSec = call.getDouble("positionSec");
        if (playing != null || durationSec != null || positionSec != null) {
            long posMs = positionSec != null
                ? Math.round(positionSec * 1000)
                : state.getExtrapolatedPositionMs();
            // 元数据同步视为权威锚点（切歌 / 权限 / 封面）
            state.setPlayback(
                playing != null && playing,
                durationSec != null ? Math.round(durationSec * 1000) : state.getDurationMs(),
                posMs,
                true
            );
        }
        PlaybackKeepAliveService.refresh(context);
        PlaybackKeepAliveService.loadArtworkAsync(context, state.getArtworkUrl());
        PlaybackAudioFocus.get(context).syncWithState();
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        PlaybackMediaState state = PlaybackMediaState.get();
        Boolean playing = call.getBoolean("playing");
        Double durationSec = call.getDouble("durationSec");
        Double positionSec = call.getDouble("positionSec");
        boolean forcePosition = Boolean.TRUE.equals(call.getBoolean("forcePosition", false));
        boolean wasPlaying = state.isPlaying();
        boolean nextPlaying = playing != null ? playing : wasPlaying;

        long nextDurationMs = durationSec != null
            ? Math.round(durationSec * 1000)
            : state.getDurationMs();
        long nextPositionMs = positionSec != null
            ? Math.round(positionSec * 1000)
            : state.getExtrapolatedPositionMs();

        boolean changed = state.setPlayback(
            nextPlaying,
            nextDurationMs,
            nextPositionMs,
            forcePosition
        );

        if (changed) {
            if (wasPlaying != state.isPlaying()) {
                PlaybackKeepAliveService.refresh(resolveContext());
            } else {
                PlaybackKeepAliveService.refreshPlaybackStateOnly(resolveContext());
            }
        }
        PlaybackAudioFocus.get(resolveContext()).syncWithState();
        call.resolve();
    }

    @PluginMethod
    public void setControls(PluginCall call) {
        Boolean playBound = call.getBoolean("playBound");
        Boolean prevBound = call.getBoolean("prevBound");
        Boolean nextBound = call.getBoolean("nextBound");
        Boolean skipBound = call.getBoolean("skipBound");
        PlaybackMediaState state = PlaybackMediaState.get();
        boolean play = playBound != null ? playBound : state.isPlayBound();
        boolean prev = prevBound != null
            ? prevBound
            : (skipBound != null ? skipBound : state.isPrevBound());
        boolean next = nextBound != null
            ? nextBound
            : (skipBound != null ? skipBound : state.isNextBound());
        state.setControls(play, prev, next);
        PlaybackKeepAliveService.refresh(resolveContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        PlaybackMediaState.get().setTrack("OpenMusic", "", "OpenMusic", "", false);
        PlaybackMediaState.get().setPlayback(false, 0, 0, true);
        PlaybackKeepAliveService.refresh(resolveContext());
        PlaybackAudioFocus.get(resolveContext()).syncWithState();
        call.resolve();
    }

    private Context resolveContext() {
        if (getActivity() != null) return getActivity();
        if (getBridge() != null) return getBridge().getContext();
        return null;
    }
}
