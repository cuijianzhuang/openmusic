package com.openmusic.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Capacitor 壳层：息屏/后台时启动媒体前台服务，并恢复 WebView 定时器，
 * 避免嵌入网页的 Socket / 播放逻辑被系统挂起。
 */
public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 10086;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 须在 super 之前注册，供 Web 同步媒体通知栏元数据
        registerPlugin(PlaybackMediaPlugin.class);
        super.onCreate(savedInstanceState);
        requestNotificationPermissionIfNeeded();
    }

    @Override
    public void onResume() {
        super.onResume();
        resumeWebViewRuntime();
        // 回到前台后由 Activity 保活，可撤掉通知；息屏/切走时再拉起
        PlaybackKeepAliveService.stop(this);
    }

    @Override
    public void onPause() {
        super.onPause();
        // Bridge 默认会 pause WebView；立刻恢复，保证息屏后 JS/WebSocket 仍可跑
        resumeWebViewRuntime();
        PlaybackKeepAliveService.start(this);
    }

    @Override
    public void onDestroy() {
        PlaybackKeepAliveService.stop(this);
        super.onDestroy();
    }

    private void resumeWebViewRuntime() {
        if (getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.onResume();
        webView.resumeTimers();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ActivityCompat.requestPermissions(
            this,
            new String[]{Manifest.permission.POST_NOTIFICATIONS},
            REQ_POST_NOTIFICATIONS
        );
    }
}
