import { customAlphabet } from 'nanoid';
import { getRedisClient } from './roomStorage.js';

const IDS_KEY = 'openmusic:error_reports:ids';
const reportKey = (id) => `openmusic:error_reports:${id}`;
const generateId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 14);
const MAX_REPORTS = 100;
const MAX_DESCRIPTION = 500;
const MAX_SNAPSHOT = 48_000;
const MAX_EVENTS = 80;
const MAX_META_STRING = 400;

/** @type {Map<string, object>} */
const memoryReports = new Map();
/** @type {string[]} 新到旧 */
let memoryIds = [];

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeMeta(raw = {}) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const k = cleanText(key, 40);
    if (!k) continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      out[k] = value;
    } else if (value == null) {
      out[k] = null;
    } else {
      out[k] = cleanText(value, MAX_META_STRING);
    }
  }
  return out;
}

function sanitizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_EVENTS).map((item) => ({
    at: cleanText(item?.at, 40),
    name: cleanText(item?.name, 80),
    line: cleanText(item?.line, 800),
  }));
}

function sanitizeReport(raw = {}) {
  const status = raw.status === 'resolved' ? 'resolved' : 'open';
  return {
    id: cleanText(raw.id, 32) || generateId(),
    status,
    description: cleanText(raw.description, MAX_DESCRIPTION),
    snapshot: cleanText(raw.snapshot, MAX_SNAPSHOT),
    events: sanitizeEvents(raw.events),
    meta: sanitizeMeta(raw.meta),
    ip: cleanText(raw.ip, 64),
    userId: cleanText(raw.userId, 64),
    createdAt: Number(raw.createdAt) || Date.now(),
    resolvedAt: status === 'resolved' ? (Number(raw.resolvedAt) || Date.now()) : null,
    note: cleanText(raw.note, 200),
  };
}

function toSummary(report) {
  return {
    id: report.id,
    status: report.status,
    description: report.description,
    ip: report.ip,
    userId: report.userId,
    createdAt: report.createdAt,
    resolvedAt: report.resolvedAt,
    note: report.note,
    meta: {
      roomId: report.meta?.roomId ?? null,
      nickname: report.meta?.nickname ?? null,
      trackName: report.meta?.trackName ?? null,
      trackSource: report.meta?.trackSource ?? null,
      href: report.meta?.href ?? null,
    },
    eventCount: Array.isArray(report.events) ? report.events.length : 0,
    hasSnapshot: Boolean(report.snapshot),
  };
}

async function persistReport(report) {
  const client = getRedisClient();
  if (!client) {
    memoryReports.set(report.id, report);
    memoryIds = [report.id, ...memoryIds.filter((id) => id !== report.id)].slice(0, MAX_REPORTS);
    // 清理被裁掉的
    for (const id of memoryReports.keys()) {
      if (!memoryIds.includes(id)) memoryReports.delete(id);
    }
    return;
  }
  try {
    await client.set(reportKey(report.id), JSON.stringify(report));
    await client.lRem(IDS_KEY, 0, report.id);
    await client.lPush(IDS_KEY, report.id);
    await client.lTrim(IDS_KEY, 0, MAX_REPORTS - 1);
    const kept = await client.lRange(IDS_KEY, 0, MAX_REPORTS - 1);
    // 尽力清理过期键（忽略失败）
    const keptSet = new Set(kept);
    // 不扫全库；仅当 map/list 同步即可
    void keptSet;
  } catch (err) {
    console.error('error-report Redis 写入失败:', err?.message || err);
    memoryReports.set(report.id, report);
    memoryIds = [report.id, ...memoryIds.filter((id) => id !== report.id)].slice(0, MAX_REPORTS);
  }
}

async function readReport(id) {
  const reportId = cleanText(id, 32);
  if (!reportId) return null;
  const client = getRedisClient();
  if (client) {
    try {
      const raw = await client.get(reportKey(reportId));
      if (raw) return sanitizeReport(JSON.parse(raw));
    } catch (err) {
      console.error('error-report Redis 读取失败:', err?.message || err);
    }
  }
  const mem = memoryReports.get(reportId);
  return mem ? sanitizeReport(mem) : null;
}

export async function createErrorReport(input = {}) {
  const description = cleanText(input.description, MAX_DESCRIPTION);
  if (!description) return { success: false, error: '请填写问题描述' };

  const report = sanitizeReport({
    id: generateId(),
    status: 'open',
    description,
    snapshot: input.snapshot,
    events: input.events,
    meta: input.meta,
    ip: input.ip,
    userId: input.userId,
    createdAt: Date.now(),
    resolvedAt: null,
    note: '',
  });

  await persistReport(report);
  return { success: true, report: toSummary(report) };
}

export async function listErrorReports() {
  const client = getRedisClient();
  if (client) {
    try {
      const ids = await client.lRange(IDS_KEY, 0, MAX_REPORTS - 1);
      const reports = [];
      for (const id of ids) {
        const report = await readReport(id);
        if (report) reports.push(toSummary(report));
      }
      return reports;
    } catch (err) {
      console.error('error-report Redis 列表失败:', err?.message || err);
    }
  }
  return memoryIds.map((id) => memoryReports.get(id)).filter(Boolean).map(toSummary);
}

export async function getErrorReport(id) {
  return readReport(id);
}

export async function updateErrorReport(id, { status, note } = {}) {
  const report = await readReport(id);
  if (!report) return { success: false, error: '上报不存在' };

  if (status === 'open' || status === 'resolved') {
    report.status = status;
    report.resolvedAt = status === 'resolved' ? Date.now() : null;
  }
  if (note !== undefined) {
    report.note = cleanText(note, 200);
  }

  await persistReport(report);
  return { success: true, report };
}

export async function deleteErrorReport(id) {
  const reportId = cleanText(id, 32);
  if (!reportId) return { success: false, error: '上报不存在' };

  const client = getRedisClient();
  if (client) {
    try {
      const existed = await client.exists(reportKey(reportId));
      await client.del(reportKey(reportId));
      await client.lRem(IDS_KEY, 0, reportId);
      if (!existed && !memoryReports.has(reportId)) {
        return { success: false, error: '上报不存在' };
      }
    } catch (err) {
      console.error('error-report Redis 删除失败:', err?.message || err);
      return { success: false, error: '删除失败' };
    }
  } else if (!memoryReports.has(reportId)) {
    return { success: false, error: '上报不存在' };
  }

  memoryReports.delete(reportId);
  memoryIds = memoryIds.filter((item) => item !== reportId);
  return { success: true };
}
