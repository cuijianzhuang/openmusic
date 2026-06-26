export function buildRoomShareText(options: {
  inviterNickname: string;
  roomId: string;
  roomName: string;
  currentSong?: { name: string; artist: string } | null;
  isPlaying?: boolean;
  origin?: string;
}): string {
  const {
    inviterNickname,
    roomId,
    roomName,
    currentSong,
    isPlaying = true,
  } = options;
  const origin = options.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const url = `${origin}/room/${roomId}`;
  const inviter = inviterNickname.trim() || '好友';

  let playbackLine: string;
  if (currentSong) {
    const status = isPlaying ? '正在播放' : '暂停中';
    playbackLine = `${status}《${currentSong.name}》— ${currentSong.artist}，一起来听吧 🎧`;
  } else {
    playbackLine = '房间等你一起点歌，快来加入吧 🎵';
  }

  return [
    `${inviter} 邀请你加入 OpenMusic 房间「${roomName}」`,
    playbackLine,
    `房间号：${roomId}`,
    `👉 ${url}`,
  ].join('\n');
}
