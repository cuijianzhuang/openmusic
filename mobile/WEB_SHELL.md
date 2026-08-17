# WebView Shell

此移动端已是纯 WebView 容器，启动后直接加载 Web 页面：

```bash
flutter run --dart-define=OM_SERVER_URL=https://your-host
```

当前房间页通过 `flutter_inappwebview` bridge 自动报送 Android 通知栏媒体状态，并响应 `play`、`pause`、`seek`、`next`、`lyrics`、`toggleMode`、`toggleFavorite`。通知栏的按钮、进度拖动与模式切换都依赖网页同步的权限字段；网页和服务端仍负责最终权限校验。Android 13 及以上首次播放需允许通知权限；悬浮歌词还需要系统悬浮窗权限。

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
  lyric: currentLyric,
  playMode: room.playMode,
  playModeLabel: playModeLabel,
  canChangeMode: permissions.canChangeMode,
  favorited: isFavorite,
});

window.addEventListener('omNativePlayerCommand', ({ detail }) => {
  if (detail.action === 'play') player.play();
  if (detail.action === 'pause') player.pause();
  if (detail.action === 'seek') player.seek(detail.time);
  if (detail.action === 'next') nextTrack();
  if (detail.action === 'lyrics') openPlayerLyrics();
  if (detail.action === 'toggleMode') changePlayMode();
  if (detail.action === 'toggleFavorite') toggleFavorite();
});
```

`lyrics` 仅是当前可显示的歌词文本；没有歌词时传空字符串。`toggleMode` 必须由网页先检查控播权限，`toggleFavorite` 只操作当前用户自己的收藏。原生端的「词」按钮会在未授权时引导到悬浮窗权限页，获准后显示紫色桌面歌词浮窗；浮窗可拖动，点击歌词时显示「锁定 / 解锁 / 关闭」按钮并在无操作 3 秒后自动隐藏，可通过「锁定 / 解锁」切换位置锁定，锁定后必须先解锁才能移动或关闭。

网页可调用的 Android 原生工具是受限白名单，避免把任意 Intent 暴露给不可信页面：

```js
await window.flutter_inappwebview.callHandler('omNative', { action: 'vibrate' });
await window.flutter_inappwebview.callHandler('omNative', { action: 'share', text: '...' });
await window.flutter_inappwebview.callHandler('omNative', { action: 'openExternal', url: 'https://...' });
```

`openExternal` 只允许 `http` 或 `https` URL；分享文本最长 2000 个字符。
