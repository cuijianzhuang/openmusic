import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  LogoutOutlined,
  MenuOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Drawer,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminProviders from './admin/AdminProviders';
import AdminLoading from './admin/AdminLoading';
import { ADMIN_TABS, AUDIT_PAGE_SIZE, LIST_PAGE_SIZE, TAB_META } from './admin/constants';
import CredentialsPanel from './admin/CredentialsPanel';
import InitialSetupGate from './admin/InitialSetupGate';
import LoginForm from './admin/LoginForm';
import OverviewDashboard from './admin/OverviewDashboard';
import RuntimeConfigPanel from './admin/RuntimeConfigPanel';
import SettingsSection from './admin/SettingsSection';
import type {
  AdminAuditEntry,
  AdminOverview,
  AdminRoom,
  AdminTabId,
  ErrorReportDetail,
  ErrorReportSummary,
  MetingUpstreamStatus,
  SiteAnnouncementConfig,
  SiteBanEntry,
} from './admin/types';
import {
  adminFetch,
  ADMIN_ROOM_STATUS_FILTERS,
  createRandomEntryPath,
  filterAdminRooms,
  formatAuditAction,
  formatAuditTime,
  type AdminRoomStatusFilter,
} from './admin/utils';

const { Header, Sider, Content } = Layout;

const REPORT_DEBUG_PRE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.55,
  minHeight: 360,
  maxHeight: 'min(52vh, 520px)',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  padding: '12px 14px',
  background: 'rgba(0,0,0,0.02)',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.06)',
};

function buildReportDebugTabItems(report: ErrorReportDetail) {
  const items = [
    {
      key: 'meta',
      label: '上下文',
      children: (
        <pre style={REPORT_DEBUG_PRE_STYLE}>
          {JSON.stringify(report.meta || {}, null, 2)}
        </pre>
      ),
    },
  ];

  if (report.type !== 'feedback') {
    const snapshotText = report.snapshot
      || (report.snapshots?.length
        ? report.snapshots.map((section) => `=== ${section.title} ===\n${section.content}`).join('\n\n')
        : '');

    if (snapshotText) {
      items.push({
        key: 'snapshots',
        label: 'Debug 快照',
        children: (
          <pre style={REPORT_DEBUG_PRE_STYLE}>{snapshotText}</pre>
        ),
      });
    }

    items.push({
      key: 'events',
      label: `事件 (${report.events?.length || 0})`,
      children: (
        <pre style={REPORT_DEBUG_PRE_STYLE}>
          {(report.events || [])
            .map((ev) => `[${ev.at}] ${ev.name}${ev.line ? ` ${ev.line}` : ''}`.trimEnd())
            .join('\n') || '（无）'}
        </pre>
      ),
    });
  }

  return items;
}

function AdminPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [error, setError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [protectingId, setProtectingId] = useState<string | null>(null);
  const [entryPathDraft, setEntryPathDraft] = useState(
    () => (typeof window !== 'undefined' ? window.location.pathname : ''),
  );
  const [savingPath, setSavingPath] = useState(false);
  const [pathHint, setPathHint] = useState('');
  const [annEnabled, setAnnEnabled] = useState(false);
  const [annTitle, setAnnTitle] = useState('站点公告');
  const [annText, setAnnText] = useState('');
  const [annBumpId, setAnnBumpId] = useState(false);
  const [annSaving, setAnnSaving] = useState(false);
  const [annHint, setAnnHint] = useState('');
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastHint, setBroadcastHint] = useState('');
  const [bans, setBans] = useState<SiteBanEntry[]>([]);
  const [banType, setBanType] = useState<'ip' | 'device'>('ip');
  const [banValue, setBanValue] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banSaving, setBanSaving] = useState(false);
  const [banHint, setBanHint] = useState('');
  const [errorReports, setErrorReports] = useState<ErrorReportSummary[]>([]);
  const [reportDetail, setReportDetail] = useState<ErrorReportDetail | null>(null);
  const [reportDetailLoading, setReportDetailLoading] = useState(false);
  const [reportBusyId, setReportBusyId] = useState<string | null>(null);
  const [reportNoteDraft, setReportNoteDraft] = useState('');
  const [upstreamBusyUrl, setUpstreamBusyUrl] = useState<string | null>(null);
  const [auditItems, setAuditItems] = useState<AdminAuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [roomsPage, setRoomsPage] = useState(1);
  const [roomsPageSize, setRoomsPageSize] = useState(LIST_PAGE_SIZE);
  const [roomsKeyword, setRoomsKeyword] = useState('');
  const [roomsStatusFilter, setRoomsStatusFilter] = useState<AdminRoomStatusFilter[]>([]);
  const [bansPage, setBansPage] = useState(1);
  const [reportsPage, setReportsPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const annLoadedRef = useRef(false);
  const loadingRef = useRef(false);
  const savedEntryPathRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await adminFetch('/api/admin/session');
        if (!cancelled) setLoggedIn(true);
      } catch {
        if (!cancelled) setLoggedIn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminFetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // 即使请求失败也清本地 UI 状态
    }
    setLoggedIn(false);
    setOverview(null);
    setRooms([]);
    setBans([]);
    setErrorReports([]);
    setReportDetail(null);
    setAuditItems([]);
    setAuditTotal(0);
    setAuditPage(1);
  }, []);

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    try {
      const [ov, rm, banRes, reportRes] = await Promise.all([
        adminFetch<AdminOverview>('/api/admin/overview'),
        adminFetch<{ rooms: AdminRoom[] }>('/api/admin/rooms'),
        adminFetch<{ bans: SiteBanEntry[] }>('/api/admin/bans'),
        adminFetch<{ reports: ErrorReportSummary[] }>('/api/admin/error-reports'),
      ]);
      setOverview(ov);
      setRooms(rm.rooms);
      setBans(banRes.bans);
      setErrorReports(reportRes.reports);
      if (ov.entryPath) {
        setEntryPathDraft((draft) => {
          if (savedEntryPathRef.current === null || draft === savedEntryPathRef.current) {
            savedEntryPathRef.current = ov.entryPath!;
            return ov.entryPath!;
          }
          return draft;
        });
        if (savedEntryPathRef.current === null) savedEntryPathRef.current = ov.entryPath;
      }
      setError('');
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : '加载失败';
      setError(errMessage);
      const status = err && typeof err === 'object' && 'status' in err
        ? Number((err as { status?: number }).status)
        : 0;
      if (status === 401 || status === 503) setLoggedIn(false);
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [loggedIn, refresh]);

  const loadAudit = useCallback(async (page: number) => {
    setAuditLoading(true);
    try {
      const res = await adminFetch<{
        items: AdminAuditEntry[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      }>(`/api/admin/audit?page=${page}&pageSize=${AUDIT_PAGE_SIZE}`);
      const maxPage = Math.max(1, res.totalPages || 1);
      if (page > maxPage) {
        setAuditPage(maxPage);
        return;
      }
      setAuditItems(res.items);
      setAuditTotal(res.total);
      setAuditPage(res.page);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审计日志失败');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loggedIn || activeTab !== 'audit') return;
    void loadAudit(auditPage);
  }, [loggedIn, activeTab, auditPage, loadAudit]);

  useEffect(() => {
    if (!loggedIn || annLoadedRef.current) return;
    (async () => {
      try {
        const res = await adminFetch<{ announcement: SiteAnnouncementConfig }>('/api/admin/announcement');
        annLoadedRef.current = true;
        setAnnEnabled(res.announcement.enabled);
        setAnnTitle(res.announcement.title || '站点公告');
        setAnnText(res.announcement.text || '');
      } catch {
        // 拉取失败不阻塞面板，保存时仍可覆盖
      }
    })();
  }, [loggedIn]);

  const saveAnnouncement = useCallback(async () => {
    if (annSaving) return;
    setAnnSaving(true);
    setAnnHint('');
    try {
      const res = await adminFetch<{ announcement: SiteAnnouncementConfig }>('/api/admin/announcement', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: annEnabled,
          title: annTitle.trim(),
          text: annText.trim(),
          bumpId: annBumpId,
        }),
      });
      setAnnEnabled(res.announcement.enabled);
      setAnnTitle(res.announcement.title);
      setAnnText(res.announcement.text);
      setAnnBumpId(false);
      const hint = res.announcement.enabled
        ? (annBumpId ? '已保存并作为新公告发布（所有用户重新弹窗）' : '已保存')
        : '已保存（公告处于停用状态）';
      setAnnHint(hint);
      message.success(hint);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存公告失败');
    } finally {
      setAnnSaving(false);
    }
  }, [annBumpId, annEnabled, annSaving, annText, annTitle, message]);

  const dissolveRoom = useCallback(async (room: AdminRoom) => {
    setDeletingId(room.id);
    try {
      await adminFetch(`/api/admin/rooms/${room.id}`, { method: 'DELETE' });
      setPendingDeleteId(null);
      message.success(`已解散房间 ${room.name}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解散失败');
    } finally {
      setDeletingId(null);
    }
  }, [message, refresh]);

  const toggleRoomProtection = useCallback(async (room: AdminRoom) => {
    setProtectingId(room.id);
    try {
      await adminFetch(`/api/admin/rooms/${room.id}/protection`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !room.protectedFromDestroy }),
      });
      message.success(room.protectedFromDestroy ? '已取消房间保活' : '已设为保活');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新房间保活状态失败');
    } finally {
      setProtectingId(null);
    }
  }, [message, refresh]);

  const resetUpstreamCooldown = useCallback(async (url: string) => {
    setUpstreamBusyUrl(url);
    try {
      await adminFetch('/api/admin/meting/reset-cooldown', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      message.success('已重置上游冷却');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置冷却失败');
    } finally {
      setUpstreamBusyUrl(null);
    }
  }, [message, refresh]);

  const toggleUpstreamDisabled = useCallback(async (up: MetingUpstreamStatus) => {
    setUpstreamBusyUrl(up.url);
    try {
      await adminFetch('/api/admin/meting/disable', {
        method: 'POST',
        body: JSON.stringify({ url: up.url, disabled: !up.disabled }),
      });
      message.success(up.disabled ? '已启用上游' : '已临时禁用上游');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新上游状态失败');
    } finally {
      setUpstreamBusyUrl(null);
    }
  }, [message, refresh]);

  const sendBroadcast = useCallback(async () => {
    if (broadcasting || !broadcastText.trim()) return;
    setBroadcasting(true);
    setBroadcastHint('');
    try {
      const res = await adminFetch<{ roomCount: number }>('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({ text: broadcastText.trim() }),
      });
      setBroadcastText('');
      const hint = `已发送到 ${res.roomCount} 个房间`;
      setBroadcastHint(hint);
      message.success(hint);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '广播失败');
    } finally {
      setBroadcasting(false);
    }
  }, [broadcastText, broadcasting, message, refresh]);

  const addBan = useCallback(async () => {
    if (banSaving || !banValue.trim()) return;
    setBanSaving(true);
    setBanHint('');
    try {
      const res = await adminFetch<{ kicked: number }>('/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({
          type: banType,
          value: banValue.trim(),
          reason: banReason.trim(),
        }),
      });
      setBanValue('');
      setBanReason('');
      const hint = `已封禁${typeof res.kicked === 'number' && res.kicked > 0 ? `，踢出 ${res.kicked} 个在线连接` : ''}`;
      setBanHint(hint);
      message.success(hint);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '封禁失败');
    } finally {
      setBanSaving(false);
    }
  }, [banReason, banSaving, banType, banValue, message, refresh]);

  const removeBan = useCallback(async (banId: string) => {
    try {
      await adminFetch(`/api/admin/bans/${banId}`, { method: 'DELETE' });
      message.success('已解封');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解封失败');
    }
  }, [message, refresh]);

  const openErrorReport = useCallback(async (id: string) => {
    setReportDetailLoading(true);
    try {
      const res = await adminFetch<{ report: ErrorReportDetail }>(`/api/admin/error-reports/${id}`);
      setReportDetail(res.report);
      setReportNoteDraft(res.report.note || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载上报详情失败');
    } finally {
      setReportDetailLoading(false);
    }
  }, []);

  const resolveErrorReport = useCallback(async (id: string, status: 'open' | 'resolved') => {
    setReportBusyId(id);
    try {
      const payload: { status: 'open' | 'resolved'; note?: string } = { status };
      if (reportDetail?.id === id) {
        payload.note = reportNoteDraft;
      } else if (status === 'resolved') {
        message.warning('请先打开详情填写解决方案后再标记已处理');
        setReportBusyId(null);
        void openErrorReport(id);
        return;
      }
      if (status === 'resolved' && !(payload.note || '').trim()) {
        message.warning('请填写解决方案后再标记已处理');
        setReportBusyId(null);
        return;
      }
      const res = await adminFetch<{ report: ErrorReportDetail; delivered?: number }>(`/api/admin/error-reports/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (reportDetail?.id === id) setReportDetail(res.report);
      if (status === 'resolved') {
        const online = res.delivered ? `（已推送给 ${res.delivered} 个在线连接）` : '（用户下次进入时会看到）';
        message.success(`已标记为已处理${online}`);
      } else {
        message.success('已重开');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新上报失败');
    } finally {
      setReportBusyId(null);
    }
  }, [message, openErrorReport, refresh, reportDetail?.id, reportNoteDraft]);

  const deleteErrorReportItem = useCallback(async (id: string) => {
    modal.confirm({
      title: '确定删除这条错误上报？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setReportBusyId(id);
        try {
          await adminFetch(`/api/admin/error-reports/${id}`, { method: 'DELETE' });
          if (reportDetail?.id === id) setReportDetail(null);
          message.success('已删除');
          await refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : '删除上报失败');
        } finally {
          setReportBusyId(null);
        }
      },
    });
  }, [message, modal, refresh, reportDetail?.id]);

  const quickBan = useCallback((type: 'ip' | 'device', value: string) => {
    if (!value) return;
    setBanType(type);
    setBanValue(value);
    setBanHint(`已填入${type === 'ip' ? ' IP' : ' deviceId'}，确认后点击「添加封禁」`);
    setActiveTab('bans');
    setMobileMenuOpen(false);
  }, []);

  const randomizeEntryPath = useCallback(() => {
    setEntryPathDraft(createRandomEntryPath());
    setPathHint('已生成随机地址，点击保存后生效');
  }, []);

  const saveEntryPath = useCallback(async () => {
    if (savingPath) return;
    setSavingPath(true);
    setPathHint('');
    try {
      const res = await adminFetch<{ entryPath: string }>('/api/admin/entry-path', {
        method: 'PUT',
        body: JSON.stringify({ path: entryPathDraft.trim() }),
      });
      savedEntryPathRef.current = res.entryPath;
      setEntryPathDraft(res.entryPath);
      setOverview((prev) => (prev ? { ...prev, entryPath: res.entryPath } : prev));
      setPathHint('已保存，请收藏新地址');
      message.success('已保存，请收藏新地址');
      if (window.location.pathname !== res.entryPath) {
        navigate(res.entryPath, { replace: true });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存登录地址失败');
    } finally {
      setSavingPath(false);
    }
  }, [entryPathDraft, message, navigate, refresh, savingPath]);

  const openReportCount = errorReports.filter((r) => r.status === 'open').length;
  const reportDebugTabItems = useMemo(
    () => (reportDetail ? buildReportDebugTabItems(reportDetail) : []),
    [reportDetail],
  );

  const handleTabChange = (tab: AdminTabId) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const menuItems = ADMIN_TABS.map((tab) => ({
    key: tab.id,
    icon: tab.icon,
    label: tab.id === 'reports' && openReportCount > 0
      ? (
        <Badge count={openReportCount} size="small" offset={[8, 0]}>
          {tab.label}
        </Badge>
      )
      : tab.label,
  }));

  useEffect(() => {
    setRoomsPage(1);
  }, [roomsKeyword, roomsStatusFilter, roomsPageSize]);

  const filteredRooms = useMemo(
    () => filterAdminRooms(rooms, roomsKeyword, roomsStatusFilter),
    [rooms, roomsKeyword, roomsStatusFilter],
  );

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRooms.length / roomsPageSize) || 1);
    if (roomsPage > maxPage) setRoomsPage(maxPage);
  }, [filteredRooms.length, roomsPage, roomsPageSize]);

  const roomColumns: ColumnsType<AdminRoom> = [
    {
      title: '房间',
      width: 200,
      render: (_, room) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong ellipsis style={{ maxWidth: 180 }}>
            {room.name}
          </Typography.Text>
          <Typography.Text type="secondary" code style={{ fontSize: 11 }}>
            {room.id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      width: 160,
      render: (_, room) => (
        <Space size={[4, 4]} wrap>
          {room.hasPassword && <Tag color="gold">密码</Tag>}
          {room.isLocked && <Tag color="red">上锁</Tag>}
          {room.protectedFromDestroy && <Tag color="green">保活</Tag>}
          {!room.hasPassword && !room.isLocked && !room.protectedFromDestroy && (
            <Typography.Text type="secondary">—</Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '在线',
      width: 72,
      align: 'center',
      render: (_, room) => (
        <Typography.Text>{room.userCount}</Typography.Text>
      ),
    },
    {
      title: '当前播放',
      ellipsis: true,
      render: (_, room) => (
        room.currentSong ? (
          <Space size={6}>
            <Tag color={room.isPlaying ? 'processing' : 'default'} style={{ margin: 0 }}>
              {room.isPlaying ? '播放中' : '已暂停'}
            </Tag>
            <Typography.Text ellipsis style={{ maxWidth: 220 }}>
              {room.currentSong.name}
              <Typography.Text type="secondary"> · {room.currentSong.artist}</Typography.Text>
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">未在播放</Typography.Text>
        )
      ),
    },
    {
      title: '队列',
      width: 64,
      align: 'center',
      dataIndex: 'queueLength',
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, room) => (
        <Space size="small" onClick={(e) => e.stopPropagation()}>
          <Button
            size="small"
            type={room.protectedFromDestroy ? 'primary' : 'default'}
            ghost={room.protectedFromDestroy}
            icon={<SafetyCertificateOutlined />}
            loading={protectingId === room.id}
            onClick={(e) => {
              e.stopPropagation();
              void toggleRoomProtection(room);
            }}
          >
            {room.protectedFromDestroy ? '取消保活' : '保活'}
          </Button>
          {pendingDeleteId === room.id ? (
            <Space size={4}>
              <Button
                size="small"
                danger
                type="primary"
                loading={deletingId === room.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void dissolveRoom(room);
                }}
              >
                确认
              </Button>
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDeleteId(null);
                }}
              >
                取消
              </Button>
            </Space>
          ) : (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                setPendingDeleteId(room.id);
              }}
            >
              解散
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const banColumns: ColumnsType<SiteBanEntry> = [
    {
      title: '类型',
      width: 88,
      render: (_, ban) => (
        <Tag color={ban.type === 'ip' ? 'blue' : 'purple'}>
          {ban.type === 'ip' ? 'IP' : '设备'}
        </Tag>
      ),
    },
    {
      title: '封禁值',
      dataIndex: 'value',
      render: (v) => <Typography.Text code copyable={{ text: v }}>{v}</Typography.Text>,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      ellipsis: true,
      render: (v) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '时间',
      width: 168,
      render: (_, ban) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatAuditTime(ban.at)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 88,
      render: (_, ban) => (
        <Button size="small" onClick={() => void removeBan(ban.id)}>解封</Button>
      ),
    },
  ];

  const reportColumns: ColumnsType<ErrorReportSummary> = [
    {
      title: '类型',
      width: 88,
      render: (_, report) => (
        <Tag color={report.type === 'feedback' ? 'blue' : 'default'}>
          {report.type === 'feedback' ? '意见' : '错误'}
        </Tag>
      ),
    },
    {
      title: '状态',
      width: 96,
      render: (_, report) => (
        <Tag color={report.status === 'open' ? 'warning' : 'success'}>
          {report.status === 'open' ? '待处理' : '已处理'}
        </Tag>
      ),
    },
    {
      title: '问题描述',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: '来源',
      width: 200,
      ellipsis: true,
      render: (_, report) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {[
            report.meta.nickname,
            report.meta.roomId ? `房间 ${report.meta.roomId}` : null,
            report.ip,
          ].filter(Boolean).join(' · ') || '—'}
        </Typography.Text>
      ),
    },
    {
      title: '时间',
      width: 168,
      render: (_, report) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatAuditTime(report.createdAt)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, report) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => void openErrorReport(report.id)}>
            处理
          </Button>
          <Button
            size="small"
            type="link"
            danger
            loading={reportBusyId === report.id}
            onClick={() => void deleteErrorReportItem(report.id)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const auditColumns: ColumnsType<AdminAuditEntry> = [
    {
      title: '时间',
      width: 160,
      render: (_, entry) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatAuditTime(entry.at)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      render: (_, entry) => formatAuditAction(entry),
    },
    {
      title: 'IP',
      width: 130,
      render: (_, entry) => entry.ip ? <Typography.Text code style={{ fontSize: 11 }}>{entry.ip}</Typography.Text> : '—',
    },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewDashboard
            overview={overview}
            openReportCount={openReportCount}
            upstreamBusyUrl={upstreamBusyUrl}
            onResetCooldown={(url) => void resetUpstreamCooldown(url)}
            onToggleDisabled={(up) => void toggleUpstreamDisabled(up)}
            onGoReports={() => setActiveTab('reports')}
          />
        );

      case 'rooms':
        return (
          <Card
            title="房间列表"
            extra={(
              <Typography.Text type="secondary">
                {roomsKeyword || roomsStatusFilter.length > 0
                  ? `筛选 ${filteredRooms.length} / 共 ${rooms.length} 个活跃房间`
                  : `共 ${rooms.length} 个活跃房间`}
                {' · 点击行展开成员并快捷封禁'}
              </Typography.Text>
            )}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Row gutter={[12, 12]} align="middle">
                <Col xs={24} lg={10}>
                  <Input.Search
                    placeholder="搜索房间名、ID、成员、IP、歌曲"
                    allowClear
                    value={roomsKeyword}
                    onChange={(e) => setRoomsKeyword(e.target.value)}
                  />
                </Col>
                <Col xs={24} lg={10}>
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="状态筛选（满足任一）"
                    style={{ width: '100%' }}
                    value={roomsStatusFilter}
                    options={ADMIN_ROOM_STATUS_FILTERS}
                    onChange={setRoomsStatusFilter}
                    maxTagCount="responsive"
                  />
                </Col>
                <Col xs={24} lg={4}>
                  <Button
                    block
                    disabled={!roomsKeyword && roomsStatusFilter.length === 0}
                    onClick={() => {
                      setRoomsKeyword('');
                      setRoomsStatusFilter([]);
                    }}
                  >
                    重置筛选
                  </Button>
                </Col>
              </Row>
              <Table
                rowKey="id"
                size="middle"
                columns={roomColumns}
                dataSource={filteredRooms}
                scroll={{ x: 960 }}
                pagination={{
                  current: roomsPage,
                  pageSize: roomsPageSize,
                  total: filteredRooms.length,
                  onChange: (page, pageSize) => {
                    setRoomsPage(page);
                    if (pageSize && pageSize !== roomsPageSize) setRoomsPageSize(pageSize);
                  },
                  showTotal: (total) => `共 ${total} 条`,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 15, 20, 50],
                }}
                locale={{ emptyText: rooms.length === 0 ? '当前没有活跃房间' : '没有匹配的房间' }}
                onRow={(room) => ({
                  style: room.users.length > 0 ? { cursor: 'pointer' } : undefined,
                })}
                expandable={{
                  expandRowByClick: true,
                  rowExpandable: (room) => room.users.length > 0,
                  expandIcon: ({ expanded, onExpand, record }) => (
                    record.users.length > 0 ? (
                      <RightOutlined
                        rotate={expanded ? 90 : 0}
                        onClick={(e) => onExpand(record, e)}
                        style={{
                          fontSize: 11,
                          color: 'rgba(0, 0, 0, 0.45)',
                          transition: 'transform 0.2s',
                        }}
                      />
                    ) : (
                      <span style={{ display: 'inline-block', width: 11 }} />
                    )
                  ),
                  expandedRowRender: (room) => (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="id"
                      dataSource={room.users}
                      columns={[
                        {
                          title: '昵称',
                          dataIndex: 'nickname',
                          width: 140,
                        },
                        {
                          title: 'IP',
                          render: (_, u) => (
                            u.clientIp ? (
                              <Space size={8}>
                                <Typography.Text code copyable={{ text: u.clientIp }}>
                                  {u.clientIp}
                                </Typography.Text>
                                <Button size="small" onClick={() => quickBan('ip', u.clientIp!)}>
                                  封禁 IP
                                </Button>
                              </Space>
                            ) : (
                              <Typography.Text type="secondary">—</Typography.Text>
                            )
                          ),
                        },
                        {
                          title: '设备 ID',
                          render: (_, u) => (
                            u.deviceId ? (
                              <Space size={8}>
                                <Typography.Text
                                  code
                                  copyable={{ text: u.deviceId }}
                                  ellipsis
                                  style={{ maxWidth: 220 }}
                                >
                                  {u.deviceId}
                                </Typography.Text>
                                <Button size="small" onClick={() => quickBan('device', u.deviceId!)}>
                                  封禁设备
                                </Button>
                              </Space>
                            ) : (
                              <Typography.Text type="secondary">—</Typography.Text>
                            )
                          ),
                        },
                      ]}
                    />
                  ),
                }}
              />
            </Space>
          </Card>
        );

      case 'bans':
        return (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="添加封禁" size="small">
              <Form layout="vertical" style={{ marginBottom: 0 }}>
                <Row gutter={16}>
                  <Col xs={24} sm={6} md={4}>
                    <Form.Item label="类型" style={{ marginBottom: 12 }}>
                      <Select
                        value={banType}
                        aria-label="封禁类型"
                        options={[
                          { value: 'ip', label: 'IP' },
                          { value: 'device', label: 'deviceId' },
                        ]}
                        onChange={setBanType}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={10} md={8}>
                    <Form.Item
                      label={banType === 'ip' ? 'IP 地址' : '设备 ID'}
                      style={{ marginBottom: 12 }}
                    >
                      <Input
                        value={banValue}
                        onChange={(e) => setBanValue(e.target.value)}
                        placeholder={banType === 'ip' ? '例如 1.2.3.4' : '客户端 deviceId'}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8} md={6}>
                    <Form.Item label="原因（可选）" style={{ marginBottom: 12 }}>
                      <Input
                        value={banReason}
                        onChange={(e) => setBanReason(e.target.value)}
                        placeholder="简要说明"
                        maxLength={80}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={24} md={6}>
                    <Form.Item label=" " colon={false} style={{ marginBottom: 12 }}>
                      <Button
                        type="primary"
                        loading={banSaving}
                        disabled={!banValue.trim()}
                        onClick={() => void addBan()}
                        block
                      >
                        添加封禁
                      </Button>
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
              {banHint && (
                <Alert type="success" showIcon message={banHint} style={{ marginBottom: 8 }} />
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                封禁后无法进房 / 建房。可从「房间管理」展开成员行一键填入。
              </Typography.Text>
            </Card>
            <Card title={`封禁记录（${bans.length}）`}>
              <Table
                rowKey="id"
                size="middle"
                columns={banColumns}
                dataSource={bans}
                pagination={{
                  current: bansPage,
                  pageSize: LIST_PAGE_SIZE,
                  total: bans.length,
                  onChange: setBansPage,
                  showTotal: (total) => `共 ${total} 条`,
                  showSizeChanger: false,
                }}
                locale={{ emptyText: '暂无封禁记录' }}
              />
            </Card>
          </Space>
        );

      case 'reports':
        return (
          <Card
            title="错误上报"
            extra={(
              <Space size={12}>
                <Typography.Text type="secondary">共 {errorReports.length} 条</Typography.Text>
                {errorReports.some((r) => r.status === 'open') && (
                  <Tag color="warning">
                    待处理 {errorReports.filter((r) => r.status === 'open').length}
                  </Tag>
                )}
              </Space>
            )}
          >
            <Table
              rowKey="id"
              size="middle"
              columns={reportColumns}
              dataSource={errorReports}
              scroll={{ x: 760 }}
              pagination={{
                current: reportsPage,
                pageSize: LIST_PAGE_SIZE,
                total: errorReports.length,
                onChange: setReportsPage,
                showTotal: (total) => `共 ${total} 条`,
                showSizeChanger: false,
              }}
              locale={{ emptyText: '暂无用户上报' }}
            />
          </Card>
        );

      case 'notify':
        return (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card
              title="首页站点公告"
              extra={<Switch checked={annEnabled} onChange={setAnnEnabled} checkedChildren="启用" unCheckedChildren="停用" />}
            >
              <Form layout="vertical">
                <Form.Item label="公告标题">
                  <Input value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} maxLength={40} />
                </Form.Item>
                <Form.Item label="公告内容">
                  <Input.TextArea value={annText} onChange={(e) => setAnnText(e.target.value)} maxLength={4000} rows={4} />
                </Form.Item>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Checkbox checked={annBumpId} onChange={(e) => setAnnBumpId(e.target.checked)}>
                    作为新公告发布（已读用户重新弹窗）
                  </Checkbox>
                  <Button
                    type="primary"
                    loading={annSaving}
                    disabled={annEnabled && !annText.trim()}
                    onClick={() => void saveAnnouncement()}
                  >
                    保存公告
                  </Button>
                </Space>
                {annHint && <Typography.Text type="success" style={{ display: 'block', marginTop: 8 }}>{annHint}</Typography.Text>}
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  保存后立即生效，并写入 Redis 持久化
                </Typography.Text>
              </Form>
            </Card>
            <Card title="全局广播">
              <Form layout="vertical">
                <Form.Item label="广播内容">
                  <Input.TextArea
                    value={broadcastText}
                    onChange={(e) => setBroadcastText(e.target.value)}
                    maxLength={300}
                    rows={2}
                    placeholder="向所有房间发送系统通知（维护 / 活动预告）"
                  />
                </Form.Item>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    会写入各房间聊天记录，并弹出短暂提示
                  </Typography.Text>
                  <Button
                    type="primary"
                    loading={broadcasting}
                    disabled={!broadcastText.trim()}
                    onClick={() => void sendBroadcast()}
                  >
                    发送广播
                  </Button>
                </Space>
                {broadcastHint && <Typography.Text type="success" style={{ display: 'block', marginTop: 8 }}>{broadcastHint}</Typography.Text>}
              </Form>
            </Card>
          </Space>
        );

      case 'settings':
        return (
          <Card
            className="admin-settings-card"
            styles={{ body: { padding: '8px 20px 0' } }}
            style={{
              flex: '1 0 auto',
              display: 'flex',
              flexDirection: 'column',
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
            }}
          >
            <RuntimeConfigPanel
              onError={setError}
              securityTab={(
                <>
                  <SettingsSection title="登录地址" description="管理后台的入口路径。修改后旧地址失效，请收藏新链接。">
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Input
                        addonBefore={typeof window !== 'undefined' ? window.location.origin : ''}
                        value={entryPathDraft}
                        onChange={(e) => {
                          setEntryPathDraft(e.target.value);
                          setPathHint('');
                        }}
                        spellCheck={false}
                        placeholder="/随机路径"
                        suffix={(
                          <Button
                            type="text"
                            size="small"
                            icon={<ReloadOutlined />}
                            onClick={randomizeEntryPath}
                            title="随机生成登录地址"
                            aria-label="随机生成登录地址"
                          />
                        )}
                        style={{ fontFamily: 'monospace' }}
                      />
                      <Button
                        type="primary"
                        loading={savingPath}
                        disabled={!entryPathDraft.trim() || entryPathDraft === overview?.entryPath}
                        onClick={() => void saveEntryPath()}
                      >
                        保存
                      </Button>
                      {pathHint && <Typography.Text type="success">{pathHint}</Typography.Text>}
                    </Space>
                  </SettingsSection>
                  <Divider style={{ margin: 0 }} />
                  <SettingsSection
                    title="管理员账号"
                    badge={(
                      <Tag color={(overview?.credentialsPersisted ?? true) ? 'success' : 'error'}>
                        {(overview?.credentialsPersisted ?? true) ? 'Redis 持久化' : 'Redis 未就绪'}
                      </Tag>
                    )}
                    description="密码以 scrypt 哈希存 Redis；新密码至少 8 位。修改后其它登录会话立即失效。"
                  >
                    <CredentialsPanel
                      bare
                      adminUsername={overview?.adminUsername || ''}
                      persisted={overview?.credentialsPersisted ?? true}
                      onError={setError}
                      onSaved={() => void refresh()}
                    />
                  </SettingsSection>
                </>
              )}
            />
          </Card>
        );

      case 'audit':
        return (
          <Card title={`操作审计（${auditTotal}，Redis 持久化）`}>
            <Table
              rowKey={(entry, idx) => `${entry.at}-${entry.action}-${idx}`}
              size="small"
              loading={auditLoading}
              columns={auditColumns}
              dataSource={auditItems}
              pagination={{
                current: auditPage,
                pageSize: AUDIT_PAGE_SIZE,
                total: auditTotal,
                onChange: setAuditPage,
                showTotal: (total) => `共 ${total} 条`,
                showSizeChanger: false,
              }}
              locale={{ emptyText: '暂无操作记录' }}
            />
          </Card>
        );

      default:
        return null;
    }
  };

  if (loggedIn === null) {
    return (
      <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
        <Content style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AdminLoading minHeight="100vh" tip="加载中…" />
        </Content>
      </Layout>
    );
  }

  if (!loggedIn) {
    return <LoginForm onLoggedIn={() => setLoggedIn(true)} />;
  }

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {overview?.setupRequired && (
        <InitialSetupGate overview={overview} onError={setError} onUpdated={() => void refresh()} />
      )}

      <Sider
        width={220}
        breakpoint="md"
        collapsedWidth={0}
        style={{
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          height: '100vh',
          overflow: 'auto',
          position: 'sticky',
          top: 0,
          insetInlineStart: 0,
        }}
        className="admin-desktop-sider"
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div style={{ padding: '20px 16px 12px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <SafetyCertificateOutlined style={{ fontSize: 20, color: '#1677ff' }} />
            <Typography.Text strong>站点管理后台</Typography.Text>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[activeTab]}
            items={menuItems}
            onClick={({ key }) => handleTabChange(key as AdminTabId)}
            style={{ borderInlineEnd: 'none', flex: 1, overflow: 'auto' }}
          />
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
            <Button type="text" danger icon={<LogoutOutlined />} block onClick={() => void logout()}>
              退出登录
            </Button>
          </div>
        </div>
      </Sider>

      <Drawer
        title="站点管理后台"
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        styles={{ body: { padding: 0 } }}
        width={260}
      >
        <Menu
          mode="inline"
          selectedKeys={[activeTab]}
          items={menuItems}
          onClick={({ key }) => handleTabChange(key as AdminTabId)}
        />
        <div style={{ padding: 12 }}>
          <Button type="text" danger icon={<LogoutOutlined />} block onClick={() => void logout()}>
            退出登录
          </Button>
        </div>
      </Drawer>

      <Layout style={{ height: '100vh', overflow: 'hidden', minWidth: 0 }}>
        <Header
          className="admin-page-header"
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            borderBottom: '1px solid #f0f0f0',
            height: 56,
            lineHeight: '56px',
            flexShrink: 0,
          }}
        >
          <Space align="center" style={{ minWidth: 0, flex: 1 }}>
            <Button
              className="admin-mobile-menu-btn"
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              aria-label="打开菜单"
            />
            <div style={{ minWidth: 0 }}>
              <Typography.Title
                level={5}
                style={{ margin: 0, lineHeight: 1.35 }}
                ellipsis
              >
                {TAB_META[activeTab].title}
              </Typography.Title>
            </div>
          </Space>
          <Button
            icon={<SyncOutlined spin={refreshing} />}
            onClick={() => void refresh()}
            loading={refreshing}
            style={{ flexShrink: 0 }}
          >
            刷新
          </Button>
        </Header>

        <Content
          className={activeTab === 'settings' ? 'admin-content admin-content--settings' : 'admin-content'}
          style={{
            padding: activeTab === 'settings' ? '20px 24px 0' : '20px 24px 32px',
            background: '#f5f7fa',
            overflow: 'auto',
            flex: 1,
            minHeight: 0,
            ...(activeTab === 'settings'
              ? { display: 'flex', flexDirection: 'column' as const }
              : null),
          }}
        >
          <Typography.Paragraph
            type="secondary"
            style={{ marginTop: 0, marginBottom: 16, flexShrink: 0 }}
          >
            {TAB_META[activeTab].description}
          </Typography.Paragraph>
          {error && (
            <Alert
              type="error"
              message={error}
              showIcon
              closable
              onClose={() => setError('')}
              style={{ marginBottom: 16, flexShrink: 0 }}
            />
          )}
          <div
            className={activeTab === 'settings' ? 'admin-settings-fill' : undefined}
            style={
              activeTab === 'settings'
                ? { flex: '1 0 auto', display: 'flex', flexDirection: 'column' }
                : undefined
            }
          >
            {renderTabContent()}
          </div>
        </Content>
      </Layout>

      <Modal
        open={Boolean(reportDetail) || reportDetailLoading}
        onCancel={() => {
          if (reportBusyId) return;
          setReportDetail(null);
        }}
        width={760}
        centered
        title="处理错误上报"
        styles={{ body: { paddingTop: 12, paddingBottom: 12 } }}
        footer={reportDetail ? (
          <Space wrap>
            <Button onClick={() => setReportDetail(null)}>关闭</Button>
            {reportDetail.status === 'resolved' ? (
              <Button
                loading={reportBusyId === reportDetail.id}
                onClick={() => void resolveErrorReport(reportDetail.id, 'open')}
              >
                重开
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={reportBusyId === reportDetail.id}
                onClick={() => void resolveErrorReport(reportDetail.id, 'resolved')}
              >
                标记已处理
              </Button>
            )}
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={reportBusyId === reportDetail.id}
              onClick={() => void deleteErrorReportItem(reportDetail.id)}
            >
              删除
            </Button>
          </Space>
        ) : null}
      >
        {reportDetailLoading || !reportDetail ? (
          <AdminLoading tip="加载上报详情…" minHeight={180} />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap size={8} align="center">
              <Tag color={reportDetail.type === 'feedback' ? 'blue' : 'default'} style={{ margin: 0 }}>
                {reportDetail.type === 'feedback' ? '意见' : '错误'}
              </Tag>
              <Tag color={reportDetail.status === 'open' ? 'warning' : 'success'} style={{ margin: 0 }}>
                {reportDetail.status === 'open' ? '待处理' : '已处理'}
              </Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatAuditTime(reportDetail.createdAt)}
                {reportDetail.meta?.nickname ? ` · ${String(reportDetail.meta.nickname)}` : ''}
                {reportDetail.meta?.roomId ? ` · 房间 ${String(reportDetail.meta.roomId)}` : ''}
                {reportDetail.ip ? ` · ${reportDetail.ip}` : ''}
              </Typography.Text>
            </Space>

            <Typography.Paragraph
              style={{ marginBottom: 0, fontSize: 13 }}
              ellipsis={{ rows: 2, expandable: 'collapsible', symbol: (expanded) => (expanded ? '收起' : '展开') }}
            >
              {reportDetail.description}
            </Typography.Paragraph>

            <Form layout="vertical" requiredMark={false} style={{ marginBottom: 0 }}>
              <Form.Item
                label="解决方案"
                required={reportDetail.status !== 'resolved'}
                style={{ marginBottom: 4 }}
                extra={
                  reportDetail.status === 'resolved' && reportDetail.solutionAckedAt
                    ? `用户已于 ${formatAuditTime(reportDetail.solutionAckedAt)} 确认`
                    : '处理后用户在线即弹窗，否则下次进入时弹出'
                }
              >
                <Input.TextArea
                  value={reportNoteDraft}
                  onChange={(e) => setReportNoteDraft(e.target.value)}
                  maxLength={500}
                  rows={2}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  showCount
                  placeholder="写给用户的解决说明…"
                />
              </Form.Item>
            </Form>

            <Tabs
              size="small"
              type="card"
              items={reportDebugTabItems}
              style={{ width: '100%' }}
            />
            {reportDetail && (
              <Typography.Text type="secondary" copyable={{ text: reportDetail.id }} style={{ fontSize: 11 }}>
                ID {reportDetail.id}
              </Typography.Text>
            )}
          </Space>
        )}
      </Modal>

      <style>{`
        .admin-page-header.ant-layout-header {
          height: 56px !important;
          line-height: 56px !important;
        }
        .admin-page-header .ant-typography {
          line-height: 1.35 !important;
        }
        .admin-metric-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 28px rgba(15, 23, 42, 0.08) !important;
        }
        .admin-content--settings .admin-settings-fill {
          flex: 1 0 auto;
          display: flex;
          flex-direction: column;
        }
        .admin-content--settings .admin-settings-card.ant-card {
          flex: 1 0 auto;
          display: flex;
          flex-direction: column;
        }
        .admin-content--settings .admin-settings-card .ant-card-body {
          flex: 1 0 auto;
          display: flex;
          flex-direction: column;
        }
        /* 表格 / 嵌套 Spin 水平垂直居中 */
        .admin-content .ant-spin-nested-loading > div > .ant-spin {
          max-height: none;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .admin-content .ant-spin-nested-loading .ant-spin-container::after {
          background: rgba(255, 255, 255, 0.55);
        }
        @media (min-width: 768px) {
          .admin-mobile-menu-btn { display: none !important; }
        }
        @media (max-width: 767px) {
          .admin-desktop-sider { display: none !important; }
        }
      `}</style>
    </Layout>
  );
}

export default function Admin() {
  return (
    <AdminProviders>
      <AdminPage />
    </AdminProviders>
  );
}
