package com.openmusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 媒体前台服务：息屏/切后台保活，并展示 QQ 音乐风格的系统媒体通知栏
 *（封面 / 歌名 / 播放暂停 / 切歌）。
 */
public class PlaybackKeepAliveService extends Service {
    public static final String ACTION_START = "com.openmusic.app.KEEPALIVE_START";
    public static final String ACTION_STOP = "com.openmusic.app.KEEPALIVE_STOP";
    public static final String ACTION_PLAY = "com.openmusic.app.MEDIA_PLAY";
    public static final String ACTION_PAUSE = "com.openmusic.app.MEDIA_PAUSE";
    public static final String ACTION_NEXT = "com.openmusic.app.MEDIA_NEXT";
    public static final String ACTION_PREV = "com.openmusic.app.MEDIA_PREV";

    private static final String CHANNEL_ID = "openmusic_playback";
    private static final int NOTIFICATION_ID = 1001;
    private static final AtomicReference<PlaybackKeepAliveService> RUNNING = new AtomicReference<>();
    private static final ExecutorService ARTWORK_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicReference<String> LOADING_ARTWORK_URL = new AtomicReference<>("");

    private MediaSessionCompat mediaSession;
    private boolean startedAsForeground;

    public static void start(Context context) {
        if (context == null) return;
        Intent intent = new Intent(context, PlaybackKeepAliveService.class);
        intent.setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        if (context == null) return;
        context.stopService(new Intent(context, PlaybackKeepAliveService.class));
    }

    /** 曲目/进度变更时刷新已在跑的前台通知 */
    public static void refresh(Context context) {
        PlaybackKeepAliveService running = RUNNING.get();
        if (running != null) {
            running.updateNotificationAndSession();
        }
    }

    public static void loadArtworkAsync(Context context, String artworkUrl) {
        if (context == null) return;
        final String url = artworkUrl == null ? "" : artworkUrl.trim();
        if (url.isEmpty()) {
            PlaybackMediaState.get().setArtwork(null, "");
            refresh(context);
            return;
        }
        LOADING_ARTWORK_URL.set(url);
        final Context app = context.getApplicationContext();
        ARTWORK_EXECUTOR.execute(() -> {
            if (!url.equals(LOADING_ARTWORK_URL.get())) return;
            Bitmap bitmap = downloadArtwork(url);
            if (!url.equals(LOADING_ARTWORK_URL.get())) return;
            if (bitmap != null) {
                PlaybackMediaState.get().setArtwork(bitmap, url);
            }
            refresh(app);
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        mediaSession = new MediaSessionCompat(this, "OpenMusicPlayback");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                if (!PlaybackMediaState.get().isPlayBound()) return;
                PlaybackMediaPlugin.emitAction("play");
            }

            @Override
            public void onPause() {
                if (!PlaybackMediaState.get().isPlayBound()) return;
                PlaybackMediaPlugin.emitAction("pause");
            }

            @Override
            public void onSkipToNext() {
                if (!PlaybackMediaState.get().isNextBound()) return;
                PlaybackMediaPlugin.emitAction("nexttrack");
            }

            @Override
            public void onSkipToPrevious() {
                if (!PlaybackMediaState.get().isPrevBound()) return;
                PlaybackMediaPlugin.emitAction("previoustrack");
            }

            @Override
            public void onStop() {
                if (!PlaybackMediaState.get().isPlayBound()) return;
                PlaybackMediaPlugin.emitAction("pause");
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_PLAY.equals(action)) {
            if (PlaybackMediaState.get().isPlayBound()) {
                PlaybackMediaPlugin.emitAction("play");
            }
            return START_STICKY;
        }
        if (ACTION_PAUSE.equals(action)) {
            if (PlaybackMediaState.get().isPlayBound()) {
                PlaybackMediaPlugin.emitAction("pause");
            }
            return START_STICKY;
        }
        if (ACTION_NEXT.equals(action)) {
            if (PlaybackMediaState.get().isNextBound()) {
                PlaybackMediaPlugin.emitAction("nexttrack");
            }
            return START_STICKY;
        }
        if (ACTION_PREV.equals(action)) {
            if (PlaybackMediaState.get().isPrevBound()) {
                PlaybackMediaPlugin.emitAction("previoustrack");
            }
            return START_STICKY;
        }

        RUNNING.set(this);
        ensureChannel();
        updateMediaSession();
        Notification notification = buildNotification();
        if (!startedAsForeground) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            startedAsForeground = true;
        } else {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(NOTIFICATION_ID, notification);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        RUNNING.compareAndSet(this, null);
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        startedAsForeground = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void updateNotificationAndSession() {
        if (!startedAsForeground) return;
        updateMediaSession();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.keepalive_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.keepalive_channel_desc));
        channel.setShowBadge(false);
        channel.setSound(null, null);
        nm.createNotificationChannel(channel);
    }

    private void updateMediaSession() {
        if (mediaSession == null) return;
        PlaybackMediaState state = PlaybackMediaState.get();

        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, state.getTitle())
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, state.getArtist())
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, state.getAlbum());
        if (state.getDurationMs() > 0) {
            meta.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, state.getDurationMs());
        }
        Bitmap art = state.getArtwork();
        if (art != null) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art);
        }
        mediaSession.setMetadata(meta.build());

        long actions = 0;
        if (state.isPlayBound()) {
            actions |= PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_STOP;
        }
        if (state.isNextBound()) {
            actions |= PlaybackStateCompat.ACTION_SKIP_TO_NEXT;
        }
        if (state.isPrevBound()) {
            actions |= PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;
        }

        int pbState = state.isPlaying()
            ? PlaybackStateCompat.STATE_PLAYING
            : (state.hasTrack() ? PlaybackStateCompat.STATE_PAUSED : PlaybackStateCompat.STATE_NONE);

        mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(pbState, state.getPositionMs(), state.isPlaying() ? 1f : 0f)
            .build());
    }

    private Notification buildNotification() {
        PlaybackMediaState state = PlaybackMediaState.get();

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = null;
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            contentIntent = PendingIntent.getActivity(
                this,
                0,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        String title = state.hasTrack() ? state.getTitle() : getString(R.string.keepalive_title);
        String text = state.hasTrack()
            ? (state.getArtist().isEmpty() ? getString(R.string.keepalive_text) : state.getArtist())
            : getString(R.string.keepalive_text);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_openmusic)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSilent(true);

        Bitmap art = state.getArtwork();
        if (art != null) {
            builder.setLargeIcon(art);
        }

        // 顺序对齐常见音乐 App：上一首 | 播放/暂停 | 下一首（无权限则不展示）
        List<Integer> compact = new ArrayList<>();
        if (state.isPrevBound()) {
            builder.addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_previous,
                getString(R.string.media_action_prev),
                actionPendingIntent(ACTION_PREV, 3)
            ));
            compact.add(compact.size());
        }

        if (state.isPlayBound()) {
            if (state.isPlaying()) {
                builder.addAction(new NotificationCompat.Action(
                    android.R.drawable.ic_media_pause,
                    getString(R.string.media_action_pause),
                    actionPendingIntent(ACTION_PAUSE, 2)
                ));
            } else {
                builder.addAction(new NotificationCompat.Action(
                    android.R.drawable.ic_media_play,
                    getString(R.string.media_action_play),
                    actionPendingIntent(ACTION_PLAY, 1)
                ));
            }
            compact.add(compact.size());
        }

        if (state.isNextBound()) {
            builder.addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_next,
                getString(R.string.media_action_next),
                actionPendingIntent(ACTION_NEXT, 4)
            ));
            compact.add(compact.size());
        }

        if (!compact.isEmpty() && mediaSession != null) {
            int[] compactArr = new int[compact.size()];
            for (int i = 0; i < compact.size(); i++) compactArr[i] = compact.get(i);

            MediaStyle style = new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(compactArr)
                .setShowCancelButton(false);
            builder.setStyle(style);
        } else if (mediaSession != null) {
            builder.setStyle(new MediaStyle().setMediaSession(mediaSession.getSessionToken()));
        }

        return builder.build();
    }

    private PendingIntent actionPendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, PlaybackKeepAliveService.class);
        intent.setAction(action);
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static Bitmap downloadArtwork(String artworkUrl) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(artworkUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(8000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (InputStream in = conn.getInputStream()) {
                Bitmap raw = BitmapFactory.decodeStream(in);
                if (raw == null) return null;
                int max = 512;
                int w = raw.getWidth();
                int h = raw.getHeight();
                if (w <= max && h <= max) return raw;
                float scale = Math.min((float) max / w, (float) max / h);
                int nw = Math.max(1, Math.round(w * scale));
                int nh = Math.max(1, Math.round(h * scale));
                Bitmap scaled = Bitmap.createScaledBitmap(raw, nw, nh, true);
                if (scaled != raw) raw.recycle();
                return scaled;
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
