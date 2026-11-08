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
  CreditCard
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

  useEffect(() => {
    if (activeSubTab && activeSubTab !== currentTab) {
      setCurrentTab(activeSubTab);
    }
  }, [activeSubTab]);

  const handleTabSwitch = (tab: 'branches' | 'users' | 'company') => {
    setCurrentTab(tab);
    if (onSubTabChange) onSubTabChange(tab);
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const branchesData = await api.getBranches(token, tenantId);
      setBranches(branchesData);

      if (userRole === 'owner' || userRole === 'admin') {
        const usersData = await api.getUsers(token, tenantId);
        setUsers(usersData);
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки настроек');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [userRole, token, tenantId]);

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteLoading(true);
    setError(null);
    try {
      const res = await api.createInvite(
        {
          email: inviteEmail.trim(),
          role: inviteRole,
        },
        token,
        tenantId
      );
      setInviteResult(res);
      if (onShowToast) onShowToast('Приглашение создано!');
      // Refresh user list
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
    setBranchPhone('+7 701 ');
    setBranchTimezone('Asia/Almaty');
    setShowBranchModal(true);
  };

  const openBranchEdit = (b: BranchResponse) => {
    setEditingBranch(b);
    setBranchName(b.name);
    setBranchAddress(b.address || '');
    setBranchPhone(b.phone_number || (b as any).phone || '');
    setBranchTimezone(b.timezone || (b as any).timezone_iana || 'Asia/Almaty');
    setShowBranchModal(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Настройки бизнеса</h2>
          <p className="text-sm text-neutral-400 mt-1">
            Управление филиалами, командой с разграничением ролей и тарифной подпиской
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-xl p-1 self-start sm:self-auto">
          <button
            onClick={() => handleTabSwitch('branches')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              currentTab === 'branches'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Филиалы</span>
          </button>
          <button
            onClick={() => handleTabSwitch('users')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              currentTab === 'users'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Пользователи и роли</span>
          </button>
          <button
            onClick={() => handleTabSwitch('company')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              currentTab === 'company'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Компания и тариф</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: BRANCHES */}
      {currentTab === 'branches' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Филиалы сети ({branches.length})</h2>
            {userRole === 'owner' && (
              <button
                onClick={openBranchCreate}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium text-xs rounded-xl transition-colors shadow-lg shadow-amber-500/10"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить филиал</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((b) => (
              <div
                key={b.id}
                className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-5 flex flex-col justify-between hover:border-neutral-700 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-semibold text-white text-base">{b.name}</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Активен
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-neutral-400 mb-4">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                      <span>{b.address || 'Адрес не указан'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                      <span>{b.phone_number || 'Телефон не указан'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                      <span>{b.timezone || 'Asia/Almaty'}</span>
                    </div>
                  </div>
                </div>

                {userRole === 'owner' && (
                  <button
                    onClick={() => openBranchEdit(b)}
                    className="w-full mt-2 py-2 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-xl transition-colors border border-neutral-700/50"
                  >
                    Редактировать
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: USERS & ROLES */}
      {currentTab === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Пользователи и права доступа</h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Строгая изоляция: сотрудники получают доступ только к назначенным данным
              </p>
            </div>
            {(userRole === 'owner' || userRole === 'admin') && (
              <button
                onClick={() => {
                  setInviteResult(null);
                  setInviteEmail('');
                  setShowInviteModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium text-xs rounded-xl transition-colors shadow-lg shadow-amber-500/10"
              >
                <Plus className="w-4 h-4" />
                <span>Пригласить сотрудника</span>
              </button>
            )}
          </div>

          <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-neutral-950/50 text-neutral-400 text-xs uppercase tracking-wider border-b border-neutral-800">
                    <th className="py-3 px-5">Сотрудник</th>
                    <th className="py-3 px-5">Email</th>
                    <th className="py-3 px-5">Роль</th>
                    <th className="py-3 px-5">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {users.map((u) => {
                    const roleBadge = () => {
                      if (u.role === 'owner') {
                        return (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            Владелец (owner)
                          </span>
                        );
                      }
                      if (u.role === 'admin') {
                        return (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
                            Управляющий (admin)
                          </span>
                        );
                      }
                      return (
                        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-800 text-neutral-300 border border-neutral-700">
                          Мастер (master)
                        </span>
                      );
                    };

                    return (
                      <tr key={u.id} className="hover:bg-neutral-800/30 transition-colors">
                        <td className="py-3.5 px-5 font-medium text-white flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-semibold text-neutral-300">
                            {(u.display_name || u.email || 'U')[0].toUpperCase()}
                          </div>
                          <span>{u.display_name || 'Без имени'}</span>
                        </td>
                        <td className="py-3.5 px-5 text-neutral-400 text-xs">{u.email}</td>
                        <td className="py-3.5 px-5">{roleBadge()}</td>
                        <td className="py-3.5 px-5">
                          <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Активен
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Role explanation */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            <div className="p-4 bg-neutral-900/40 border border-neutral-800 rounded-xl text-xs space-y-1">
              <span className="font-semibold text-amber-300">Владелец (Owner)</span>
              <p className="text-neutral-400">Полный контроль: тарифы, филиалы, удаление, финансовые отчеты и назначение управляющих.</p>
            </div>
            <div className="p-4 bg-neutral-900/40 border border-neutral-800 rounded-xl text-xs space-y-1">
              <span className="font-semibold text-blue-300">Управляющий (Admin)</span>
              <p className="text-neutral-400">Операционное управление: журнал записей, клиентская база, графики мастеров, прайс-лист.</p>
            </div>
            <div className="p-4 bg-neutral-900/40 border border-neutral-800 rounded-xl text-xs space-y-1">
              <span className="font-semibold text-neutral-300">Мастер (Master)</span>
              <p className="text-neutral-400">Личный кабинет: личный график, свои записи, отметка статусов визита. Чужие данные и финансы скрыты.</p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: COMPANY & TARIFF */}
      {currentTab === 'company' && (
        <div className="space-y-6">
          <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Профиль компании</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Идентификатор и системные параметры компании</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Тариф Pro (Активен)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              <div className="p-3.5 bg-neutral-950/60 rounded-xl border border-neutral-800/60">
                <span className="text-[11px] uppercase tracking-wider text-neutral-500">Slug организации</span>
                <p className="text-sm font-semibold text-white mt-1">{tenantSlug}</p>
              </div>
              <div className="p-3.5 bg-neutral-950/60 rounded-xl border border-neutral-800/60">
                <span className="text-[11px] uppercase tracking-wider text-neutral-500">Статус аккаунта</span>
                <p className="text-sm font-semibold text-emerald-400 mt-1">Нормальный (Active)</p>
              </div>
              <div className="p-3.5 bg-neutral-950/60 rounded-xl border border-neutral-800/60">
                <span className="text-[11px] uppercase tracking-wider text-neutral-500">Филиалов по тарифу</span>
                <p className="text-sm font-semibold text-white mt-1">{branches.length} из 3 доступных</p>
              </div>
            </div>
          </div>

          {/* Subscription & Safety */}
          <div className="p-5 bg-gradient-to-r from-amber-500/10 via-neutral-900 to-neutral-900 border border-amber-500/20 rounded-2xl flex items-start gap-4">
            <ShieldCheck className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-white">Изоляция данных и резервное копирование</h4>
              <p className="text-xs text-neutral-400 mt-1">
                Все клиентские записи, прайс-листы и контакты защищены строгой схемой Row Level Security PostgreSQL.
                Доступ третьих лиц или других организаций полностью исключен на уровне ядра платформы.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: INVITE USER */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-white">Пригласить сотрудника</h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-neutral-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {!inviteResult ? (
              <form onSubmit={handleCreateInvite} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Email сотрудника
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Роль в компании
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="master">Мастер (только свои визиты и график)</option>
                    <option value="admin">Управляющий (доступ ко всему филиалу)</option>
                  </select>
                </div>

                <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 text-xs text-neutral-400">
                  ⚠️ Для уже зарегистрированных пользователей ссылка привяжет роль без сброса пароля.
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white rounded-xl bg-neutral-800 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={inviteLoading}
                    className="px-4 py-2 text-xs font-medium text-neutral-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-xl transition-colors shadow-lg shadow-amber-500/10"
                  >
                    {inviteLoading ? 'Создание...' : 'Отправить приглашение'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 py-2">
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs">
                  ✓ Приглашение успешно сгенерировано!
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Ссылка для активации:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteResult.invite_url || `https://app.crm.com/accept-invite?token=${inviteResult.invite_token}`}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-300 font-mono"
                    />
                    <button
                      onClick={() =>
                        copyToClipboard(
                          inviteResult.invite_url ||
                            `https://app.crm.com/accept-invite?token=${inviteResult.invite_token}`
                        )
                      }
                      className="p-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl hover:bg-amber-500/30 transition-colors shrink-0"
                      title="Копировать"
                    >
                      {inviteCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="px-4 py-2 text-xs font-medium text-neutral-950 bg-amber-500 hover:bg-amber-400 rounded-xl transition-colors"
                  >
                    Готово
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: BRANCH ADD/EDIT */}
      {showBranchModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-white">
                {editingBranch ? 'Редактировать филиал' : 'Новый филиал'}
              </h3>
              <button
                onClick={() => setShowBranchModal(false)}
                className="text-neutral-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBranch} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Название филиала *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Филиал Dostyk"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Адрес
                </label>
                <input
                  type="text"
                  placeholder="пр. Достык, 128"
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Номер телефона
                </label>
                <input
                  type="text"
                  placeholder="+7 701 555 12 34"
                  value={branchPhone}
                  onChange={(e) => setBranchPhone(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Часовой пояс
                </label>
                <select
                  value={branchTimezone}
                  onChange={(e) => setBranchTimezone(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="Asia/Almaty">Asia/Almaty (UTC+5)</option>
                  <option value="Asia/Aqtau">Asia/Aqtau (UTC+5)</option>
                  <option value="Europe/Moscow">Europe/Moscow (UTC+3)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBranchModal(false)}
                  className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white rounded-xl bg-neutral-800 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={branchSaving}
                  className="px-4 py-2 text-xs font-medium text-neutral-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-xl transition-colors shadow-lg shadow-amber-500/10"
                >
                  {branchSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
