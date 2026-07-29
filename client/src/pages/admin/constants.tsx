import type { ReactNode } from 'react';
import {
  BugOutlined,
  DashboardOutlined,
  FileTextOutlined,
  NotificationOutlined,
  SettingOutlined,
  SoundOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { AdminTabId } from './types';

export const LIST_PAGE_SIZE = 15;
export const AUDIT_PAGE_SIZE = 10;

/**
 * 操作审计类型筛选（大类；value 为分组 key，服务端展开为多个 action）
 * 列表文案仍按单条 action 细粒度显示
 */
export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'auth', label: '登录 / 退出' },
  { value: 'oauth', label: '账号绑定' },
  { value: 'account', label: '账号与入口' },
  { value: 'config', label: '系统配置' },
  { value: 'notify', label: '公告 / 广播' },
  { value: 'room', label: '房间管理' },
  { value: 'ban', label: '全站封禁' },
  { value: 'guard', label: '防护拦截' },
  { value: 'report', label: '错误上报' },
];

export const ADMIN_TABS: { id: AdminTabId; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: '概览', icon: <DashboardOutlined /> },
  { id: 'rooms', label: '房间管理', icon: <SoundOutlined /> },
  { id: 'bans', label: '全站封禁', icon: <StopOutlined /> },
  { id: 'reports', label: '错误上报', icon: <BugOutlined /> },
  { id: 'notify', label: '公告广播', icon: <NotificationOutlined /> },
  { id: 'settings', label: '系统设置', icon: <SettingOutlined /> },
  { id: 'audit', label: '操作审计', icon: <FileTextOutlined /> },
];

export const TAB_META: Record<AdminTabId, { title: string; description: string }> = {
  overview: { title: '概览', description: '实时运行状态与音源健康' },
  rooms: { title: '房间管理', description: '审核常驻申请、管理房间状态与解散' },
  bans: { title: '全站封禁', description: '按 IP 或设备封禁，阻止进房和建房' },
  reports: { title: '错误上报', description: '用户提交的问题反馈与调试日志' },
  notify: { title: '公告广播', description: '首页公告与全房间系统通知' },
  settings: { title: '系统设置', description: '登录入口、管理员账号与运行配置，保存后即时生效' },
  audit: { title: '操作审计', description: '管理端操作与防护拦截记录' },
};
