# WebView Shell

此移动端已是纯 WebView 容器，启动后直接加载 Web 页面：

```bash
flutter run --dart-define=OM_SERVER_URL=https://your-host
```

当前房间页已经通过 `flutter_inappwebview` bridge 自动报送 Android 通知栏媒体状态，并响应 `play`、`pause`、`seek`、`next`。通知栏的按钮和进度拖动需由网页同步权限字段；服务端仍负责最终权限校验。Android 13 及以上首次播放需允许通知权限。

```js
window.flutter_inappwebview.callHandler('omPlayerState', {
  title: song.name,
  artist: song.artist,
  cover: song.pic,
  playing: player.playing,
  position: player.currentTime,
  duration: player.duration,
  canPause: permissions.canPause,
  canSkip: permissions.canSkip,
  canSeek: permissions.canSeek,
});

window.addEventListener('omNativePlayerCommand', ({ detail }) => {
  if (detail.action === 'play') player.play();
  if (detail.action === 'pause') player.pause();
  if (detail.action === 'seek') player.seek(detail.time);
  if (detail.action === 'next') nextTrack();
});
```

网页可调用的 Android 原生工具是受限白名单，避免把任意 Intent 暴露给不可信页面：

```js
await window.flutter_inappwebview.callHandler('omNative', { action: 'vibrate' });
await window.flutter_inappwebview.callHandler('omNative', { action: 'share', text: '...' });
await window.flutter_inappwebview.callHandler('omNative', { action: 'openExternal', url: 'https://...' });
```

`openExternal` 只允许 `http` 或 `https` URL；分享文本最长 2000 个字符。
