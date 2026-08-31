import { randomUUID } from 'node:crypto';
import { io as defaultSocketIo } from 'socket.io-client';

function textPart(text) { return { type: 'text', data: String(text || '') }; }

export function createMaiBotMessage({ messageId = randomUUID(), platform = 'openmusic', accountId = 'openmusic', roomId, userId, userNickname = '', text }) {
  return {
    message_info: {
      platform: String(platform),
      message_id: String(messageId),
      time: Math.floor(Date.now() / 1000),
      user_info: { user_id: String(userId || ''), user_nickname: String(userNickname || ''), account_id: String(accountId || '') },
      group_info: { group_id: String(roomId || '') },
    },
    message_segment: { type: 'seglist', data: [textPart(text)] },
    raw_message: String(text || ''),
  };
}

function collectSegments(segment, out) {
  if (!segment) return;
  if (Array.isArray(segment)) { segment.forEach((item) => collectSegments(item, out)); return; }
  if (segment.type === 'seglist' || segment.type === 'list') { collectSegments(segment.data, out); return; }
  if (segment.type === 'text') out.push(String(segment.data ?? segment.text ?? ''));
}

export function extractMaiBotText(message) {
  if (!message || message.type === 'echo' || message.type === 'custom_message_id_echo') return '';
  const out = [];
  collectSegments(message.message_segment, out);
  if (!out.length) collectSegments(message.payload?.message_segment, out);
  if (!out.length && Array.isArray(message.raw_message?.components)) {
    for (const component of message.raw_message.components) {
      if (component?.type === 'text') out.push(String(component.text ?? component.data ?? ''));
    }
  }
  return out.join('').trim();
}

function getMessageRoomId(message) {
  return String(message?.message_info?.group_info?.group_id
    || message?.payload?.message_info?.group_info?.group_id || '').trim();
}

export class MaiBotAdapter {
  constructor({ wsUrl, authMode = 'token', authToken = '', apiKey = '', socketIo = defaultSocketIo, timeoutMs = 45_000 } = {}) {
    this.wsUrl = String(wsUrl || '').trim();
    this.authMode = authMode === 'api_key' ? 'api_key' : 'token';
    this.authToken = String(authToken || '');
    this.apiKey = String(apiKey || '');
    this.socketIo = socketIo;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 45_000);
    this.socket = null;
    this.connecting = null;
    this.pending = new Map();
  }

  async connect() {
    if (this.socket?.connected) return this.socket;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      let settled = false;
      const credential = this.authMode === 'api_key' ? this.apiKey : this.authToken;
      const httpUrl = this.wsUrl.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
      const socket = this.socketIo(httpUrl, {
        path: new URL(this.wsUrl).pathname || '/ws',
        // MaiBot 的 Legacy MessageServer 使用 Socket.IO，先用 polling 建立会话，再由 Socket.IO 自己升级到 WebSocket。
        transports: ['polling', 'websocket'],
        extraHeaders: {
          Authorization: credential,
          platform: 'openmusic',
        },
      });
      this.socket = socket;
      const fail = (error) => { if (!settled) { settled = true; reject(error); } };
      socket.once('connect', () => {
        settled = true;
        resolve(socket);
      });
      socket.on('message', (message) => this.handleMessage(message));
      socket.once('connect_error', (error) => fail(new Error(error?.message || 'MaiBot Socket.IO 连接失败')));
      socket.on('disconnect', () => {
        this.socket = null;
        for (const item of this.pending.values()) item.reject(new Error('MaiBot WebSocket 已断开'));
        this.pending.clear();
      });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  handleMessage(raw) {
    let data;
    try {
      const source = Buffer.isBuffer(raw) || raw instanceof Uint8Array ? Buffer.from(raw).toString('utf8') : raw;
      data = typeof source === 'string' ? JSON.parse(source) : source;
    } catch { return; }
    const roomId = getMessageRoomId(data);
    const pending = roomId ? this.pending.get(roomId) : this.pending.values().next().value;
    if (!pending) return;
    const text = extractMaiBotText(data);
    if (!text) return;
    clearTimeout(pending.timer);
    this.pending.delete(pending.roomId);
    pending.resolve(text);
  }

  async sendMessage({ messageId, platform, accountId, roomId, userId, userNickname, text }) {
    if (!this.wsUrl) throw new Error('MaiBot WebSocket 地址未配置');
    const socket = await this.connect();
    const payload = createMaiBotMessage({ messageId, platform, accountId, roomId, userId, userNickname, text });
    return new Promise((resolve, reject) => {
      const key = String(roomId || '');
      if (this.pending.has(key)) return reject(new Error('该房间已有 MaiBot 请求处理中'));
      const timer = setTimeout(() => { this.pending.delete(key); reject(new Error('MaiBot 回复超时')); }, this.timeoutMs);
      this.pending.set(key, { roomId: key, resolve, reject, timer });
      try {
        socket.emit('message', payload);
      } catch (error) { clearTimeout(timer); this.pending.delete(key); reject(error); }
    });
  }

  close() {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('MaiBot 连接已关闭')); }
    this.pending.clear();
    try { this.socket?.disconnect(); } catch {}
    this.socket = null;
  }
}

let sharedAdapter = null;
let sharedSignature = '';
export function getMaiBotAdapter(config) {
  const signature = [config?.maiBotWsUrl, config?.maiBotAuthMode, config?.maiBotAuthToken, config?.maiBotApiKey].join('|');
  if (!sharedAdapter || sharedSignature !== signature) {
    sharedAdapter?.close();
    sharedAdapter = new MaiBotAdapter({ wsUrl: config?.maiBotWsUrl, authMode: config?.maiBotAuthMode, authToken: config?.maiBotAuthToken, apiKey: config?.maiBotApiKey });
    sharedSignature = signature;
  }
  return sharedAdapter;
}
