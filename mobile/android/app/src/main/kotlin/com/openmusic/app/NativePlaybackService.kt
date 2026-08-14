package com.openmusic.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.max

object NativePlaybackBridge {
    @Volatile
    var channel: MethodChannel? = null

    fun dispatch(action: String, time: Long? = null) {
        val payload = mutableMapOf<String, Any>("action" to action)
        if (time != null) payload["time"] = time.toDouble() / 1000.0
        channel?.invokeMethod("playbackAction", payload)
    }
}

class NativePlaybackService : Service() {
    private lateinit var mediaSession: MediaSession
    private var title = "OpenMusic"
    private var artist = ""
    private var playing = false
    private var durationMs = 0L
    private var positionMs = 0L
    private var positionUpdatedAtMs = 0L
    private var canPause = false
    private var canSkip = false
    private var canSeek = false
    private var coverUrl = ""
    private var cover: Bitmap? = null
    private var artworkRequestId = 0L
    private var pendingPlaying: Boolean? = null
    private var pendingPlayingUntilMs = 0L
    private var pendingPositionMs: Long? = null
    private var pendingPositionUntilMs = 0L
    private var lastControlAction = ""
    private var lastControlAtMs = 0L
    private val mainHandler = Handler(Looper.getMainLooper())
    private val artworkExecutor = Executors.newSingleThreadExecutor()
    private val progressTicker = object : Runnable {
        override fun run() {
            if (!playing) return
            publish()
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        mediaSession = MediaSession(this, "OpenMusicPlayback").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = handleControlAction("play")
                override fun onPause() = handleControlAction("pause")
                override fun onSkipToNext() = handleControlAction("next")
                override fun onSeekTo(pos: Long) {
                    if (!canSeek) return
                    setPendingPosition(pos.coerceAtLeast(0L))
                    publish()
                    NativePlaybackBridge.dispatch("seek", pos.coerceAtLeast(0L))
                }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE -> update(intent.extras?.keySet()?.associateWith { intent.extras?.get(it) } ?: emptyMap())
            ACTION_CLEAR -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
                else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
                stopSelf()
            }
            ACTION_PLAY -> handleControlAction("play")
            ACTION_PAUSE -> handleControlAction("pause")
            ACTION_NEXT -> handleControlAction("next")
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        mainHandler.removeCallbacks(progressTicker)
        artworkExecutor.shutdownNow()
        mediaSession.release()
        super.onDestroy()
    }

    private fun update(values: Map<String, Any?>) {
        title = values["title"]?.toString()?.take(160)?.ifBlank { "OpenMusic" } ?: "OpenMusic"
        artist = values["artist"]?.toString()?.take(160).orEmpty()
        val reportedPlaying = values["playing"] == true
        durationMs = secondsToMillis(values["duration"])
        val reportedPositionMs = secondsToMillis(values["position"])
        val now = SystemClock.elapsedRealtime()
        if (pendingPlaying != null) {
            if (reportedPlaying == pendingPlaying || now >= pendingPlayingUntilMs) {
                pendingPlaying = null
            }
        }
        playing = pendingPlaying ?: reportedPlaying
        if (pendingPositionMs != null) {
            if (kotlin.math.abs(reportedPositionMs - pendingPositionMs!!) <= POSITION_ACK_TOLERANCE_MS || now >= pendingPositionUntilMs) {
                pendingPositionMs = null
            }
        }
        positionMs = pendingPositionMs ?: reportedPositionMs
        positionUpdatedAtMs = now
        canPause = values["canPause"] == true
        canSkip = values["canSkip"] == true
        canSeek = values["canSeek"] == true
        val nextCoverUrl = values["cover"]?.toString().orEmpty()
        if (nextCoverUrl != coverUrl) {
            coverUrl = nextCoverUrl
            cover = null
            loadArtwork(nextCoverUrl)
        }
        publish()
    }

    private fun publish() {
        val actions = (if (canPause) PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE else 0L) or
            (if (canSkip) PlaybackState.ACTION_SKIP_TO_NEXT else 0L) or
            (if (canSeek) PlaybackState.ACTION_SEEK_TO else 0L)
        mediaSession.setPlaybackState(
            PlaybackState.Builder()
                .setActions(actions)
                .setState(
                    if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    currentPositionMs(),
                    if (playing) 1f else 0f,
                )
                .build(),
        )
        val metadata = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
        cover?.let {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
            metadata.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, it)
        }
        mediaSession.setMetadata(metadata.build())
        startForeground(NOTIFICATION_ID, buildNotification())
        mainHandler.removeCallbacks(progressTicker)
        if (playing) mainHandler.postDelayed(progressTicker, PROGRESS_UPDATE_MS)
    }

    private fun loadArtwork(rawUrl: String) {
        val requestId = ++artworkRequestId
        if (rawUrl.isBlank()) return
        artworkExecutor.execute {
            val bitmap = downloadArtwork(rawUrl)
            mainHandler.post {
                if (requestId != artworkRequestId || bitmap == null) return@post
                cover = bitmap
                publish()
            }
        }
    }

    private fun downloadArtwork(rawUrl: String): Bitmap? {
        var url = runCatching { URL(rawUrl) }.getOrNull() ?: return null
        repeat(3) {
            if (!isAllowedArtworkUrl(url)) return null
            val connection = runCatching { url.openConnection() as HttpURLConnection }.getOrNull() ?: return null
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = ARTWORK_CONNECT_TIMEOUT_MS
                connection.readTimeout = ARTWORK_READ_TIMEOUT_MS
                connection.setRequestProperty("Accept", "image/*")
                when (connection.responseCode) {
                    in 200..299 -> {
                        val contentLength = connection.contentLengthLong
                        if (contentLength <= 0 || contentLength > MAX_ARTWORK_BYTES) return null
                        val data = readArtworkBytes(connection.inputStream) ?: return null
                        return BitmapFactory.decodeByteArray(data, 0, data.size)?.let(::scaleArtwork)
                    }
                    in 300..399 -> {
                        val location = connection.getHeaderField("Location") ?: return null
                        url = URL(url, location)
                    }
                    else -> return null
                }
            } finally {
                connection.disconnect()
            }
        }
        return null
    }

    private fun isAllowedArtworkUrl(url: URL): Boolean {
        if (url.protocol != "https" && url.protocol != "http") return false
        val host = url.host.lowercase()
        if (host == "localhost" || host.endsWith(".local")) return false
        val addresses = runCatching { InetAddress.getAllByName(host) }.getOrNull() ?: return false
        return addresses.isNotEmpty() && addresses.all { address ->
            !address.isAnyLocalAddress && !address.isLoopbackAddress &&
                !address.isLinkLocalAddress && !address.isSiteLocalAddress
        }
    }

    private fun readArtworkBytes(input: java.io.InputStream): ByteArray? {
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                if (output.size().toLong() + count > MAX_ARTWORK_BYTES) return null
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
    }

    private fun scaleArtwork(bitmap: Bitmap): Bitmap {
        val longest = max(bitmap.width, bitmap.height)
        if (longest <= MAX_ARTWORK_EDGE) return bitmap
        val scale = MAX_ARTWORK_EDGE.toFloat() / longest
        return Bitmap.createScaledBitmap(
            bitmap,
            max(1, (bitmap.width * scale).toInt()),
            max(1, (bitmap.height * scale).toInt()),
            true,
        )
    }

    private fun buildNotification(): Notification {
        val playPauseAction = if (playing) ACTION_PAUSE else ACTION_PLAY
        val playPauseIcon = if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseLabel = if (playing) "暂停" else "播放"
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(activityPendingIntent())
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)

        val compactActionIndexes = mutableListOf<Int>()
        if (canPause) {
            builder.addAction(playPauseIcon, playPauseLabel, servicePendingIntent(playPauseAction))
            compactActionIndexes += 0
        }
        if (canSkip) {
            builder.addAction(android.R.drawable.ic_media_next, "下一首", servicePendingIntent(ACTION_NEXT))
            compactActionIndexes += compactActionIndexes.size
        }
        builder.setStyle(
            Notification.MediaStyle()
                .setMediaSession(mediaSession.sessionToken)
                .setShowActionsInCompactView(*compactActionIndexes.toIntArray()),
        )
        return builder.build()
    }

    private fun dispatchIfAllowed(action: String, allowed: Boolean) {
        if (allowed) NativePlaybackBridge.dispatch(action)
    }

    private fun handleControlAction(action: String) {
        val now = SystemClock.elapsedRealtime()
        if (action == lastControlAction && now - lastControlAtMs < CONTROL_DEBOUNCE_MS) return
        lastControlAction = action
        lastControlAtMs = now
        when (action) {
            "play" -> {
                if (!canPause) return
                positionMs = currentPositionMs()
                positionUpdatedAtMs = now
                playing = true
                pendingPlaying = true
                pendingPlayingUntilMs = now + LOCAL_ACTION_CONFIRM_TIMEOUT_MS
                publish()
                NativePlaybackBridge.dispatch("play")
            }
            "pause" -> {
                if (!canPause) return
                positionMs = currentPositionMs()
                positionUpdatedAtMs = now
                playing = false
                pendingPlaying = false
                pendingPlayingUntilMs = now + LOCAL_ACTION_CONFIRM_TIMEOUT_MS
                publish()
                NativePlaybackBridge.dispatch("pause")
            }
            "next" -> dispatchIfAllowed("next", canSkip)
        }
    }

    private fun setPendingPosition(position: Long) {
        val now = SystemClock.elapsedRealtime()
        positionMs = position
        positionUpdatedAtMs = now
        pendingPositionMs = position
        pendingPositionUntilMs = now + LOCAL_ACTION_CONFIRM_TIMEOUT_MS
    }

    private fun currentPositionMs(): Long {
        val elapsed = if (playing) SystemClock.elapsedRealtime() - positionUpdatedAtMs else 0L
        val position = positionMs + elapsed.coerceAtLeast(0L)
        return if (durationMs > 0) position.coerceAtMost(durationMs) else position
    }

    private fun secondsToMillis(value: Any?): Long {
        val seconds = (value as? Number)?.toDouble() ?: value?.toString()?.toDoubleOrNull() ?: 0.0
        return max(0L, (seconds * 1000).toLong())
    }

    private fun servicePendingIntent(action: String): PendingIntent {
        return PendingIntent.getService(
            this,
            action.hashCode(),
            Intent(this, NativePlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun activityPendingIntent(): PendingIntent {
        return PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "播放控制", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
    }

    companion object {
        private const val CHANNEL_ID = "openmusic_playback"
        private const val NOTIFICATION_ID = 27001
        private const val ACTION_UPDATE = "com.openmusic.app.UPDATE_PLAYBACK"
        private const val ACTION_CLEAR = "com.openmusic.app.CLEAR_PLAYBACK"
        private const val ACTION_PLAY = "com.openmusic.app.PLAY"
        private const val ACTION_PAUSE = "com.openmusic.app.PAUSE"
        private const val ACTION_NEXT = "com.openmusic.app.NEXT"
        private const val MAX_ARTWORK_BYTES = 5L * 1024 * 1024
        private const val MAX_ARTWORK_EDGE = 512
        private const val ARTWORK_CONNECT_TIMEOUT_MS = 5_000
        private const val ARTWORK_READ_TIMEOUT_MS = 8_000
        private const val PROGRESS_UPDATE_MS = 1_000L
        private const val LOCAL_ACTION_CONFIRM_TIMEOUT_MS = 2_500L
        private const val POSITION_ACK_TOLERANCE_MS = 1_500L
        private const val CONTROL_DEBOUNCE_MS = 500L

        fun show(context: Context, data: Map<String, Any?>) {
            val intent = Intent(context, NativePlaybackService::class.java).setAction(ACTION_UPDATE)
            data.forEach { (key, value) ->
                when (value) {
                    is String -> intent.putExtra(key, value)
                    is Boolean -> intent.putExtra(key, value)
                    is Double -> intent.putExtra(key, value)
                    is Int -> intent.putExtra(key, value)
                    is Long -> intent.putExtra(key, value)
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun clear(context: Context) {
            context.startService(Intent(context, NativePlaybackService::class.java).setAction(ACTION_CLEAR))
        }
    }
}
