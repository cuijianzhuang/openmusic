window.lyricsAPI.onUpdate((payload) => {
  document.title = payload.title ? `${payload.title} - OpenMusic` : 'OpenMusic 桌面歌词';
  document.querySelector('#song-meta').textContent = payload.title || 'OpenMusic';
  document.querySelector('#artist-meta').textContent = [payload.artist, payload.source].filter(Boolean).join(' · ');
  const cover = document.querySelector('#cover');
  if (payload.pic) { cover.src = payload.pic; cover.hidden = false; } else { cover.removeAttribute('src'); cover.hidden = true; }
  document.querySelector('#active').textContent = payload.activeText || '暂无歌词';
  document.querySelector('#translation').textContent = payload.translation || '';
  document.querySelector('#next').textContent = payload.nextText || '';
});
document.querySelector('#close').addEventListener('click', () => void window.lyricsAPI.close());
