import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMediaWithSafeRedirects } from './mediaProxy.js';

test('media proxy rejects loopback before making an upstream request', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return new Response('unexpected');
  };

  await assert.rejects(
    fetchMediaWithSafeRedirects(fakeFetch, 'http://127.0.0.1/private'),
    (error) => error?.statusCode === 403,
  );
  assert.equal(calls, 0);
});

test('media proxy rejects non-standard ports before making a request', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return new Response('unexpected');
  };

  await assert.rejects(
    fetchMediaWithSafeRedirects(fakeFetch, 'https://music.163.com:3000/file'),
    (error) => error?.statusCode === 403,
  );
  assert.equal(calls, 0);
});

test('media proxy validates every redirect hop', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    });
  };

  await assert.rejects(
    fetchMediaWithSafeRedirects(
      fakeFetch,
      'https://8.8.8.8/file',
      { extraAllowedHosts: ['8.8.8.8'] },
    ),
    (error) => error?.statusCode === 403,
  );
  assert.equal(calls, 1);
});
