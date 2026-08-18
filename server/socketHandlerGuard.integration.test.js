import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as createClient } from 'socket.io-client';
import { hardenSocketHandlers } from './socketHandlerGuard.js';

async function createSocketTestServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { transports: ['websocket'] });
  let disconnectReason = null;

  io.on('connection', (socket) => {
    hardenSocketHandlers(socket);

    socket.on('join_room', ({ roomId }, callback) => {
      callback?.(roomId
        ? { success: true, roomId }
        : { success: false, error: '房间不存在' });
    });

    socket.on('explode', (_payload, _callback) => {
      throw new Error('test handler failure');
    });

    socket.on('disconnect', (reason) => {
      disconnectReason = reason;
    });
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('测试服务未取得端口');

  return {
    url: `http://127.0.0.1:${address.port}`,
    getDisconnectReason: () => disconnectReason,
    async close() {
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

function emitWithAck(socket, event, ...args) {
  return new Promise((resolve) => {
    socket.emit(event, ...args, (response) => resolve(response));
  });
}

test('Socket.IO 入口会保留 join_room ack、拒绝空或非法 payload，并保留 disconnect reason', async (t) => {
  const server = await createSocketTestServer();
  const client = createClient(server.url, { transports: ['websocket'], forceNew: true });
  t.after(async () => {
    client.disconnect();
    await server.close();
  });
  await once(client, 'connect');

  assert.deepEqual(await emitWithAck(client, 'join_room', { roomId: 'ABCD' }), {
    success: true,
    roomId: 'ABCD',
  });
  assert.deepEqual(await emitWithAck(client, 'join_room'), {
    success: false,
    error: '房间不存在',
  });
  assert.deepEqual(await emitWithAck(client, 'join_room', []), {
    success: false,
    error: '房间不存在',
  });

  client.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(server.getDisconnectReason(), 'client namespace disconnect');
});

test('Socket.IO 处理器抛错时 ack 只返回一次', async (t) => {
  const server = await createSocketTestServer();
  const client = createClient(server.url, { transports: ['websocket'], forceNew: true });
  t.after(async () => {
    client.disconnect();
    await server.close();
  });
  await once(client, 'connect');

  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    let ackCount = 0;
    const response = await new Promise((resolve) => {
      client.emit('explode', {}, (ack) => {
        ackCount += 1;
        resolve(ack);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(response, { success: false, error: '服务器内部错误，请重试' });
    assert.equal(ackCount, 1);
    assert.equal(errors.length, 1);
  } finally {
    console.error = originalConsoleError;
  }
});
