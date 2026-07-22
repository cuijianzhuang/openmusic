import { useEffect, useState, type ReactNode } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import AdminLoading from './AdminLoading';
import JsonPathTree from './JsonPathTree';
import SettingsSection from './SettingsSection';
import type {
  CustomMusicApi,
  CustomMusicApiStatus,
  MusicApiOperation,
  MusicApiPlatform,
  RuntimeConfig,
} from './types';
import { adminFetch } from './utils';

type RuntimeTextField = Exclude<
  keyof RuntimeConfig,
  'roomEmptyTtlMs' | 'configuredSecrets' | 'metingApiUrl' | 'metingApiAuth' | 'metingSources' | 'musicApis'
>;

interface RuntimeFieldDef {
  key: RuntimeTextField;
  label: string;
  placeholder?: string;
  secret?: boolean;
  tip?: string;
}

interface RuntimeFieldGroup {
  id: string;
  title: string;
  purpose: string;
  fields: RuntimeFieldDef[];
  includeQiniuZone?: boolean;
}

const RUNTIME_FIELD_GROUPS: RuntimeFieldGroup[] = [
  {
    id: 'cyapi',
    title: '迟言 API',
    purpose: '酷狗（蓝点）音乐搜索与播放。不配置则蓝点音源不可用。',
    fields: [
      { key: 'cyapiBase', label: 'API 地址', placeholder: 'https://cyapi.top/API' },
      { key: 'cyapiKey', label: 'API 密钥', secret: true },
    ],
  },
  {
    id: 'lyrics',
    title: '歌词备用',
    purpose: '主音源拿不到歌词时，按歌名向该接口兜底拉取。一般保持默认即可。',
    fields: [
      { key: 'vmyLrcUrl', label: '备用歌词 API', placeholder: 'https://api.52vmy.cn/api/music/lrc' },
    ],
  },
  {
    id: 'qiniu',
    title: '七牛云存储',
    purpose: '房间聊天发图依赖此项。四项齐全后才能上传图片；缺一则无法发送图片消息。',
    includeQiniuZone: true,
    fields: [
      { key: 'qiniuAccessKey', label: 'Access Key', secret: true },
      { key: 'qiniuSecretKey', label: 'Secret Key', secret: true },
      { key: 'qiniuBucket', label: 'Bucket', tip: '对象存储空间名称' },
      { key: 'qiniuDomain', label: 'CDN 域名', placeholder: 'https://cdn.example.com', tip: '对外访问图片用的域名，需带 https://' },
    ],
  },
  {
    id: 'apihz',
    title: '接口盒子',
    purpose: '表情包搜索与聊天敏感词检测共用。不配置则表情搜索 / 敏感词过滤不可用。',
    fields: [
      { key: 'apihzBaseUrl', label: 'API 地址', placeholder: 'https://cn.apihz.cn/api' },
      { key: 'apihzId', label: '用户 ID', secret: true },
      { key: 'apihzKey', label: '密钥', secret: true },
    ],
  },
];

const MUSIC_API_PLATFORMS: { value: MusicApiPlatform; label: string }[] = [
  { value: 'netease', label: '网易云' },
  { value: 'tencent', label: 'QQ 音乐' },
  { value: 'kugou', label: '酷狗' },
];

const MUSIC_API_OPERATIONS: { value: MusicApiOperation; label: string }[] = [
  { value: 'search', label: '歌曲搜索' },
  { value: 'song', label: '歌曲详情' },
  { value: 'url', label: '播放地址' },
  { value: 'lrc', label: '歌词' },
  { value: 'pic', label: '封面' },
  { value: 'playlist', label: '歌单详情' },
  { value: 'search_playlist', label: '歌单搜索' },
];

const SONG_MAPPING_FIELDS: { key: keyof CustomMusicApi['mapping']; label: string; placeholder: string }[] = [
  { key: 'id', label: '歌曲 ID', placeholder: 'id' },
  { key: 'name', label: '歌曲名', placeholder: 'name' },
  { key: 'artist', label: '歌手', placeholder: 'artist.name' },
  { key: 'album', label: '专辑', placeholder: 'album.name' },
  { key: 'pic', label: '封面 URL', placeholder: 'album.picUrl' },
  { key: 'duration', label: '时长', placeholder: 'duration' },
  { key: 'url', label: '播放 URL', placeholder: 'url' },
  { key: 'lrc', label: '歌词', placeholder: 'lyric' },
];

/** 解析形如 data.songs[0].url 的路径；与服务端 getJsonPath 语义一致 */
function getByPath(value: unknown, path: string): unknown {
  const trimmed = String(path || '').trim();
  if (!trimmed) return value;
  const tokens: (string | number)[] = [];
  for (const match of trimmed.matchAll(/([A-Za-z_$][\w$]*)|\[(\d+)\]/g)) {
    tokens.push(match[1] ?? Number(match[2]));
  }
  let current: unknown = value;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string | number, unknown>)[token];
  }
  return current;
}

function pickLabel(field: string, scalar: boolean): string {
  if (field === 'items') return '结果列表';
  const operation = MUSIC_API_OPERATIONS.find((item) => item.value === field);
  if (scalar && operation) return operation.label;
  const songField = SONG_MAPPING_FIELDS.find((item) => item.key === field);
  return songField?.label || field;
}

/** 结算点选树的根：标量功能与 items 用整个响应，歌曲字段用结果列表的第一条（点选得相对路径） */
function pickTreeValue(api: CustomMusicApi, field: string, scalar: boolean, response: unknown): unknown {
  if (scalar || field === 'items') return response;
  const base = api.mapping.items ? getByPath(response, api.mapping.items) : response;
  return Array.isArray(base) ? base[0] : base;
}

function createMusicApi(): CustomMusicApi {
  return {
    id: globalThis.crypto?.randomUUID?.() || `api-${Date.now()}`,
    name: '',
    remark: '',
    enabled: true,
    platforms: ['netease'],
    operations: ['search'],
    weight: 100,
    timeoutMs: 10_000,
    failureThreshold: 3,
    cooldownMs: 60_000,
    method: 'GET',
    url: '',
    params: '',
    headers: '',
    body: '',
    mapping: {
      items: 'data',
      id: 'id',
      name: 'name',
      artist: 'artist',
      album: 'album',
      pic: 'pic',
      duration: 'duration',
      url: 'url',
      lrc: 'lrc',
    },
  };
}

export default function RuntimeConfigPanel({
  onError,
  securityTab,
}: {
  onError: (message: string) => void;
  securityTab?: ReactNode;
}) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<RuntimeConfig | null>(null);
  const [activeTab, setActiveTab] = useState(securityTab ? 'security' : 'music');
  const [dirtySecrets, setDirtySecrets] = useState<Set<string>>(new Set());
  const [dirtyMetingAuth, setDirtyMetingAuth] = useState<Set<number>>(new Set());
  const [baselineSecrets, setBaselineSecrets] = useState<Record<string, string>>({});
  const [baselineMetingAuth, setBaselineMetingAuth] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [parsingApiId, setParsingApiId] = useState('');
  const [apiPreviews, setApiPreviews] = useState<Record<string, { response: unknown; paths: string[] }>>({});
  const [musicApiStatus, setMusicApiStatus] = useState<CustomMusicApiStatus | null>(null);
  const [previewPlatforms, setPreviewPlatforms] = useState<Record<string, MusicApiPlatform>>({});
  const [picking, setPicking] = useState<{ apiId: string; field: string } | null>(null);

  const applyLoadedConfig = (config: RuntimeConfig) => {
    setDraft({
      ...config,
      musicApis: Array.isArray(config.musicApis)
        ? config.musicApis.map((api) => ({
            ...api,
            platforms: Array.isArray(api.platforms) ? api.platforms : [],
            operations: Array.isArray(api.operations) ? api.operations : [],
            weight: Number(api.weight) || 100,
            timeoutMs: Number(api.timeoutMs) || 10_000,
            failureThreshold: Number(api.failureThreshold) || 3,
            cooldownMs: Number(api.cooldownMs) || 60_000,
            params: typeof api.params === 'string'
              ? api.params
              : JSON.stringify(api.params || {}, null, 2),
            headers: typeof api.headers === 'string'
              ? api.headers
              : JSON.stringify(api.headers || {}, null, 2),
          }))
        : [],
    });
    setDirtySecrets(new Set());
    setDirtyMetingAuth(new Set());
    const secrets: Record<string, string> = {};
    for (const group of RUNTIME_FIELD_GROUPS) {
      for (const field of group.fields) {
        if (field.secret) secrets[field.key] = config[field.key] || '';
      }
    }
    setBaselineSecrets(secrets);
    setBaselineMetingAuth(config.metingSources.map((source) => source.auth || ''));
  };

  const loadMusicApiStatus = async () => {
    try {
      setMusicApiStatus(await adminFetch<CustomMusicApiStatus>('/api/admin/runtime-config/music-api-status'));
    } catch {
      // 状态面板是辅助能力，不阻塞配置加载/保存。
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{ config: RuntimeConfig }>('/api/admin/runtime-config');
        if (!cancelled) {
          applyLoadedConfig(res.config);
          void loadMusicApiStatus();
        }
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : '加载运行配置失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    if (!draft) return undefined;
    const timer = window.setInterval(() => {
      void loadMusicApiStatus();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [Boolean(draft)]);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const clearSecrets: string[] = [];
      const { metingApiUrl: _ignoredUrl, metingApiAuth: _ignoredAuth, ...draftRest } = draft;
      const payload: Omit<RuntimeConfig, 'metingApiUrl' | 'metingApiAuth'> & {
        clearSecrets: string[];
        metingSources: RuntimeConfig['metingSources'];
      } = {
        ...draftRest,
        clearSecrets,
        metingSources: draft.metingSources.map((source, index) => {
          if (!dirtyMetingAuth.has(index)) {
            return { ...source, auth: '', clearAuth: false };
          }
          if (!String(source.auth || '').trim()) {
            return { ...source, auth: '', clearAuth: true };
          }
          return { ...source, clearAuth: false };
        }),
      };

      for (const group of RUNTIME_FIELD_GROUPS) {
        for (const field of group.fields) {
          if (!field.secret) continue;
          if (!dirtySecrets.has(field.key)) {
            payload[field.key] = '';
            continue;
          }
          if (!String(payload[field.key] || '').trim()) {
            clearSecrets.push(field.key);
            payload[field.key] = '';
          }
        }
      }

      const res = await adminFetch<{ config: RuntimeConfig }>('/api/admin/runtime-config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      applyLoadedConfig(res.config);
      void loadMusicApiStatus();
      message.success('已保存并立即生效');
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存运行配置失败');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <>
        {securityTab && (
          <Tabs
            activeKey="security"
            items={[{ key: 'security', label: '安全与账号', children: securityTab }]}
          />
        )}
        <AdminLoading tip="加载运行配置…" minHeight={200} />
      </>
    );
  }

  const markSecretDirty = (key: RuntimeTextField, nextValue: string) => {
    setDirtySecrets((prev) => {
      const next = new Set(prev);
      if (nextValue === (baselineSecrets[key] || '')) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderField = (field: RuntimeFieldDef) => {
    const configured = Boolean(draft.configuredSecrets[field.key]);
    const dirty = dirtySecrets.has(field.key);
    return (
      <Col xs={24} sm={12} key={field.key}>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {field.label}
          {field.secret && configured && !dirty && (
            <Tag color="success" style={{ marginLeft: 6 }}>已配置</Tag>
          )}
          {field.secret && dirty && !String(draft[field.key] || '').trim() && (
            <Tag color="warning" style={{ marginLeft: 6 }}>保存后关闭</Tag>
          )}
        </Typography.Text>
        <Input
          value={draft[field.key]}
          onChange={(e) => {
            const nextValue = e.target.value;
            setDraft({ ...draft, [field.key]: nextValue });
            if (field.secret) markSecretDirty(field.key, nextValue);
          }}
          placeholder={field.secret
            ? (configured ? '清空保存则关闭该功能' : '填入后启用')
            : field.placeholder}
          autoComplete="off"
          spellCheck={false}
          style={{ fontFamily: 'monospace' }}
        />
        {field.tip && (
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            {field.tip}
          </Typography.Text>
        )}
      </Col>
    );
  };

  const updateMetingSource = (
    index: number,
    patch: Partial<RuntimeConfig['metingSources'][number]>,
  ) => {
    const metingSources = draft.metingSources.map((source, sourceIndex) => (
      sourceIndex === index ? { ...source, ...patch } : source
    ));
    setDraft({ ...draft, metingSources });
  };

  const updateMusicApi = (index: number, patch: Partial<CustomMusicApi>) => {
    setDraft({
      ...draft,
      musicApis: draft.musicApis.map((api, apiIndex) => (
        apiIndex === index ? { ...api, ...patch } : api
      )),
    });
  };

  const previewMusicApi = async (api: CustomMusicApi) => {
    if (parsingApiId) return;
    setParsingApiId(api.id);
    try {
      const result = await adminFetch<{ response: unknown; paths: string[] }>('/api/admin/runtime-config/music-api-preview', {
        method: 'POST',
        body: JSON.stringify({
          api,
          variables: {
            id: '123456',
            keyword: '周杰伦',
            quality: '320',
            limit: '10',
            server: previewPlatforms[api.id] || api.platforms[0],
          },
        }),
      });
      setApiPreviews((prev) => ({ ...prev, [api.id]: result }));
      message.success('响应解析成功，请选择字段路径');
    } catch (err) {
      onError(err instanceof Error ? err.message : '接口解析失败');
    } finally {
      setParsingApiId('');
    }
  };

  const resetMusicApiCircuit = async (id: string) => {
    try {
      const status = await adminFetch<CustomMusicApiStatus>('/api/admin/runtime-config/music-api-circuit/reset', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      setMusicApiStatus(status);
      message.success('熔断状态已重置');
    } catch (err) {
      onError(err instanceof Error ? err.message : '重置熔断状态失败');
    }
  };

  const roomSection = (
      <SettingsSection
        title="房间"
        description="无人房间保留多久后自动销毁；设为 0 表示最后一人离开立即销毁。"
      >
        <Space>
          <InputNumber
            min={0}
            max={1440}
            step={1}
            value={Math.round(draft.roomEmptyTtlMs / 60000)}
            onChange={(val) => setDraft({ ...draft, roomEmptyTtlMs: Math.max(0, Number(val) || 0) * 60000 })}
            aria-label="空房销毁时间（分钟）"
            style={{ width: 100 }}
          />
          <Typography.Text type="secondary">分钟后销毁空房</Typography.Text>
        </Space>
      </SettingsSection>
  );

  const metingSection = (
      <SettingsSection
        title="Meting 音源"
        description="网易云 / QQ 音乐的标准 Meting 兼容源。多个源轮询使用，故障自动切换。"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {draft.metingSources.length === 0 && (
            <Empty description="暂无音源，点击下方按钮添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
          {draft.metingSources.map((source, index) => (
            <Card key={`${index}-${source.type}`} size="small" style={{ background: '#fafafa' }}>
              <Row gutter={[8, 8]} align="middle">
                <Col xs={24} sm={6}>
                  <Select
                    value={source.type}
                    aria-label={`音源 ${index + 1} 类型`}
                    style={{ width: '100%' }}
                    options={[
                      { value: 'meting', label: 'Meting' },
                    ]}
                    onChange={(type) => updateMetingSource(index, { type })}
                  />
                </Col>
                <Col xs={24} sm={16}>
                  <Input
                    value={source.url}
                    onChange={(e) => updateMetingSource(index, { url: e.target.value })}
                    placeholder="API 地址，如 https://music-api.example.com"
                    aria-label={`音源 ${index + 1} 地址`}
                    spellCheck={false}
                    style={{ fontFamily: 'monospace' }}
                  />
                </Col>
                <Col xs={24} sm={2} style={{ textAlign: 'right' }}>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`删除音源 ${index + 1}`}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        metingSources: draft.metingSources.filter((_, sourceIndex) => sourceIndex !== index),
                      });
                      setDirtyMetingAuth((prev) => {
                        const next = new Set<number>();
                        for (const dirtyIndex of prev) {
                          if (dirtyIndex < index) next.add(dirtyIndex);
                          else if (dirtyIndex > index) next.add(dirtyIndex - 1);
                        }
                        return next;
                      });
                      setBaselineMetingAuth((prev) => prev.filter((_, sourceIndex) => sourceIndex !== index));
                    }}
                  />
                </Col>
              </Row>
              <Space wrap style={{ marginTop: 8, width: '100%' }}>
                <Input
                  value={source.auth || ''}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    updateMetingSource(index, { auth: nextValue, clearAuth: false });
                    setDirtyMetingAuth((prev) => {
                      const next = new Set(prev);
                      if (nextValue === (baselineMetingAuth[index] || '')) next.delete(index);
                      else next.add(index);
                      return next;
                    });
                  }}
                  placeholder={source.configuredAuth
                    ? '清空保存则关闭 Auth'
                    : 'Auth 密钥，没有则留空'}
                  aria-label={`音源 ${index + 1} Auth 密钥`}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ fontFamily: 'monospace', flex: 1, minWidth: 200 }}
                />
                {source.configuredAuth && !dirtyMetingAuth.has(index) && (
                  <Tag color="success">已配置</Tag>
                )}
                {dirtyMetingAuth.has(index) && !String(source.auth || '').trim() && (
                  <Tag color="warning">保存后关闭</Tag>
                )}
              </Space>
            </Card>
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              if (draft.metingSources.length >= 20) return;
              setDraft({
                ...draft,
                metingSources: [
                  ...draft.metingSources,
                  { type: 'meting', url: '', auth: '', configuredAuth: false },
                ],
              });
            }}
            disabled={draft.metingSources.length >= 20}
          >
            添加音源
          </Button>
        </Space>
      </SettingsSection>
  );

  const customApiSection = (
      <SettingsSection
        title="自定义音乐接口"
        description="按平台和功能分别接入任意 JSON API；同一平台、同一功能可添加多个接口，服务端会轮询并在故障时自动切换。留空则该平台/功能默认走上面的 Meting 音源。"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            填好地址后点「解析响应」，再点字段旁的「选择」，在下方响应里点「选这个」即可完成映射，无需手写路径。
            URL、参数、请求头和 Body 支持 {'{id}'}、{'{keyword}'}、{'{quality}'}、{'{limit}'}、{'{server}'} 变量。
          </Typography.Text>
          {draft.musicApis.length === 0 && (
            <Empty description="暂无自定义接口" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
          {draft.musicApis.map((api, index) => {
            const scalarOperation = api.operations.length > 0
              && api.operations.every((operation) => operation === 'url' || operation === 'lrc' || operation === 'pic');
            const preview = apiPreviews[api.id];
            const routeStatuses = musicApiStatus?.routes.filter((route) => route.id === api.id) || [];
            const openRouteCount = routeStatuses.filter((route) => route.circuitState === 'open').length;
            const halfOpenRouteCount = routeStatuses.filter((route) => route.circuitState === 'half-open').length;
            const activePick = picking && picking.apiId === api.id ? picking.field : null;
            const mapping = api.mapping as Record<string, string | undefined>;
            const clearMapping = (field: string) => {
              const next = { ...mapping };
              delete next[field];
              updateMusicApi(index, { mapping: next as CustomMusicApi['mapping'] });
            };
            const renderPickerRow = (field: string, current: string | undefined, emptyHint = '未选择') => (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {current
                  ? <Tag color="blue" style={{ fontFamily: 'monospace', margin: 0 }}>{current}</Tag>
                  : <Typography.Text type="secondary" style={{ fontSize: 12 }}>{emptyHint}</Typography.Text>}
                <Tooltip title={preview ? '' : '请先点「解析响应」'}>
                  <Button
                    size="small"
                    type={activePick === field ? 'primary' : 'default'}
                    disabled={!preview}
                    onClick={() => setPicking(activePick === field ? null : { apiId: api.id, field })}
                  >
                    选择
                  </Button>
                </Tooltip>
                {current && (
                  <Button size="small" type="link" style={{ padding: 0 }} onClick={() => clearMapping(field)}>
                    清除
                  </Button>
                )}
              </div>
            );
            return (
              <Card
                key={api.id || index}
                size="small"
                title={api.name.trim() || `自定义接口 ${index + 1}`}
                extra={(
                  <Space wrap>
                    {openRouteCount > 0 ? (
                      <Tag color="error">熔断 {openRouteCount}</Tag>
                    ) : halfOpenRouteCount > 0 ? (
                      <Tag color="warning">半开探测</Tag>
                    ) : routeStatuses.length > 0 ? (
                      <Tag color="success">运行正常</Tag>
                    ) : null}
                    {(openRouteCount > 0 || halfOpenRouteCount > 0) && (
                      <Button size="small" onClick={() => void resetMusicApiCircuit(api.id)}>重置熔断</Button>
                    )}
                    <Switch
                      size="small"
                      checked={api.enabled}
                      onChange={(enabled) => updateMusicApi(index, { enabled })}
                    />
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`删除自定义接口 ${index + 1}`}
                      onClick={() => setDraft({
                        ...draft,
                        musicApis: draft.musicApis.filter((_, apiIndex) => apiIndex !== index),
                      })}
                    />
                  </Space>
                )}
                style={{ background: '#fafafa' }}
              >
                <Row gutter={[8, 8]}>
                  <Col xs={24} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>名称</Typography.Text>
                    <Input
                      value={api.name}
                      placeholder="例如：网易播放解析 1"
                      onChange={(e) => updateMusicApi(index, { name: e.target.value })}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>支持平台（可多选）</Typography.Text>
                    <Select
                      mode="multiple"
                      value={api.platforms}
                      options={MUSIC_API_PLATFORMS}
                      style={{ width: '100%' }}
                      onChange={(platforms) => updateMusicApi(index, { platforms })}
                    />
                  </Col>
                  <Col xs={24} sm={7}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>功能（可多选）</Typography.Text>
                    <Select
                      mode="multiple"
                      value={api.operations}
                      options={MUSIC_API_OPERATIONS}
                      style={{ width: '100%' }}
                      onChange={(operations) => updateMusicApi(index, { operations })}
                    />
                  </Col>
                  <Col xs={24} sm={3}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求方法</Typography.Text>
                    <Select
                      value={api.method}
                      options={[
                        { value: 'GET', label: 'GET' },
                        { value: 'POST', label: 'POST' },
                      ]}
                      style={{ width: '100%' }}
                      onChange={(method) => updateMusicApi(index, { method })}
                    />
                  </Col>
                  <Col span={24}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>备注（可选）</Typography.Text>
                    <Input.TextArea
                      value={api.remark || ''}
                      rows={2}
                      maxLength={1000}
                      showCount
                      placeholder="例如：供应商、套餐限制、联系人、用途或维护说明"
                      onChange={(e) => updateMusicApi(index, { remark: e.target.value })}
                    />
                  </Col>
                  <Col span={24}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>接口 URL 模板</Typography.Text>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        value={api.url}
                        placeholder="https://api.example.com/song"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace' }}
                        onChange={(e) => updateMusicApi(index, { url: e.target.value })}
                      />
                      {api.platforms.length > 1 && (
                        <Select
                          value={previewPlatforms[api.id] || api.platforms[0]}
                          options={MUSIC_API_PLATFORMS.filter((option) => api.platforms.includes(option.value))}
                          style={{ width: 120 }}
                          aria-label="解析测试平台"
                          onChange={(platform) => setPreviewPlatforms((prev) => ({ ...prev, [api.id]: platform }))}
                        />
                      )}
                      <Button
                        loading={parsingApiId === api.id}
                        disabled={!api.url.trim() || api.platforms.length === 0 || api.operations.length === 0 || Boolean(parsingApiId)}
                        onClick={() => void previewMusicApi(api)}
                      >
                        解析响应
                      </Button>
                    </Space.Compact>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>流量权重</Typography.Text>
                    <InputNumber
                      min={1}
                      max={1000}
                      value={api.weight}
                      style={{ width: '100%' }}
                      onChange={(value) => updateMusicApi(index, { weight: Number(value) || 1 })}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求超时</Typography.Text>
                    <InputNumber
                      min={1}
                      max={60}
                      value={Math.round(api.timeoutMs / 1000)}
                      addonAfter="秒"
                      style={{ width: '100%' }}
                      onChange={(value) => updateMusicApi(index, { timeoutMs: Math.max(1, Number(value) || 10) * 1000 })}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>连续失败熔断</Typography.Text>
                    <InputNumber
                      min={1}
                      max={20}
                      value={api.failureThreshold}
                      addonAfter="次"
                      style={{ width: '100%' }}
                      onChange={(value) => updateMusicApi(index, { failureThreshold: Number(value) || 1 })}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>熔断恢复等待</Typography.Text>
                    <InputNumber
                      min={5}
                      max={600}
                      value={Math.round(api.cooldownMs / 1000)}
                      addonAfter="秒"
                      style={{ width: '100%' }}
                      onChange={(value) => updateMusicApi(index, { cooldownMs: Math.max(5, Number(value) || 60) * 1000 })}
                    />
                  </Col>
                  <Col span={24}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      同一平台和功能下按权重分流（例如 100:50 约为 2:1）；达到失败阈值后仅熔断该接口的对应平台/功能，等待后自动半开探测。
                    </Typography.Text>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求参数 JSON（可选）</Typography.Text>
                    <Input.TextArea
                      value={api.params}
                      rows={3}
                      placeholder={'{"id":"{id}","limit":"{limit}"}'}
                      spellCheck={false}
                      style={{ fontFamily: 'monospace' }}
                      onChange={(e) => updateMusicApi(index, { params: e.target.value })}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求头 JSON（可选）</Typography.Text>
                    <Input.TextArea
                      value={api.headers}
                      rows={3}
                      placeholder={'{"Authorization":"Bearer token"}'}
                      spellCheck={false}
                      style={{ fontFamily: 'monospace' }}
                      onChange={(e) => updateMusicApi(index, { headers: e.target.value })}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求 Body JSON（POST 可选）</Typography.Text>
                    <Input.TextArea
                      value={api.body}
                      rows={3}
                      placeholder={'{"id":"{id}","keyword":"{keyword}"}'}
                      spellCheck={false}
                      style={{ fontFamily: 'monospace' }}
                      onChange={(e) => updateMusicApi(index, { body: e.target.value })}
                    />
                  </Col>
                  {scalarOperation ? api.operations.map((operation) => (
                    <Col xs={24} sm={8} key={operation}>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {MUSIC_API_OPERATIONS.find((item) => item.value === operation)?.label || operation}响应路径
                      </Typography.Text>
                      {renderPickerRow(operation, mapping[operation])}
                    </Col>
                  )) : (
                    <>
                      <Col span={24}>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>结果列表所在路径（数组或对象）</Typography.Text>
                        {renderPickerRow('items', api.mapping.items, '未选择（默认整个响应）')}
                      </Col>
                      {SONG_MAPPING_FIELDS.map((field) => (
                        <Col xs={12} sm={6} key={field.key}>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{field.label}</Typography.Text>
                          {renderPickerRow(field.key, mapping[field.key])}
                        </Col>
                      ))}
                    </>
                  )}
                  {preview && (
                    <Col span={24}>
                      {activePick ? (
                        <>
                          <Typography.Text style={{ fontSize: 12 }}>
                            正在为「{pickLabel(activePick, scalarOperation)}」选择字段：在下方点「选这个」
                            {activePick !== 'items' && !scalarOperation && (
                              <Typography.Text type="secondary" style={{ fontSize: 11 }}>（已展开结果列表中的第一条）</Typography.Text>
                            )}
                          </Typography.Text>
                          <div style={{ marginTop: 6 }}>
                            <JsonPathTree
                              value={pickTreeValue(api, activePick, scalarOperation, preview.response)}
                              containerOnly={activePick === 'items'}
                              activePath={mapping[activePick]}
                              onPick={(path) => {
                                if (!path) return;
                                const next = { ...mapping };
                                next[activePick] = path;
                                updateMusicApi(index, { mapping: next as CustomMusicApi['mapping'] });
                                setPicking(null);
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            格式化响应预览（点上方字段的「选择」后，可在此直接点选）
                          </Typography.Text>
                          <pre style={{
                            maxHeight: 280,
                            overflow: 'auto',
                            margin: '4px 0 0',
                            padding: 12,
                            borderRadius: 6,
                            background: '#111827',
                            color: '#e5e7eb',
                            fontSize: 11,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                          }}>
                            {JSON.stringify(preview.response, null, 2)}
                          </pre>
                        </>
                      )}
                    </Col>
                  )}
                </Row>
              </Card>
            );
          })}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            disabled={draft.musicApis.length >= 100}
            onClick={() => setDraft({
              ...draft,
              musicApis: [...draft.musicApis, createMusicApi()],
            })}
          >
            添加自定义接口
          </Button>
        </Space>
      </SettingsSection>
  );

  const renderFieldGroup = (group: RuntimeFieldGroup) => (
    <SettingsSection key={group.id} title={group.title} description={group.purpose}>
      <Row gutter={[16, 16]}>
        {group.fields.map(renderField)}
        {group.includeQiniuZone && (
          <Col xs={24} sm={12}>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              存储区域
            </Typography.Text>
            <Select
              value={draft.qiniuZone}
              aria-label="七牛存储区域"
              style={{ width: '100%' }}
              options={[
                { value: 'z0', label: '华东 z0' },
                { value: 'z1', label: '华北 z1' },
                { value: 'z2', label: '华南 z2' },
                { value: 'na0', label: '北美 na0' },
                { value: 'as0', label: '东南亚 as0' },
              ]}
              onChange={(zone) => setDraft({ ...draft, qiniuZone: zone })}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              须与创建 Bucket 时选的区域一致
            </Typography.Text>
          </Col>
        )}
      </Row>
    </SettingsSection>
  );

  const fieldGroup = (id: string) => {
    const group = RUNTIME_FIELD_GROUPS.find((item) => item.id === id);
    return group ? renderFieldGroup(group) : null;
  };

  const tabItems = [
    ...(securityTab
      ? [{ key: 'security', label: '安全与账号', children: securityTab }]
      : []),
    {
      key: 'music',
      label: '音源接入',
      children: (
        <>
          {metingSection}
          <Divider style={{ margin: 0 }} />
          {customApiSection}
        </>
      ),
    },
    {
      key: 'integration',
      label: '第三方服务',
      children: (
        <>
          {fieldGroup('cyapi')}
          <Divider style={{ margin: 0 }} />
          {fieldGroup('lyrics')}
          <Divider style={{ margin: 0 }} />
          {fieldGroup('qiniu')}
          <Divider style={{ margin: 0 }} />
          {fieldGroup('apihz')}
        </>
      ),
    },
    {
      key: 'room',
      label: '房间',
      children: roomSection,
    },
  ];

  return (
    <>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />

      {activeTab !== 'security' && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            marginTop: 'auto',
            marginLeft: -20,
            marginRight: -20,
            padding: '12px 20px',
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(8px)',
            borderTop: '1px solid #f0f0f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.04)',
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            密钥回显为首尾片段；未改动保持原值，清空保存则关闭，填入则更新
          </Typography.Text>
          <Button type="primary" onClick={() => void save()} loading={saving}>
            保存配置
          </Button>
        </div>
      )}
    </>
  );
}
