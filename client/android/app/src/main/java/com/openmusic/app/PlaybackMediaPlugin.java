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
        // 兼容旧字段 skipBound：同时控制上一首/下一首
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
            state.setPlayback(
                playing != null && playing,
                durationSec != null ? Math.round(durationSec * 1000) : state.getDurationMs(),
                positionSec != null ? Math.round(positionSec * 1000) : state.getPositionMs()
            );
        }
        PlaybackKeepAliveService.refresh(context);
        PlaybackKeepAliveService.loadArtworkAsync(context, state.getArtworkUrl());
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        PlaybackMediaState state = PlaybackMediaState.get();
        Boolean playing = call.getBoolean("playing");
        Double durationSec = call.getDouble("durationSec");
        Double positionSec = call.getDouble("positionSec");
        state.setPlayback(
            playing != null && playing,
            durationSec != null ? Math.round(durationSec * 1000) : state.getDurationMs(),
            positionSec != null ? Math.round(positionSec * 1000) : state.getPositionMs()
        );
        PlaybackKeepAliveService.refresh(resolveContext());
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
        PlaybackMediaState.get().setPlayback(false, 0, 0);
        PlaybackKeepAliveService.refresh(resolveContext());
        call.resolve();
    }

    private Context resolveContext() {
        if (getActivity() != null) return getActivity();
        if (getBridge() != null) return getBridge().getContext();
        return null;
    }
}
