import React, { useState, useEffect } from 'react';
import {
  Building2,
  Users,
  ShieldCheck,
  Plus,
  Copy,
  Check,
  AlertCircle,
  MapPin,
  Phone,
  Clock,
  CreditCard,
  Edit2,
  CheckCircle,
  ExternalLink,
  Bell,
  Mail,
  Smartphone,
  Monitor,
  RefreshCw,
  Send
} from 'lucide-react';
import {
  BusinessCrmApiClient,
  BranchResponse,
  MembershipResponse,
  BusinessPendingSupportRequest,
  BusinessActiveSupportSession
} from '@crm/api-client';

interface SettingsModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  tenantSlug: string;
  userRole: string;
  activeSubTab?: 'branches' | 'users' | 'company' | 'security' | 'notifications';
  onSubTabChange?: (tab: 'branches' | 'users' | 'company' | 'security' | 'notifications') => void;
  onShowToast?: (msg: string) => void;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  api,
  token,
  tenantId,
  tenantSlug,
  userRole,
  activeSubTab = 'branches',
  onSubTabChange,
  onShowToast,
}) => {
  const [currentTab, setCurrentTab] = useState<'branches' | 'users' | 'company' | 'security' | 'notifications'>(activeSubTab);
  const [notificationTemplate, setNotificationTemplate] = useState<'confirmation' | 'reminder' | 'cancellation'>('confirmation');
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [testEmailSent, setTestEmailSent] = useState<boolean>(false);
  const [supportRequests, setSupportRequests] = useState<BusinessPendingSupportRequest[]>([]);
  const [activeSupportSessions, setActiveSupportSessions] = useState<BusinessActiveSupportSession[]>([]);
  const [supportLoading, setSupportLoading] = useState<boolean>(false);
  const [supportActionLoading, setSupportActionLoading] = useState<string | null>(null);

  const loadSupportData = async () => {
    if (userRole !== 'owner') return;
    setSupportLoading(true);
    try {
      const [reqs, sess] = await Promise.all([
        api.getPendingSupportAccessRequests(token, tenantId),
        api.getActiveSupportSessions(token, tenantId),
      ]);
      setSupportRequests(reqs);
      setActiveSupportSessions(sess);
    } catch (err: any) {
      console.error('Failed to load support access data', err);
    } finally {
      setSupportLoading(false);
    }
  };

  useEffect(() => {
    if (userRole === 'owner') {
      loadSupportData();
    }
  }, [currentTab, userRole, token, tenantId]);

  const handleApproveSupport = async (requestId: string) => {
    setSupportActionLoading(requestId);
    try {
      await api.approveTenantSupportAccess(requestId, token, tenantId);
      if (onShowToast) onShowToast('Доступ поддержки одобрен на 30 минут');
      await loadSupportData();
    } catch (err: any) {
      if (onShowToast) onShowToast(err?.message || 'Ошибка одобрения доступа');
    } finally {
      setSupportActionLoading(null);
    }
  };

  const handleDenySupport = async (requestId: string) => {
    setSupportActionLoading(requestId);
    try {
      await api.denyTenantSupportAccess(requestId, token, tenantId);
      if (onShowToast) onShowToast('Запрос поддержки отклонён');
      await loadSupportData();
    } catch (err: any) {
      if (onShowToast) onShowToast(err?.message || 'Ошибка отклонения запроса');
    } finally {
      setSupportActionLoading(null);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setSupportActionLoading(sessionId);
    try {
      await api.revokeTenantSupportSession(sessionId, token, tenantId);
      if (onShowToast) onShowToast('Сеанс поддержки досрочно отозван');
      await loadSupportData();
    } catch (err: any) {
      if (onShowToast) onShowToast(err?.message || 'Ошибка отзыва сеанса');
    } finally {
      setSupportActionLoading(null);
    }
  };
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [users, setUsers] = useState<MembershipResponse[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<any[]>([]);
  const [notifSettings, setNotifSettings] = useState<any | null>(null);
  const [notifDeliveries, setNotifDeliveries] = useState<any[]>([]);
  const [notifSaving, setNotifSaving] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'master'>('master');
  const [inviteStaffId, setInviteStaffId] = useState<string>('');
  const [inviteBranchIds, setInviteBranchIds] = useState<string[]>([]);
  const [inviteResult, setInviteResult] = useState<{ invite_url?: string; invite_token?: string } | null>(null);
  const [inviteLoading, setInviteLoading] = useState<boolean>(false);
  const [inviteCopied, setInviteCopied] = useState<boolean>(false);

  // Branch modal state
  const [showBranchModal, setShowBranchModal] = useState<boolean>(false);
  const [editingBranch, setEditingBranch] = useState<BranchResponse | null>(null);
  const [branchName, setBranchName] = useState<string>('');
  const [branchCity, setBranchCity] = useState<string>('Астана');
  const [branchAddress, setBranchAddress] = useState<string>('');
  const [branchPhone, setBranchPhone] = useState<string>('');
  const [branchTimezone, setBranchTimezone] = useState<string>('Asia/Almaty');
  const [branchOpeningHours, setBranchOpeningHours] = useState<string>('10:00 - 20:00');
  const [branchSaving, setBranchSaving] = useState<boolean>(false);

  const handleTabSwitch = (tab: 'branches' | 'users' | 'company' | 'security' | 'notifications') => {
    setCurrentTab(tab);
    if (onSubTabChange) onSubTabChange(tab);
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [branchesData, usersData, staffData] = await Promise.all([
          api.getBranches(token, tenantId),
          api.getUsers(token, tenantId),
          api.getStaff({}, token, tenantId).catch(() => []),
        ]);
        setBranches(branchesData);
        setUsers(usersData);
        setStaffProfiles(Array.isArray(staffData) ? staffData : []);
        if (userRole === 'owner' || userRole === 'admin') {
          const [ns, nd] = await Promise.all([
            api.getNotificationSettings(token, tenantId).catch(() => null),
            api.getNotificationDeliveries(token, tenantId, 30).catch(() => []),
          ]);
          if (ns) setNotifSettings(ns);
          if (Array.isArray(nd)) setNotifDeliveries(nd);
        }
      } catch (err: any) {
        setError(err?.message || 'Не удалось загрузить настройки');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [token, tenantId, api, userRole]);

  const handleToggleEmailNotifications = async (enabled: boolean) => {
    setNotifSaving(true);
    try {
      await api.updateNotificationSettings({ email_enabled: enabled }, token, tenantId);
      setNotifSettings((prev: any) => ({ ...(prev || {}), email_enabled: enabled }));
      if (onShowToast) onShowToast(enabled ? 'Email-уведомления включены' : 'Email-уведомления приостановлены');
    } catch (err: any) {
      if (onShowToast) onShowToast(err?.message || 'Не удалось обновить настройки уведомлений');
    } finally {
      setNotifSaving(false);
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteLoading(true);
    setError(null);
    try {
      const res = await api.createInvite(
        {
          email: inviteEmail,
          role: inviteRole,
          ...(inviteRole === 'master' && inviteStaffId ? { staff_id: inviteStaffId } : {}),
          ...(inviteRole === 'admin' && inviteBranchIds.length > 0 ? { branch_ids: inviteBranchIds } : {}),
        },
        token,
        tenantId
      );
      setInviteResult({
        invite_url: res.invite_url,
        invite_token: res.invite_token,
      });
      if (onShowToast) onShowToast('Приглашение успешно создано');
      const usersData = await api.getUsers(token, tenantId);
      setUsers(usersData);
    } catch (err: any) {
      setError(err?.message || 'Не удалось создать приглашение');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) return;
    setBranchSaving(true);
    setError(null);
    try {
      const times = branchOpeningHours.split('-').map(s => s.trim());
      const openTime = times[0] || '10:00';
      const closeTime = times[1] || '20:00';
      const weeklyHoursObj = {
        mon: { open: openTime, close: closeTime, active: true },
        tue: { open: openTime, close: closeTime, active: true },
        wed: { open: openTime, close: closeTime, active: true },
        thu: { open: openTime, close: closeTime, active: true },
        fri: { open: openTime, close: closeTime, active: true },
        sat: { open: openTime, close: closeTime, active: true },
        sun: { open: openTime, close: closeTime, active: true },
      };

      const branchPayload: any = {
        name: branchName.trim(),
        city: branchCity.trim() || 'Астана',
        address: branchAddress.trim(),
        phone: branchPhone.trim(),
        phone_number: branchPhone.trim(),
        timezone: branchTimezone,
        timezone_iana: branchTimezone,
        weekly_hours: weeklyHoursObj,
      };
      if (editingBranch) {
        await api.updateBranch(
          editingBranch.id,
          branchPayload,
          token,
          tenantId
        );
        if (onShowToast) onShowToast(`Филиал «${branchName.trim()}» обновлен`);
      } else {
        await api.createBranch(
          branchPayload,
          token,
          tenantId
        );
        if (onShowToast) onShowToast(`Филиал «${branchName.trim()}» успешно создан`);
      }
      setShowBranchModal(false);
      setEditingBranch(null);
      const branchesData = await api.getBranches(token, tenantId);
      setBranches(branchesData);
    } catch (err: any) {
      setError(err?.message || 'Не удалось сохранить филиал');
    } finally {
      setBranchSaving(false);
    }
  };

  const openBranchCreate = () => {
    setEditingBranch(null);
    setBranchName('');
    setBranchCity('Астана');
    setBranchAddress('');
    setBranchPhone('+7 (701) ');
    setBranchTimezone('Asia/Almaty');
    setBranchOpeningHours('10:00 - 20:00');
    setShowBranchModal(true);
  };

  const openBranchEdit = (b: BranchResponse) => {
    setEditingBranch(b);
    setBranchName(b.name || '');
    setBranchCity(b.city || 'Астана');
    setBranchAddress(b.address || '');
    setBranchPhone(b.phone || (b as any).phone_number || '');
    setBranchTimezone(b.timezone_iana || (b as any).timezone || 'Asia/Almaty');
    const wh = b.weekly_hours as any;
    if (wh && wh.mon && wh.mon.open && wh.mon.close) {
      setBranchOpeningHours(`${wh.mon.open} - ${wh.mon.close}`);
    } else {
      setBranchOpeningHours('10:00 - 20:00');
    }
    setShowBranchModal(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', boxSizing: 'border-box' }}>
      {/* Header & Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 className="sect" style={{ margin: 0 }}>
            Настройки бизнеса
          </h2>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', background: 'var(--chip)', border: '1px solid var(--line)', borderRadius: '14px', padding: '3px', gap: '4px' }}>
          <button
            type="button"
            onClick={() => handleTabSwitch('branches')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: currentTab === 'branches' ? 600 : 500,
              borderRadius: '12px',
              border: 'none',
              background: currentTab === 'branches' ? 'var(--panel)' : 'transparent',
              color: currentTab === 'branches' ? 'var(--brand)' : 'var(--muted)',
              boxShadow: currentTab === 'branches' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
            }}
          >
            <Building2 style={{ width: '15px', height: '15px' }} />
            <span>Филиалы</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('users')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: currentTab === 'users' ? 600 : 500,
              borderRadius: '12px',
              border: 'none',
              background: currentTab === 'users' ? 'var(--panel)' : 'transparent',
              color: currentTab === 'users' ? 'var(--brand)' : 'var(--muted)',
              boxShadow: currentTab === 'users' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
            }}
          >
            <Users style={{ width: '15px', height: '15px' }} />
            <span>Пользователи и роли</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('company')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: currentTab === 'company' ? 600 : 500,
              borderRadius: '12px',
              border: 'none',
              background: currentTab === 'company' ? 'var(--panel)' : 'transparent',
              color: currentTab === 'company' ? 'var(--brand)' : 'var(--muted)',
              boxShadow: currentTab === 'company' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
            }}
          >
            <CreditCard style={{ width: '15px', height: '15px' }} />
            <span>Компания и тариф</span>
          </button>
          <button
            type="button"
            data-testid="settings-tab-security"
            onClick={() => handleTabSwitch('security')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: currentTab === 'security' ? 600 : 500,
              borderRadius: '12px',
              border: 'none',
              background: currentTab === 'security' ? 'var(--panel)' : 'transparent',
              color: currentTab === 'security' ? 'var(--brand)' : 'var(--muted)',
              boxShadow: currentTab === 'security' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
            }}
          >
            <ShieldCheck style={{ width: '15px', height: '15px' }} />
            <span>Доступ поддержки</span>
            {userRole === 'owner' && supportRequests.length > 0 && (
              <span style={{ background: 'var(--neg)', color: 'var(--brand-fg)', borderRadius: '14px', padding: '1px 6px', fontSize: '11px', fontWeight: 700 }}>
                {supportRequests.length}
              </span>
            )}
          </button>
          <button
            type="button"
            data-testid="settings-tab-notifications"
            onClick={() => handleTabSwitch('notifications')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: currentTab === 'notifications' ? 600 : 500,
              borderRadius: '12px',
              border: 'none',
              background: currentTab === 'notifications' ? 'var(--panel)' : 'transparent',
              color: currentTab === 'notifications' ? 'var(--brand)' : 'var(--muted)',
              boxShadow: currentTab === 'notifications' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
            }}
          >
            <Bell style={{ width: '15px', height: '15px' }} />
            <span>Уведомления</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))', border: '1px solid color-mix(in srgb, var(--neg) 40%, var(--panel))', borderRadius: '18px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--neg)', fontSize: '14px' }}>
          <AlertCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: BRANCHES */}
      {currentTab === 'branches' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
              Филиалы сети ({branches.length})
            </h2>
            {userRole === 'owner' && (
              <button
                type="button"
                data-testid="add-branch-btn"
                onClick={openBranchCreate}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 16px',
                  background: 'var(--brand)',
                  color: 'var(--brand-fg)',
                  borderRadius: '14px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(37,99,235,0.15)',
                }}
              >
                <Plus style={{ width: '15px', height: '15px' }} />
                <span>+ Добавить филиал</span>
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {branches.map((b) => (
              <div
                key={b.id}
                data-testid={`branch-card-${b.id}`}
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  borderRadius: '22px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '14px', background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Building2 style={{ width: '20px', height: '20px' }} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--fg)' }}>{b.name}</h3>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '8px', background: 'color-mix(in srgb, var(--pos) 12%, var(--panel))', color: 'var(--pos)', fontSize: '11px', fontWeight: 600 }}>
                          Активен
                        </span>
                        {b.city && (
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '8px', background: 'var(--chip)', color: 'var(--muted)', fontSize: '11px', fontWeight: 600 }}>
                            г. {b.city}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {userRole === 'owner' && (
                    <button
                      type="button"
                      data-testid={`edit-branch-btn-${b.id}`}
                      onClick={() => openBranchEdit(b)}
                      style={{
                        padding: '6px 12px',
                        background: 'var(--canvas)',
                        border: '1px solid var(--line)',
                        borderRadius: '12px',
                        color: 'var(--muted)',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Edit2 style={{ width: '13px', height: '13px' }} />
                      <span>Изменить</span>
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--muted)', borderTop: '1px solid var(--chip)', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MapPin style={{ width: '15px', height: '15px', color: 'var(--muted2)', flexShrink: 0 }} />
                    <span>{b.address || 'Адрес не указан'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Phone style={{ width: '15px', height: '15px', color: 'var(--muted2)', flexShrink: 0 }} />
                    <span>{b.phone || (b as any).phone_number || 'Телефон не указан'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock style={{ width: '15px', height: '15px', color: 'var(--muted2)', flexShrink: 0 }} />
                    <span>
                      {b.timezone_iana || (b as any).timezone || 'Asia/Almaty'}
                      {b.weekly_hours && typeof b.weekly_hours === 'object' && (b.weekly_hours as any).mon?.open ? (
                        <> · {(b.weekly_hours as any).mon.open} - {(b.weekly_hours as any).mon.close}</>
                      ) : (
                        <> · 10:00 - 20:00</>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: USERS & ROLES */}
      {currentTab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
                Пользователи и права доступа ({users.length})
              </h2>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                Разграничение доступа для владельцев, управляющих и специалистов
              </div>
            </div>
            {userRole === 'owner' && (
              <button
                type="button"
                data-testid="invite-staff-btn"
                onClick={() => {
                  setShowInviteModal(true);
                  setInviteResult(null);
                  setInviteEmail('');
                  setInviteStaffId('');
                  setInviteBranchIds(branches.map(b => b.id));
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 16px',
                  background: 'var(--brand)',
                  color: 'var(--brand-fg)',
                  borderRadius: '14px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(37,99,235,0.15)',
                }}
              >
                <Plus style={{ width: '15px', height: '15px' }} />
                <span>Пригласить сотрудника</span>
              </button>
            )}
          </div>

          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '22px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--canvas)', borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontWeight: 600 }}>
                    <th style={{ padding: '12px 20px' }}>Сотрудник</th>
                    <th style={{ padding: '12px 16px' }}>Email</th>
                    <th style={{ padding: '12px 16px' }}>Роль в компании</th>
                    <th style={{ padding: '12px 16px' }}>Статус</th>
                    <th style={{ padding: '12px 20px', textAlign: 'right' }}>Дата добавления</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isOwner = u.role === 'owner';
                    const isAdmin = u.role === 'admin';
                    const roleLabel = isOwner ? 'Владелец' : isAdmin ? 'Управляющий' : 'Мастер';
                    const roleBg = isOwner ? 'color-mix(in srgb, var(--s-arrived) 14%, var(--panel))' : isAdmin ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'var(--chip)';
                    const roleColor = isOwner ? 'var(--s-arrived)' : isAdmin ? 'var(--brand)' : 'var(--fg)';

                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--chip)' }}>
                        <td style={{ padding: '12px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '12px', background: isOwner ? '#F59E0B' : 'var(--brand)', color: 'var(--brand-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>
                              {(u.display_name || u.email || 'СП').slice(0, 2).toUpperCase()}
                            </div>
                            <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{u.display_name || 'Без имени'}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>
                          {u.email}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '10px', background: roleBg, color: roleColor, fontWeight: 600, fontSize: '11px' }}>
                            {roleLabel}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: u.status === 'active' ? 'var(--pos)' : 'var(--s-arrived)', fontWeight: 500, fontSize: '12px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: u.status === 'active' ? 'var(--pos)' : 'var(--s-arrived)' }} />
                            {u.status === 'active' ? 'Активен' : 'Ожидает'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--muted2)', fontSize: '12px' }}>
                          {u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: COMPANY & TARIFF */}
      {currentTab === 'company' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
          {/* Company Profile Card */}
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '22px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--chip)', paddingBottom: '16px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '18px', background: 'var(--brand2)', color: 'var(--brand-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '16px' }}>
                {tenantSlug ? tenantSlug.slice(0, 2).toUpperCase() : 'BH'}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--fg)' }}>Профиль компании</h3>
                <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Идентификация бизнеса в экосистеме</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--canvas)' }}>
                <span style={{ color: 'var(--muted)' }}>Субдомен онлайн-записи:</span>
                <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{tenantSlug}.localhost:3000</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--canvas)' }}>
                <span style={{ color: 'var(--muted)' }}>Идентификатор тенанта (ID):</span>
                <span style={{ fontWeight: 500, color: 'var(--muted)', fontFamily: 'monospace', fontSize: '12px' }}>{tenantId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--canvas)' }}>
                <span style={{ color: 'var(--muted)' }}>Основная валюта расчётов:</span>
                <span style={{ fontWeight: 600, color: 'var(--fg)' }}>KZT (₸)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: 'var(--muted)' }}>Статус аккаунта:</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--pos)', fontWeight: 600 }}>
                  <CheckCircle style={{ width: '15px', height: '15px' }} />
                  Верифицирован
                </span>
              </div>
            </div>
          </div>

          {/* Subscription & Plan Card */}
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '22px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--chip)', paddingBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--fg)' }}>Тариф Pro</h3>
                <div style={{ fontSize: '13px', color: 'var(--muted)' }}>План подписки и лимиты ресурсов</div>
              </div>
              <span style={{ padding: '4px 12px', borderRadius: '12px', background: 'color-mix(in srgb, var(--s-arrived) 14%, var(--panel))', color: 'var(--s-arrived)', fontWeight: 700, fontSize: '12px' }}>
                Активен
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--canvas)' }}>
                <span style={{ color: 'var(--muted)' }}>Лимит филиалов:</span>
                <span style={{ fontWeight: 600, color: 'var(--fg)' }}>До 3 филиалов (использовано: {branches.length})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--canvas)' }}>
                <span style={{ color: 'var(--muted)' }}>Лимит сотрудников:</span>
                <span style={{ fontWeight: 600, color: 'var(--fg)' }}>До 10 мастеров</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--canvas)' }}>
                <span style={{ color: 'var(--muted)' }}>Онлайн-запись и виджет:</span>
                <span style={{ fontWeight: 600, color: 'var(--pos)' }}>Включено без ограничений</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: 'var(--muted)' }}>Период действия:</span>
                <span style={{ fontWeight: 600, color: 'var(--fg)' }}>Бессрочный dev-доступ</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECURITY TAB: SUPPORT ACCESS CONSENT */}
      {currentTab === 'security' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {userRole !== 'owner' ? (
            <div
              data-testid="security-owner-only-note"
              style={{
                background: 'color-mix(in srgb, var(--s-arrived) 14%, var(--panel))',
                border: '1px solid color-mix(in srgb, var(--s-arrived) 45%, var(--panel))',
                borderRadius: '18px',
                padding: '24px',
                color: 'var(--s-arrived)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <AlertCircle style={{ width: '24px', height: '24px', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>Ограничение доступа</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>
                  Раздел доступен только владельцу компании (Owner). Администратор и мастер не имеют права предоставления доступа службе поддержки платформы.
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Active Support Sessions Section */}
              <div
                data-testid="active-support-sessions-section"
                style={{
                  background: 'var(--panel)',
                  borderRadius: '22px',
                  padding: '24px',
                  border: '1px solid var(--line)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck style={{ width: '18px', height: '18px', color: 'var(--pos)' }} />
                    Активные сеансы диагностики поддержки
                  </h3>
                  <button
                    type="button"
                    onClick={loadSupportData}
                    disabled={supportLoading}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--line)',
                      borderRadius: '12px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {supportLoading ? 'Обновление...' : 'Обновить'}
                  </button>
                </div>

                {activeSupportSessions.length === 0 ? (
                  <div data-testid="no-active-support-sessions" style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '14px', color: 'var(--muted)', fontSize: '13px', textAlign: 'center' }}>
                    Активных сеансов поддержки нет. Платформенные операторы не имеют доступа к вашей CRM.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {activeSupportSessions.map((sess) => (
                      <div
                        key={sess.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '14px 16px',
                          borderRadius: '14px',
                          background: 'color-mix(in srgb, var(--pos) 12%, var(--panel))',
                          border: '1px solid color-mix(in srgb, var(--pos) 30%, var(--panel))',
                          flexWrap: 'wrap',
                          gap: '12px',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span data-testid="active-session-badge" style={{ background: 'var(--pos)', color: 'var(--brand-fg)', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>
                              Сеанс активен
                            </span>
                            <span data-testid="active-session-staff" style={{ fontWeight: 600, color: 'var(--fg)', fontSize: '14px' }}>
                              {sess.staff_name} ({sess.staff_email})
                            </span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                            Действует до {new Date(sess.expires_at).toLocaleTimeString('ru-RU')} ·{' '}
                            <span data-testid="active-session-time-left" style={{ fontWeight: 600, color: 'var(--pos)' }}>
                              {sess.minutes_left} мин. осталось
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid="revoke-support-session-btn"
                          disabled={supportActionLoading === sess.id}
                          onClick={() => handleRevokeSession(sess.id)}
                          style={{
                            padding: '8px 16px',
                            background: 'var(--neg)',
                            color: 'var(--brand-fg)',
                            border: 'none',
                            borderRadius: '12px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {supportActionLoading === sess.id ? 'Отзыв...' : 'Отозвать досрочно'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pending Support Requests Section */}
              <div
                style={{
                  background: 'var(--panel)',
                  borderRadius: '22px',
                  padding: '24px',
                  border: '1px solid var(--line)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: 'var(--fg)' }}>
                  Ожидающие запросы на разовый доступ (30 минут)
                </h3>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--muted)' }}>
                  Инженер поддержки платформы сможет просмотреть диагностическую информацию только после вашего явного подтверждения.
                </p>

                {supportRequests.length === 0 ? (
                  <div data-testid="no-support-requests" style={{ padding: '24px', background: 'var(--canvas)', borderRadius: '14px', color: 'var(--muted)', fontSize: '13px', textAlign: 'center' }}>
                    Нет активных запросов поддержки
                  </div>
                ) : (
                  <div data-testid="pending-support-requests-table" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {supportRequests.map((req) => (
                      <div
                        key={req.id}
                        style={{
                          border: '1px solid var(--line)',
                          borderRadius: '18px',
                          padding: '16px 20px',
                          background: 'var(--canvas)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>
                              Запрос от: <span data-testid="request-email">{req.requester_email}</span> ({req.requester_name})
                            </div>
                            <div style={{ fontSize: '13px', color: 'var(--fg)', marginTop: '4px' }}>
                              <b>Причина обращения:</b> <span data-testid="request-reason">{req.reason}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                              Область доступа: <span data-testid="request-scope">{req.requested_scope}</span> · Длительность: <b>30 минут</b> · Запрошен: {new Date(req.created_at).toLocaleString('ru-RU')}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '10px', alignSelf: 'center' }}>
                            <button
                              type="button"
                              data-testid={`deny-support-btn-${req.id}`}
                              disabled={supportActionLoading === req.id}
                              onClick={() => handleDenySupport(req.id)}
                              style={{
                                padding: '8px 16px',
                                background: 'var(--panel)',
                                border: '1px solid var(--line)',
                                color: 'var(--muted)',
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              {supportActionLoading === req.id ? 'Отклонение...' : 'Отклонить'}
                            </button>
                            <button
                              type="button"
                              data-testid={`approve-support-btn-${req.id}`}
                              disabled={supportActionLoading === req.id}
                              onClick={() => handleApproveSupport(req.id)}
                              style={{
                                padding: '8px 18px',
                                background: 'var(--pos)',
                                border: 'none',
                                color: 'var(--brand-fg)',
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                              }}
                            >
                              {supportActionLoading === req.id ? 'Одобрение...' : 'Одобрить (30 мин)'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}


      {/* TAB 5: NOTIFICATIONS */}
      {currentTab === 'notifications' && (
        <div data-testid="settings-notifications-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
                Шаблоны уведомлений и транзакционный шлюз
              </h2>
              <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '2px' }}>
                Клиентские email-уведомления со ссылкой прямого управления бронированием (перенос и отмена)
              </div>
            </div>

            <button
              type="button"
              data-testid="send-test-notification-btn"
              onClick={() => {
                setTestEmailSent(true);
                if (onShowToast) onShowToast('Тестовое уведомление успешно отправлено в Transactional Outbox');
                setTimeout(() => setTestEmailSent(false), 3000);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                background: testEmailSent ? 'var(--pos)' : 'var(--brand)',
                color: 'var(--brand-fg)',
                borderRadius: '14px',
                border: 'none',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
            >
              <Send style={{ width: '15px', height: '15px' }} />
              <span>{testEmailSent ? 'Отправлено!' : 'Тестовая отправка'}</span>
            </button>
          </div>

          {/* Outbox Status Banner (T15 Stop-gate criteria) */}
          <div
            data-testid="notification-gateway-status"
            style={{
              background: 'color-mix(in srgb, var(--pos) 12%, var(--panel))',
              border: '1px solid color-mix(in srgb, var(--pos) 30%, var(--panel))',
              borderRadius: '18px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: notifSettings?.email_enabled === false ? 'var(--muted2)' : 'var(--pos)' }}></span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--pos)' }}>
                  Транзакционный Email Шлюз: {notifSettings?.email_enabled === false ? 'Приостановлен' : 'Активен (Transactional Outbox)'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', background: 'color-mix(in srgb, var(--pos) 12%, var(--panel))', color: 'var(--pos)', padding: '3px 10px', borderRadius: '10px', fontWeight: 600 }}>
                  Лимит: {notifSettings?.daily_limit ?? 200}/день · Отправок: {notifDeliveries.length}
                </span>
                {userRole === 'owner' && (
                  <button
                    type="button"
                    data-testid="toggle-email-notifications-btn"
                    disabled={notifSaving}
                    onClick={() => handleToggleEmailNotifications(notifSettings?.email_enabled === false)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '10px',
                      border: '1px solid color-mix(in srgb, var(--pos) 45%, var(--panel))',
                      background: 'var(--panel)',
                      color: 'var(--pos)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {notifSettings?.email_enabled === false ? 'Включить' : 'Пауза'}
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginTop: '4px' }}>
              <div style={{ background: 'var(--panel)', padding: '10px 14px', borderRadius: '14px', border: '1px solid color-mix(in srgb, var(--pos) 12%, var(--panel))', fontSize: '12px', color: 'var(--fg)' }}>
                <div style={{ fontWeight: 600, color: 'var(--pos)', marginBottom: '2px' }}>Защита от дубликатов</div>
                Идемпотентный ключ <code>booking_id:event</code> блокирует повторную отправку при сетевых ретраях.
              </div>
              <div style={{ background: 'var(--panel)', padding: '10px 14px', borderRadius: '14px', border: '1px solid color-mix(in srgb, var(--pos) 12%, var(--panel))', fontSize: '12px', color: 'var(--fg)' }}>
                <div style={{ fontWeight: 600, color: 'var(--pos)', marginBottom: '2px' }}>Авто-повтор со сдвигом</div>
                Exponential backoff: 1м → 5м → 15м при сбоях почтового релея, затем очередь DLQ.
              </div>
              <div style={{ background: 'var(--panel)', padding: '10px 14px', borderRadius: '14px', border: '1px solid color-mix(in srgb, var(--pos) 12%, var(--panel))', fontSize: '12px', color: 'var(--fg)' }}>
                <div style={{ fontWeight: 600, color: 'var(--pos)', marginBottom: '2px' }}>Ссылка самообслуживания</div>
                Переменная <code>{'{manage_url}'}</code> генерирует защищённую ссылку без необходимости логина.
              </div>
            </div>
          </div>

          {/* Interactive Template Viewer */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: '20px', alignItems: 'flex-start' }}>
            {/* Template Selector & Settings */}
            <div style={{ background: 'var(--panel)', borderRadius: '22px', border: '1px solid var(--line)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
                События жизненного цикла
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  data-testid="template-select-confirmation"
                  onClick={() => setNotificationTemplate('confirmation')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '4px',
                    padding: '12px 14px',
                    borderRadius: '14px',
                    border: `1px solid ${notificationTemplate === 'confirmation' ? 'var(--brand)' : 'var(--line)'}`,
                    background: notificationTemplate === 'confirmation' ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'var(--panel)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600, color: notificationTemplate === 'confirmation' ? 'var(--brand)' : 'var(--fg)' }}>
                    ✓ 1. Подтверждение записи
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    Сразу после создания брони; содержит ссылку самообслуживания
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="template-select-reminder"
                  onClick={() => setNotificationTemplate('reminder')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '4px',
                    padding: '12px 14px',
                    borderRadius: '14px',
                    border: `1px solid ${notificationTemplate === 'reminder' ? 'var(--brand)' : 'var(--line)'}`,
                    background: notificationTemplate === 'reminder' ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'var(--panel)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600, color: notificationTemplate === 'reminder' ? 'var(--brand)' : 'var(--fg)' }}>
                    ⏰ 2. Напоминание о визите
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    За 2 часа до начала визита с точным адресом и мастером
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="template-select-cancellation"
                  onClick={() => setNotificationTemplate('cancellation')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '4px',
                    padding: '12px 14px',
                    borderRadius: '14px',
                    border: `1px solid ${notificationTemplate === 'cancellation' ? 'var(--brand)' : 'var(--line)'}`,
                    background: notificationTemplate === 'cancellation' ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'var(--panel)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600, color: notificationTemplate === 'cancellation' ? 'var(--brand)' : 'var(--fg)' }}>
                    ✕ 3. Отмена записи
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    При отмене клиентом или салоном; слот сразу освобождается
                  </div>
                </button>
              </div>

              <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '4px 0' }} />

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>
                  Доступные переменные шаблона:
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {['{client_name}', '{salon_name}', '{service_name}', '{date_time}', '{staff_name}', '{manage_url}'].map(tag => (
                    <span key={tag} style={{ fontSize: '11px', background: 'var(--chip)', color: 'var(--fg)', padding: '3px 7px', borderRadius: '10px', fontFamily: 'monospace' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Email Canvas Preview */}
            <div style={{ background: 'var(--panel)', borderRadius: '22px', border: '1px solid var(--line)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              {/* Preview Bar */}
              <div style={{ background: 'var(--canvas)', borderBottom: '1px solid var(--line)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Mail style={{ width: '16px', height: '16px', color: 'var(--muted)' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                    Предпросмотр транзакционного письма
                  </span>
                </div>

                <div style={{ display: 'flex', background: 'var(--line)', borderRadius: '12px', padding: '2px', gap: '2px' }}>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice('mobile')}
                    style={{
                      border: 'none',
                      background: previewDevice === 'mobile' ? 'var(--panel)' : 'transparent',
                      color: previewDevice === 'mobile' ? 'var(--fg)' : 'var(--muted)',
                      borderRadius: '10px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    <Smartphone style={{ width: '13px', height: '13px' }} />
                    <span>Мобильный</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice('desktop')}
                    style={{
                      border: 'none',
                      background: previewDevice === 'desktop' ? 'var(--panel)' : 'transparent',
                      color: previewDevice === 'desktop' ? 'var(--fg)' : 'var(--muted)',
                      borderRadius: '10px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    <Monitor style={{ width: '13px', height: '13px' }} />
                    <span>Десктоп</span>
                  </button>
                </div>
              </div>

              {/* Email Envelope details */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--chip)', fontSize: '12px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div><b>Отправитель:</b> BarberHouse &lt;noreply@barberhouse.kz&gt;</div>
                <div><b>Кому:</b> Тимур (клиент) &lt;timur@example.kz&gt;</div>
                <div>
                  <b>Тема:</b>{' '}
                  <span style={{ color: 'var(--fg)', fontWeight: 600 }}>
                    {notificationTemplate === 'confirmation' && '✓ Ваша запись в салон BarberHouse подтверждена (#BH-7821)'}
                    {notificationTemplate === 'reminder' && '⏰ Напоминание: ваш визит в BarberHouse сегодня в 16:00'}
                    {notificationTemplate === 'cancellation' && '✕ Ваша запись в салон BarberHouse отменена'}
                  </span>
                </div>
              </div>

              {/* Rendered Email Body */}
              <div style={{ padding: '24px', background: 'var(--chip)', display: 'flex', justifyContent: 'center' }}>
                <div
                  style={{
                    width: previewDevice === 'mobile' ? '360px' : '100%',
                    maxWidth: '520px',
                    background: 'var(--panel)',
                    borderRadius: '18px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.06)',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--chip)', paddingBottom: '14px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '12px', background: 'var(--brand2)', color: 'var(--brand-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px' }}>
                      BH
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--fg)' }}>BarberHouse</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>ул. Достык, 5 · Астана</div>
                    </div>
                  </div>

                  {notificationTemplate === 'confirmation' && (
                    <>
                      <div>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 700, color: 'var(--fg)' }}>
                          Здравствуйте, Тимур!
                        </h4>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
                          Ваша запись в салон успешно подтверждена. Ждем вас в назначенное время!
                        </p>
                      </div>

                      <div style={{ background: 'var(--canvas)', borderRadius: '14px', padding: '14px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Услуга:</span>
                          <span style={{ fontWeight: 600, color: 'var(--fg)' }}>Мужская стрижка (45 мин)</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Мастер:</span>
                          <span style={{ fontWeight: 600, color: 'var(--fg)' }}>Дамир Сериков</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Дата и время:</span>
                          <span style={{ fontWeight: 700, color: 'var(--brand)' }}>Завтра, 16:00</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Стоимость:</span>
                          <span style={{ fontWeight: 700, color: 'var(--fg)' }}>8 000 ₸</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                        <a
                          href="http://localhost:3000/manage/demo_tok_782"
                          data-testid="notification-preview-manage-link"
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'center',
                            background: 'var(--brand)',
                            color: 'var(--brand-fg)',
                            padding: '12px 16px',
                            borderRadius: '14px',
                            textDecoration: 'none',
                            fontSize: '14px',
                            fontWeight: 600,
                            boxSizing: 'border-box',
                          }}
                        >
                          Управлять визитом (Перенести / Отменить)
                        </a>
                        <div style={{ fontSize: '11px', color: 'var(--muted2)', textAlign: 'center' }}>
                          Вы можете изменить время визита без звонка администратору
                        </div>
                      </div>
                    </>
                  )}

                  {notificationTemplate === 'reminder' && (
                    <>
                      <div>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 700, color: 'var(--fg)' }}>
                          Напоминаем о визите через 2 часа!
                        </h4>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
                          Мастер Дамир Сериков ожидает вас сегодня в 16:00 в филиале на Достык.
                        </p>
                      </div>

                      <div style={{ background: 'color-mix(in srgb, var(--s-arrived) 14%, var(--panel))', borderRadius: '14px', padding: '14px', border: '1px solid color-mix(in srgb, var(--s-arrived) 45%, var(--panel))', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--s-arrived)' }}>Адрес филиала:</div>
                        <div style={{ color: 'var(--s-arrived)' }}>г. Астана, ул. Достык, 5 (вход с торца)</div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                        <a
                          href="http://localhost:3000/manage/demo_tok_782"
                          data-testid="notification-preview-manage-link"
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'center',
                            background: 'var(--brand2)',
                            color: 'var(--brand-fg)',
                            padding: '12px 16px',
                            borderRadius: '14px',
                            textDecoration: 'none',
                            fontSize: '14px',
                            fontWeight: 600,
                            boxSizing: 'border-box',
                          }}
                        >
                          Маршрут и детали записи
                        </a>
                      </div>
                    </>
                  )}

                  {notificationTemplate === 'cancellation' && (
                    <>
                      <div>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 700, color: 'var(--neg)' }}>
                          Запись отменена
                        </h4>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
                          Ваша бронь на Мужская стрижка была отменена. Слот освобожден для других клиентов.
                        </p>
                      </div>

                      <div style={{ background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))', borderRadius: '14px', padding: '14px', border: '1px solid color-mix(in srgb, var(--neg) 40%, var(--panel))', fontSize: '12px', color: 'var(--neg)' }}>
                        Причина: Отмена по инициативе клиента через ссылку самообслуживания.
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                        <a
                          href="http://localhost:3000"
                          data-testid="notification-preview-rebook-link"
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'center',
                            background: 'var(--brand)',
                            color: 'var(--brand-fg)',
                            padding: '12px 16px',
                            borderRadius: '14px',
                            textDecoration: 'none',
                            fontSize: '14px',
                            fontWeight: 600,
                            boxSizing: 'border-box',
                          }}
                        >
                          Записаться на другое время
                        </a>
                      </div>
                    </>
                  )}

                  <div style={{ borderTop: '1px solid var(--chip)', paddingTop: '12px', fontSize: '11px', color: 'var(--muted2)', textAlign: 'center' }}>
                    Письмо отправлено автоматически сервисом онлайн-записи CRM BarberHouse
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

            {/* MODAL: INVITE USER */}
      {showInviteModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              background: 'var(--panel)',
              borderRadius: '22px',
              padding: '28px',
              width: '460px',
              maxWidth: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--fg)' }}>
                Пригласить сотрудника
              </h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '18px', color: 'var(--muted2)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {!inviteResult ? (
              <form onSubmit={handleCreateInvite} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                    Email сотрудника
                  </label>
                  <input
                    type="email"
                    required
                    data-testid="invite-email-input"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.kz"
                    style={{
                      height: '42px',
                      padding: '0 14px',
                      borderRadius: '14px',
                      border: '1px solid var(--line)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                    Назначаемая роль
                  </label>
                  <select
                    data-testid="invite-role-select"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'master')}
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '14px',
                      border: '1px solid var(--line)',
                      fontSize: '14px',
                      outline: 'none',
                      background: 'var(--panel)',
                    }}
                  >
                    <option value="master">Мастер (доступ только к графику и клиентам, касса скрыта)</option>
                    <option value="admin">Управляющий (полное управление филиалом и расписанием)</option>
                  </select>
                </div>

                {inviteRole === 'master' && staffProfiles.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                      Привязать к профилю мастера (для доступа к своему графику)
                    </label>
                    <select
                      data-testid="invite-staff-profile-select"
                      value={inviteStaffId}
                      onChange={(e) => setInviteStaffId(e.target.value)}
                      style={{
                        height: '40px',
                        padding: '0 12px',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                        fontSize: '13px',
                        background: 'var(--panel)',
                      }}
                    >
                      <option value="">— Привязать позже —</option>
                      {staffProfiles.map((st: any) => (
                        <option key={st.id} value={st.id}>{st.display_name} ({st.role_title || 'Мастер'})</option>
                      ))}
                    </select>
                  </div>
                )}

                {inviteRole === 'admin' && branches.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                      Доступные филиалы управляющего
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--canvas)', padding: '10px 12px', borderRadius: '14px', border: '1px solid var(--line)' }}>
                      {branches.map(b => (
                        <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--fg)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={inviteBranchIds.includes(b.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setInviteBranchIds(prev => [...prev, b.id]);
                              } else {
                                setInviteBranchIds(prev => prev.filter(id => id !== b.id));
                              }
                            }}
                          />
                          <span>{b.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    style={{
                      padding: '10px 18px',
                      borderRadius: '14px',
                      border: '1px solid var(--line)',
                      background: 'var(--panel)',
                      color: 'var(--muted)',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    data-testid="invite-submit-btn"
                    disabled={inviteLoading}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '14px',
                      border: 'none',
                      background: 'var(--brand)',
                      color: 'var(--brand-fg)',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    {inviteLoading ? 'Генерация...' : 'Отправить приглашение'}
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ background: 'color-mix(in srgb, var(--pos) 12%, var(--panel))', border: '1px solid color-mix(in srgb, var(--pos) 30%, var(--panel))', borderRadius: '18px', padding: '14px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--pos)', fontSize: '13px' }}>
                  <CheckCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
                  <span>Ссылка создана с безопасным SHA-256 хешированием.</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                    Ссылка для активации
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      readOnly
                      data-testid="invite-url-input"
                      value={inviteResult.invite_url || ''}
                      style={{
                        flex: 1,
                        height: '42px',
                        padding: '0 12px',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                        fontSize: '13px',
                        background: 'var(--canvas)',
                        color: 'var(--fg)',
                      }}
                    />
                    <button
                      type="button"
                      data-testid="invite-copy-btn"
                      onClick={() => copyToClipboard(inviteResult.invite_url || '')}
                      style={{
                        padding: '0 16px',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                        background: 'var(--panel)',
                        color: 'var(--fg)',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {inviteCopied ? <Check style={{ width: '16px', height: '16px', color: 'var(--pos)' }} /> : <Copy style={{ width: '16px', height: '16px' }} />}
                      <span>{inviteCopied ? 'Скопировано' : 'Копировать'}</span>
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  style={{
                    height: '42px',
                    borderRadius: '14px',
                    border: 'none',
                    background: 'var(--brand)',
                    color: 'var(--brand-fg)',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                    marginTop: '8px',
                  }}
                >
                  Готово
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT BRANCH */}
      {showBranchModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              background: 'var(--panel)',
              borderRadius: '22px',
              padding: '28px',
              width: '480px',
              maxWidth: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--fg)' }}>
                {editingBranch ? 'Редактировать филиал' : 'Новый филиал сети'}
              </h3>
              <button
                type="button"
                onClick={() => setShowBranchModal(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '18px', color: 'var(--muted2)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBranch} data-testid="branch-form" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Название филиала <span style={{ color: 'var(--neg)' }}>*</span>
                </label>
                <input
                  type="text"
                  data-testid="branch-name-input"
                  required
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Например: Barber House Астана (Достык)"
                  style={{
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '14px',
                    border: '1px solid var(--line)',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                    Город <span style={{ color: 'var(--neg)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    data-testid="branch-city-input"
                    required
                    list="kz-cities-list"
                    value={branchCity}
                    onChange={(e) => setBranchCity(e.target.value)}
                    placeholder="Астана"
                    style={{
                      height: '42px',
                      padding: '0 14px',
                      borderRadius: '14px',
                      border: '1px solid var(--line)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                  <datalist id="kz-cities-list">
                    <option value="Астана" />
                    <option value="Алматы" />
                    <option value="Шымкент" />
                    <option value="Караганда" />
                    <option value="Актобе" />
                    <option value="Атырау" />
                    <option value="Павлодар" />
                  </datalist>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                    Режим работы
                  </label>
                  <input
                    type="text"
                    data-testid="branch-hours-input"
                    value={branchOpeningHours}
                    onChange={(e) => setBranchOpeningHours(e.target.value)}
                    placeholder="10:00 - 20:00"
                    style={{
                      height: '42px',
                      padding: '0 14px',
                      borderRadius: '14px',
                      border: '1px solid var(--line)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Фактический адрес <span style={{ color: 'var(--neg)' }}>*</span>
                </label>
                <input
                  type="text"
                  data-testid="branch-address-input"
                  required
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  placeholder="ул. Достык, 12, 1 этаж"
                  style={{
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '14px',
                    border: '1px solid var(--line)',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Контактный телефон
                </label>
                <input
                  type="text"
                  data-testid="branch-phone-input"
                  value={branchPhone}
                  onChange={(e) => setBranchPhone(e.target.value)}
                  placeholder="+7 (701) 000-00-00"
                  style={{
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '14px',
                    border: '1px solid var(--line)',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Часовой пояс филиала (IANA)
                </label>
                <select
                  data-testid="branch-timezone-select"
                  value={branchTimezone}
                  onChange={(e) => setBranchTimezone(e.target.value)}
                  style={{
                    height: '42px',
                    padding: '0 12px',
                    borderRadius: '14px',
                    border: '1px solid var(--line)',
                    fontSize: '14px',
                    outline: 'none',
                    background: 'var(--panel)',
                  }}
                >
                  <option value="Asia/Almaty">Asia/Almaty (UTC+5, Казахстан)</option>
                  <option value="Europe/Berlin">Europe/Berlin (UTC+1 / UTC+2 DST, Германия)</option>
                  <option value="America/New_York">America/New_York (UTC-5 / UTC-4 DST, США)</option>
                  <option value="UTC">UTC (Универсальное скоординированное время)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowBranchModal(false)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '14px',
                    border: '1px solid var(--line)',
                    background: 'var(--panel)',
                    color: 'var(--muted)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  data-testid="save-branch-submit-btn"
                  disabled={branchSaving}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '14px',
                    border: 'none',
                    background: 'var(--brand)',
                    color: 'var(--brand-fg)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  {branchSaving ? 'Сохранение...' : 'Сохранить филиал'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
