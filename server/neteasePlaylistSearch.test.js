import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNeteasePlaylistSearchHandler,
  normalizeNeteasePlaylistSearchItems,
  searchNeteasePlaylists,
} from './neteasePlaylistSearch.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('网易歌单搜索使用空 songId 上下文并保留分页', async () => {
  let context;
  let query;
  const result = await searchNeteasePlaylists({
    identity: { userId: 'user-1' },
    presence: { roomId: 'ABCD', roomName: '测试房', userNickname: '测试用户' },
    keyword: '周杰伦',
    page: 2,
    limit: 1,
    withContext: async (value, fn) => {
      context = value;
      return fn();
    },
    fetchApi: async (value) => {
      query = value;
      return {
        ok: true,
        status: 200,
        async json() {
          return [
            { id: 1, name: '歌单一' },
            { id: 2, title: '歌单二', creator: { nickname: '创建者' } },
          ];
        },
      };
    },
  });

  assert.equal(context.songId, '');
  assert.equal(context.roomId, 'ABCD');
  assert.deepEqual(query, { server: 'netease', type: 'search_playlist', id: '周杰伦' });
  assert.deepEqual(result, {
    ok: true,
    payload: {
      page: 2,
      limit: 1,
      total: 2,
      playlists: [{
        id: '2',
        name: '歌单二',
        coverImgUrl: '',
        creatorName: '创建者',
        trackCount: 0,
        playCount: 0,
      }],
    },
  });
});

test('网易歌单搜索保留上游失败状态', async () => {
  const result = await searchNeteasePlaylists({
    identity: { userId: 'user-1' },
    presence: null,
    keyword: '测试',
    page: 1,
    limit: 20,
    withContext: async (_value, fn) => fn(),
    fetchApi: async () => ({ ok: false, status: 429 }),
  });
  assert.deepEqual(result, { ok: false, status: 429 });
});

test('网易歌单搜索响应过滤无 ID 项并兼容旧字段', () => {
  assert.deepEqual(normalizeNeteasePlaylistSearchItems([
    { title: '无 ID' },
    {
      id: '42',
      title: '兼容歌单',
      pic: 'cover.jpg',
      user: { nickname: '用户' },
      song_count: '12',
      playcount: '34',
    },
  ]), [{
    id: '42',
    name: '兼容歌单',
    coverImgUrl: 'cover.jpg',
    creatorName: '用户',
    trackCount: 12,
    playCount: 34,
  }]);
});

test('歌单搜索处理器保留未认证和空关键词响应', async () => {
  let searchCalls = 0;
  const handler = createNeteasePlaylistSearchHandler({
    requireIdentity: (req, res) => {
      if (req.authenticated) return { userId: 'user-1' };
      res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
      return null;
    },
    consumeLimit: () => true,
    findPresence: () => null,
    search: async () => {
      searchCalls += 1;
      return { ok: true, payload: {} };
    },
  });

  const unauthorized = createResponse();
  await handler({ authenticated: false, query: {} }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const empty = createResponse();
  await handler({ authenticated: true, query: { keyword: '  ', page: '-2', limit: '99' } }, empty);
  assert.deepEqual(empty.body, { playlists: [], total: 0, page: 1, limit: 50 });
  assert.equal(searchCalls, 0);
});

test('歌单搜索处理器保留限流和异常响应', async () => {
  const limitedHandler = createNeteasePlaylistSearchHandler({
    requireIdentity: () => ({ userId: 'user-1' }),
    consumeLimit: () => false,
    findPresence: () => null,
  });
  const limited = createResponse();
  await limitedHandler({ query: { keyword: '测试' } }, limited);
  assert.equal(limited.statusCode, 429);

  const failedHandler = createNeteasePlaylistSearchHandler({
    requireIdentity: () => ({ userId: 'user-1' }),
    consumeLimit: () => true,
    findPresence: () => null,
    search: async () => { throw new Error('upstream failed'); },
    logError: () => {},
  });
  const failed = createResponse();
  await failedHandler({ query: { keyword: '测试' } }, failed);
  assert.equal(failed.statusCode, 502);
  assert.deepEqual(failed.body, { error: '网易歌单搜索失败' });
});
