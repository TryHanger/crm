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
  ExternalLink
} from 'lucide-react';
import { BusinessCrmApiClient, BranchResponse, MembershipResponse } from '@crm/api-client';

interface SettingsModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  tenantSlug: string;
  userRole: string;
  activeSubTab?: 'branches' | 'users' | 'company';
  onSubTabChange?: (tab: 'branches' | 'users' | 'company') => void;
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
  const [currentTab, setCurrentTab] = useState<'branches' | 'users' | 'company'>(activeSubTab);
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [users, setUsers] = useState<MembershipResponse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'master'>('master');
  const [inviteResult, setInviteResult] = useState<{ invite_url?: string; invite_token?: string } | null>(null);
  const [inviteLoading, setInviteLoading] = useState<boolean>(false);
  const [inviteCopied, setInviteCopied] = useState<boolean>(false);

  // Branch modal state
  const [showBranchModal, setShowBranchModal] = useState<boolean>(false);
  const [editingBranch, setEditingBranch] = useState<BranchResponse | null>(null);
  const [branchName, setBranchName] = useState<string>('');
  const [branchAddress, setBranchAddress] = useState<string>('');
  const [branchPhone, setBranchPhone] = useState<string>('');
  const [branchTimezone, setBranchTimezone] = useState<string>('Asia/Almaty');
  const [branchSaving, setBranchSaving] = useState<boolean>(false);

  const handleTabSwitch = (tab: 'branches' | 'users' | 'company') => {
    setCurrentTab(tab);
    if (onSubTabChange) onSubTabChange(tab);
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [branchesData, usersData] = await Promise.all([
          api.getBranches(token, tenantId),
          api.getUsers(token, tenantId),
        ]);
        setBranches(branchesData);
        setUsers(usersData);
      } catch (err: any) {
        setError(err?.message || 'Не удалось загрузить настройки');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [token, tenantId, api]);

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
    if (!branchName) return;
    setBranchSaving(true);
    setError(null);
    try {
      const branchPayload: any = {
        name: branchName,
        address: branchAddress,
        phone: branchPhone,
        phone_number: branchPhone,
        timezone: branchTimezone,
        timezone_iana: branchTimezone,
      };
      if (editingBranch) {
        await api.updateBranch(
          editingBranch.id,
          branchPayload,
          token,
          tenantId
        );
        if (onShowToast) onShowToast('Филиал обновлен');
      } else {
        await api.createBranch(
          branchPayload,
          token,
          tenantId
        );
        if (onShowToast) onShowToast('Филиал создан');
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
    setBranchAddress('');
    setBranchPhone('+7 (701) ');
    setBranchTimezone('Asia/Almaty');
    setShowBranchModal(true);
  };

  const openBranchEdit = (b: BranchResponse) => {
    setEditingBranch(b);
    setBranchName(b.name || '');
    setBranchAddress(b.address || '');
    setBranchPhone(b.phone || (b as any).phone_number || '');
    setBranchTimezone(b.timezone_iana || (b as any).timezone || 'Asia/Almaty');
    setShowBranchModal(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px', boxSizing: 'border-box' }}>
      {/* Header & Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
            Настройки бизнеса
          </h2>
          <p style={{ fontSize: '13px', color: '#64748B', margin: '4px 0 0' }}>
            Управление филиалами, командой с разграничением ролей и тарифной подпиской
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '3px', gap: '4px' }}>
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
              borderRadius: '8px',
              border: 'none',
              background: currentTab === 'branches' ? '#FFFFFF' : 'transparent',
              color: currentTab === 'branches' ? '#2563EB' : '#64748B',
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
              borderRadius: '8px',
              border: 'none',
              background: currentTab === 'users' ? '#FFFFFF' : 'transparent',
              color: currentTab === 'users' ? '#2563EB' : '#64748B',
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
              borderRadius: '8px',
              border: 'none',
              background: currentTab === 'company' ? '#FFFFFF' : 'transparent',
              color: currentTab === 'company' ? '#2563EB' : '#64748B',
              boxShadow: currentTab === 'company' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
            }}
          >
            <CreditCard style={{ width: '15px', height: '15px' }} />
            <span>Компания и тариф</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', color: '#DC2626', fontSize: '14px' }}>
          <AlertCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: BRANCHES */}
      {currentTab === 'branches' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', margin: 0 }}>
              Филиалы сети ({branches.length})
            </h2>
            {userRole === 'owner' && (
              <button
                type="button"
                onClick={openBranchCreate}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 16px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  borderRadius: '10px',
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
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '16px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Building2 style={{ width: '20px', height: '20px' }} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>{b.name}</h3>
                      <span style={{ display: 'inline-block', marginTop: '2px', padding: '2px 8px', borderRadius: '4px', background: '#ECFDF5', color: '#059669', fontSize: '11px', fontWeight: 600 }}>
                        Активен
                      </span>
                    </div>
                  </div>
                  {userRole === 'owner' && (
                    <button
                      type="button"
                      onClick={() => openBranchEdit(b)}
                      style={{
                        padding: '6px 12px',
                        background: '#F8FAFC',
                        border: '1px solid #CBD5E1',
                        borderRadius: '8px',
                        color: '#475569',
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#475569', borderTop: '1px solid #F1F5F9', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MapPin style={{ width: '15px', height: '15px', color: '#94A3B8', flexShrink: 0 }} />
                    <span>{b.address || 'Адрес не указан'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Phone style={{ width: '15px', height: '15px', color: '#94A3B8', flexShrink: 0 }} />
                    <span>{b.phone || (b as any).phone_number || 'Телефон не указан'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock style={{ width: '15px', height: '15px', color: '#94A3B8', flexShrink: 0 }} />
                    <span>{b.timezone_iana || (b as any).timezone || 'Asia/Almaty'}</span>
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
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                Пользователи и права доступа ({users.length})
              </h2>
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                Разграничение доступа для владельцев, управляющих и специалистов
              </div>
            </div>
            {['owner', 'admin'].includes(userRole) && (
              <button
                type="button"
                onClick={() => {
                  setShowInviteModal(true);
                  setInviteResult(null);
                  setInviteEmail('');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 16px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  borderRadius: '10px',
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

          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600 }}>
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
                    const roleBg = isOwner ? '#FEF3C7' : isAdmin ? '#EFF6FF' : '#F1F5F9';
                    const roleColor = isOwner ? '#92400E' : isAdmin ? '#1D4ED8' : '#334155';

                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '12px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: isOwner ? '#F59E0B' : '#2563EB', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>
                              {(u.display_name || u.email || 'СП').slice(0, 2).toUpperCase()}
                            </div>
                            <span style={{ fontWeight: 600, color: '#0F172A' }}>{u.display_name || 'Без имени'}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#475569' }}>
                          {u.email}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '6px', background: roleBg, color: roleColor, fontWeight: 600, fontSize: '11px' }}>
                            {roleLabel}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: u.status === 'active' ? '#059669' : '#D97706', fontWeight: 500, fontSize: '12px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: u.status === 'active' ? '#059669' : '#D97706' }} />
                            {u.status === 'active' ? 'Активен' : 'Ожидает'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 20px', textAlign: 'right', color: '#94A3B8', fontSize: '12px' }}>
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
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #F1F5F9', paddingBottom: '16px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#0F172A', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '16px' }}>
                {tenantSlug ? tenantSlug.slice(0, 2).toUpperCase() : 'BH'}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Профиль компании</h3>
                <div style={{ fontSize: '13px', color: '#64748B' }}>Идентификация бизнеса в экосистеме</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                <span style={{ color: '#64748B' }}>Субдомен онлайн-записи:</span>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>{tenantSlug}.localhost:3000</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                <span style={{ color: '#64748B' }}>Идентификатор тенанта (ID):</span>
                <span style={{ fontWeight: 500, color: '#475569', fontFamily: 'monospace', fontSize: '12px' }}>{tenantId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                <span style={{ color: '#64748B' }}>Основная валюта расчётов:</span>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>KZT (₸)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: '#64748B' }}>Статус аккаунта:</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#059669', fontWeight: 600 }}>
                  <CheckCircle style={{ width: '15px', height: '15px' }} />
                  Верифицирован
                </span>
              </div>
            </div>
          </div>

          {/* Subscription & Plan Card */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F1F5F9', paddingBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Тариф Pro</h3>
                <div style={{ fontSize: '13px', color: '#64748B' }}>План подписки и лимиты ресурсов</div>
              </div>
              <span style={{ padding: '4px 12px', borderRadius: '8px', background: '#FEF3C7', color: '#92400E', fontWeight: 700, fontSize: '12px' }}>
                Активен
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                <span style={{ color: '#64748B' }}>Лимит филиалов:</span>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>До 3 филиалов (использовано: {branches.length})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                <span style={{ color: '#64748B' }}>Лимит сотрудников:</span>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>До 10 мастеров</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                <span style={{ color: '#64748B' }}>Онлайн-запись и виджет:</span>
                <span style={{ fontWeight: 600, color: '#059669' }}>Включено без ограничений</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: '#64748B' }}>Период действия:</span>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>Бессрочный dev-доступ</span>
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
              background: '#FFFFFF',
              borderRadius: '20px',
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
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
                Пригласить сотрудника
              </h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '18px', color: '#94A3B8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {!inviteResult ? (
              <form onSubmit={handleCreateInvite} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    Email сотрудника
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.kz"
                    style={{
                      height: '42px',
                      padding: '0 14px',
                      borderRadius: '10px',
                      border: '1px solid #CBD5E1',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    Назначаемая роль
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '10px',
                      border: '1px solid #CBD5E1',
                      fontSize: '14px',
                      outline: 'none',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="master">Мастер (доступ только к своему графику и клиентам)</option>
                    <option value="admin">Управляющий (полное управление филиалом и расписанием)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    style={{
                      padding: '10px 18px',
                      borderRadius: '10px',
                      border: '1px solid #CBD5E1',
                      background: '#FFFFFF',
                      color: '#475569',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={inviteLoading}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '10px',
                      border: 'none',
                      background: '#2563EB',
                      color: '#FFFFFF',
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
                <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '12px', padding: '14px', display: 'flex', alignItems: 'center', gap: '10px', color: '#065F46', fontSize: '13px' }}>
                  <CheckCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
                  <span>Ссылка создана с безопасным SHA-256 хешированием.</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    Ссылка для активации
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      readOnly
                      value={inviteResult.invite_url || ''}
                      style={{
                        flex: 1,
                        height: '42px',
                        padding: '0 12px',
                        borderRadius: '10px',
                        border: '1px solid #CBD5E1',
                        fontSize: '13px',
                        background: '#F8FAFC',
                        color: '#0F172A',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(inviteResult.invite_url || '')}
                      style={{
                        padding: '0 16px',
                        borderRadius: '10px',
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#0F172A',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {inviteCopied ? <Check style={{ width: '16px', height: '16px', color: '#059669' }} /> : <Copy style={{ width: '16px', height: '16px' }} />}
                      <span>{inviteCopied ? 'Скопировано' : 'Копировать'}</span>
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  style={{
                    height: '42px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#2563EB',
                    color: '#FFFFFF',
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
              background: '#FFFFFF',
              borderRadius: '20px',
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
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
                {editingBranch ? 'Редактировать филиал' : 'Новый филиал сети'}
              </h3>
              <button
                type="button"
                onClick={() => setShowBranchModal(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '18px', color: '#94A3B8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBranch} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Название филиала
                </label>
                <input
                  type="text"
                  required
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Например: Barber House Астана (Достык)"
                  style={{
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Фактический адрес
                </label>
                <input
                  type="text"
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  placeholder="ул. Достык, 12, 1 этаж"
                  style={{
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Контактный телефон
                </label>
                <input
                  type="text"
                  value={branchPhone}
                  onChange={(e) => setBranchPhone(e.target.value)}
                  placeholder="+7 (701) 000-00-00"
                  style={{
                    height: '42px',
                    padding: '0 14px',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Часовой пояс филиала (IANA)
                </label>
                <select
                  value={branchTimezone}
                  onChange={(e) => setBranchTimezone(e.target.value)}
                  style={{
                    height: '42px',
                    padding: '0 12px',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '14px',
                    outline: 'none',
                    background: '#FFFFFF',
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
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#475569',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={branchSaving}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#2563EB',
                    color: '#FFFFFF',
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
