package com.openmusic.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.SystemClock;

/**
 * 监听系统音频焦点：其它 App 抢焦点时通知前端暂停（勿仅静音/duck）。
 * 前台/后台均有效（不依赖前台服务是否运行）。
 */
public final class PlaybackAudioFocus {
    private static PlaybackAudioFocus instance;

    private static final long FOCUS_LOSS_DEBOUNCE_MS = 600;

    private final Context appContext;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private boolean hasAudioFocus = false;
    private long lastFocusLossEmitMs = 0;

    private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                hasAudioFocus = false;
                onExternalAudioFocusLost();
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
            case AudioManager.AUDIOFOCUS_GAIN_TRANSIENT:
            case AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK:
                hasAudioFocus = true;
                PlaybackMediaPlugin.emitAudioFocusGain();
                break;
            default:
                break;
        }
    };

    private PlaybackAudioFocus(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public static PlaybackAudioFocus get(Context context) {
        if (instance == null) {
            instance = new PlaybackAudioFocus(context);
        }
        return instance;
    }

    /** 按当前 PlaybackMediaState 申请/释放焦点 */
    public void syncWithState() {
        PlaybackMediaState state = PlaybackMediaState.get();
        updateWantFocus(state.isPlaying() && state.hasTrack());
    }

    public void updateWantFocus(boolean wantFocus) {
        if (audioManager == null) {
            audioManager = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
        }
        if (audioManager == null) return;

        if (wantFocus) {
            if (hasAudioFocus) return;
            int result;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequest == null) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build();
                    audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(attrs)
                        .setAcceptsDelayedFocusGain(true)
                        .setOnAudioFocusChangeListener(focusListener)
                        .build();
                }
                result = audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                result = audioManager.requestAudioFocus(
                    focusListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
                );
            }
            hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else if (hasAudioFocus) {
            abandonFocus();
        }
    }

    public void release() {
        abandonFocus();
        instance = null;
    }

    private void abandonFocus() {
        if (audioManager == null || !hasAudioFocus) {
            hasAudioFocus = false;
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(focusListener);
        }
        hasAudioFocus = false;
    }

    private void onExternalAudioFocusLost() {
        PlaybackMediaState state = PlaybackMediaState.get();
        if (!state.hasTrack() || !state.isPlaying()) return;

        long now = SystemClock.elapsedRealtime();
        if (now - lastFocusLossEmitMs < FOCUS_LOSS_DEBOUNCE_MS) return;
        lastFocusLossEmitMs = now;

        state.setPlayback(
            false,
            state.getDurationMs(),
            state.getExtrapolatedPositionMs(),
            true
        );
        PlaybackKeepAliveService.refresh(appContext);
        PlaybackMediaPlugin.emitAudioFocusLoss();
    }
}
