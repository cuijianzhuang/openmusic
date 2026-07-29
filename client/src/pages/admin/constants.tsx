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

/** 操作审计类型筛选（value = action） */
export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'login_ok', label: '登录成功' },
  { value: 'login_fail', label: '登录失败' },
  { value: 'logout', label: '退出登录' },
  { value: 'linuxdo_bind', label: '绑定 Linux.do' },
  { value: 'linuxdo_unbind', label: '解绑 Linux.do' },
  { value: 'github_bind', label: '绑定 GitHub' },
  { value: 'github_unbind', label: '解绑 GitHub' },
  { value: 'set_credentials', label: '修改管理员密码' },
  { value: 'set_credentials_fail', label: '修改密码失败' },
  { value: 'set_entry_path', label: '更新登录地址' },
  { value: 'set_runtime_config', label: '更新运行配置' },
  { value: 'set_announcement', label: '更新站点公告' },
  { value: 'set_room_protection', label: '房间保活' },
  { value: 'view_room_password', label: '查看房间密码' },
  { value: 'review_permanent_application', label: '审核常驻申请' },
  { value: 'meting_reset_cooldown', label: '重置上游冷却' },
  { value: 'meting_set_disabled', label: '启用/禁用上游' },
  { value: 'reset_music_api_circuit', label: '重置音源熔断' },
  { value: 'broadcast', label: '全局广播' },
  { value: 'site_ban_add', label: '添加封禁' },
  { value: 'site_ban_remove', label: '解除封禁' },
  { value: 'room_create_blocked', label: '拦截建房' },
  { value: 'room_create_auto_ban', label: '自动封禁建房' },
  { value: 'join_blocked', label: '拦截进房' },
  { value: 'session_blocked', label: '拦截会话' },
  { value: 'error_report_update', label: '处理错误上报' },
  { value: 'error_report_delete', label: '删除错误上报' },
  { value: 'destroy_room', label: '解散房间' },
  { value: 'owner_destroy_room', label: '房主解散房间' },
  { value: 'owner_destroy_room_denied', label: '拒绝房主解散' },
  { value: 'destroy_room_fail', label: '解散失败' },
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
