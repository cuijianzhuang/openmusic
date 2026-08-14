package com.openmusic.app

import io.flutter.embedding.android.FlutterActivity
import android.content.Intent
import android.net.Uri
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.content.pm.PackageManager
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var notificationPermissionRequested = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.openmusic.app/native")
        NativePlaybackBridge.channel = channel
        channel
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "vibrate" -> {
                        val vibrator = if (android.os.Build.VERSION.SDK_INT >= 31) {
                            getSystemService(VibratorManager::class.java).defaultVibrator
                        } else getSystemService(VIBRATOR_SERVICE) as Vibrator
                        if (android.os.Build.VERSION.SDK_INT >= 26) {
                            vibrator.vibrate(
                                VibrationEffect.createOneShot(
                                    24,
                                    VibrationEffect.DEFAULT_AMPLITUDE,
                                ),
                            )
                        } else {
                            @Suppress("DEPRECATION")
                            vibrator.vibrate(24)
                        }
                        result.success(mapOf("ok" to true))
                    }
                    "share" -> {
                        val text = call.argument<String>("text")?.take(2000).orEmpty()
                        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, text)
                        }, "分享"))
                        result.success(mapOf("ok" to true))
                    }
                    "openExternal" -> {
                        val raw = call.argument<String>("url").orEmpty()
                        val uri = runCatching { Uri.parse(raw) }.getOrNull()
                        if (uri == null || uri.scheme !in setOf("https", "http")) {
                            result.error("INVALID_URL", "仅允许 http/https", null)
                        } else {
                            startActivity(Intent(Intent.ACTION_VIEW, uri))
                            result.success(mapOf("ok" to true))
                        }
                    }
                    "updatePlaybackNotification" -> {
                        val data = call.arguments<Map<String, Any?>>() ?: emptyMap()
                        requestNotificationPermissionIfNeeded()
                        NativePlaybackService.show(this, data)
                        result.success(mapOf("ok" to true))
                    }
                    "requestNotificationPermission" -> {
                        requestNotificationPermissionIfNeeded()
                        result.success(mapOf("ok" to true))
                    }
                    "clearPlaybackNotification" -> {
                        NativePlaybackService.clear(this)
                        result.success(mapOf("ok" to true))
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onResume() {
        super.onResume()
        requestNotificationPermissionIfNeeded()
    }

    override fun onDestroy() {
        if (isFinishing) NativePlaybackBridge.channel = null
        super.onDestroy()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT < 33) return
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        if (notificationPermissionRequested) return
        notificationPermissionRequested = true
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATION_PERMISSION)
    }

    companion object {
        private const val REQUEST_NOTIFICATION_PERMISSION = 1101
    }
}
