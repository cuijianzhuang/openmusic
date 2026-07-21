import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchCustomMusicApi,
  getJsonPath,
  mapMusicApiResponse,
  normalizeMusicApis,
  renderTemplate,
  resetCustomMusicApiState,
} from './customMusicApi.js';

test('JSON path 支持点号与数组下标', () => {
  const payload = { data: { songs: [{ url: 'https://cdn.example/song.mp3' }] } };
  assert.equal(getJsonPath(payload, 'data.songs[0].url'), 'https://cdn.example/song.mp3');
  assert.equal(getJsonPath(payload, 'data.songs[1].url'), undefined);
  assert.equal(getJsonPath(payload, 'data..songs'), undefined);
});

test('模板仅替换白名单变量并可进行 URL 编码', () => {
  const variables = {
    id: '123',
    keyword: '周 杰伦',
    quality: '320',
    limit: '20',
    server: 'netease',
  };
  assert.equal(
    renderTemplate(
      'https://api.example/{server}?id={id}&q={keyword}&quality={quality}&limit={limit}&x={unknown}',
      variables,
      { encode: true },
    ),
    'https://api.example/netease?id=123&q=%E5%91%A8%20%E6%9D%B0%E4%BC%A6&quality=320&limit=20&x={unknown}',
  );
});

test('按 mapping 将搜索响应转换为 Meting 形状', () => {
  const [endpoint] = normalizeMusicApis([{
    id: 'search-1',
    platform: 'netease',
    operation: 'search',
    method: 'GET',
    url: 'https://api.example/search?q={keyword}',
    mapping: {
      items: 'data.songs',
      id: 'songId',
      name: 'title',
      artist: 'singer.name',
      pic: 'cover',
    },
  }]);
  const result = mapMusicApiResponse({
    data: {
      songs: [{
        songId: 42,
        title: '晴天',
        singer: { name: '周杰伦' },
        cover: 'https://img.example/42.jpg',
      }],
    },
  }, endpoint);
  assert.deepEqual(result, [{
    id: 42,
    name: '晴天',
    artist: '周杰伦',
    pic: 'https://img.example/42.jpg',
    source: 'netease',
  }]);
  assert.deepEqual(endpoint.platforms, ['netease']);
  assert.equal(endpoint.weight, 100);
});

test('网络或 5xx 后切换 endpoint，并按阈值熔断', async () => {
  resetCustomMusicApiState();
  const config = {
    musicApis: normalizeMusicApis([
      {
        id: 'primary',
        platform: 'tencent',
        operation: 'url',
        method: 'GET',
        url: 'https://primary.example/song/{id}',
        failureThreshold: 1,
        mapping: { value: 'data.url' },
      },
      {
        id: 'secondary',
        platform: 'tencent',
        operation: 'url',
        method: 'POST',
        url: 'https://secondary.example/song',
        headers: '{"Authorization":"Bearer {id}"}',
        body: '{"song":"{id}"}',
        mapping: { value: 'data.url' },
      },
    ]),
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('primary')) return new Response('bad gateway', { status: 502 });
    return new Response(JSON.stringify({ data: { url: 'https://cdn.example/song.mp3' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  let clock = 1_000;

  const first = await fetchCustomMusicApi(
    { server: 'tencent', type: 'url', id: 'abc' },
    { config, fetchImpl, now: () => clock },
  );
  assert.equal(await first.text(), 'https://cdn.example/song.mp3');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer abc');
  assert.equal(calls[1].options.body, '{"song":"abc"}');

  clock += 1_000;
  const second = await fetchCustomMusicApi(
    { server: 'tencent', type: 'url', id: 'abc' },
    { config, fetchImpl, now: () => clock },
  );
  assert.equal(await second.text(), 'https://cdn.example/song.mp3');
  assert.equal(calls.filter((call) => call.url.includes('primary')).length, 1);
  assert.equal(calls.filter((call) => call.url.includes('secondary')).length, 2);
});

test('一个接口可服务多个平台，响应 source 使用实际请求平台', async () => {
  resetCustomMusicApiState();
  const config = {
    musicApis: normalizeMusicApis([{
      id: 'multi-platform',
      platforms: ['netease', 'tencent'],
      operations: ['search'],
      method: 'GET',
      url: 'https://multi.example/{server}?q={keyword}',
      mapping: { items: 'data', id: 'id', name: 'name', artist: 'artist' },
    }]),
  };
  const response = await fetchCustomMusicApi(
    { server: 'tencent', type: 'search', id: '晴天' },
    {
      config,
      fetchImpl: async (url) => {
        assert.match(url, /multi\.example\/tencent/);
        return new Response(JSON.stringify({
          data: [{ id: '1', name: '晴天', artist: '周杰伦' }],
        }));
      },
    },
  );
  assert.deepEqual(await response.json(), [{
    id: '1',
    name: '晴天',
    artist: '周杰伦',
    source: 'tencent',
  }]);
});

test('按权重进行确定性比例分流', async () => {
  resetCustomMusicApiState();
  const config = {
    musicApis: normalizeMusicApis([
      {
        id: 'weight-1',
        platforms: ['netease'],
        operations: ['url'],
        weight: 1,
        url: 'https://one.example/{id}',
        mapping: { value: 'url' },
      },
      {
        id: 'weight-3',
        platforms: ['netease'],
        operations: ['url'],
        weight: 3,
        url: 'https://three.example/{id}',
        mapping: { value: 'url' },
      },
    ]),
  };
  const calls = { one: 0, three: 0 };
  const fetchImpl = async (url) => {
    const target = url.includes('one.example') ? 'one' : 'three';
    calls[target] += 1;
    return new Response(JSON.stringify({ url: `https://cdn.example/${target}.mp3` }));
  };
  for (let index = 0; index < 8; index += 1) {
    const response = await fetchCustomMusicApi(
      { server: 'netease', type: 'url', id: String(index) },
      { config, fetchImpl },
    );
    assert.match(await response.text(), /cdn\.example/);
  }
  assert.deepEqual(calls, { one: 2, three: 6 });
});

test('熔断等待结束后仅放行半开探测，成功后恢复', async () => {
  resetCustomMusicApiState();
  const config = {
    musicApis: normalizeMusicApis([{
      id: 'breaker',
      platforms: ['kugou'],
      operations: ['url'],
      url: 'https://breaker.example/{id}',
      failureThreshold: 1,
      cooldownMs: 5000,
      mapping: { value: 'url' },
    }]),
  };
  let clock = 1000;
  let healthy = false;
  const fetchImpl = async () => (
    healthy
      ? new Response(JSON.stringify({ url: 'https://cdn.example/recovered.mp3' }))
      : new Response('unavailable', { status: 503 })
  );

  await assert.rejects(() => fetchCustomMusicApi(
    { server: 'kugou', type: 'url', id: '1' },
    { config, fetchImpl, now: () => clock },
  ));
  assert.equal(await fetchCustomMusicApi(
    { server: 'kugou', type: 'url', id: '1' },
    { config, fetchImpl, now: () => clock },
  ), null);

  clock += 5000;
  healthy = true;
  const recovered = await fetchCustomMusicApi(
    { server: 'kugou', type: 'url', id: '1' },
    { config, fetchImpl, now: () => clock },
  );
  assert.equal(await recovered.text(), 'https://cdn.example/recovered.mp3');
});
