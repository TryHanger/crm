import React, { useState, useEffect } from 'react';
import { PlatformApiClient, PlatformStaffItem, PlatformSettingsResponse } from '@crm/api-client';
import { PlatformRole, ROLE_LABELS, ROLE_BADGE_COLORS } from '../../types';

interface PlatformSettingsModuleProps {
  api: PlatformApiClient;
  token: string;
  userRole: PlatformRole;
  showToast: (msg: string) => void;
}

export const PlatformSettingsModule: React.FC<PlatformSettingsModuleProps> = ({
  api,
  token,
  userRole,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'staff' | 'rbac' | 'lifecycle'>('staff');

  // Staff state
  const [staffList, setStaffList] = useState<PlatformStaffItem[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<PlatformRole>('viewer');
  const [isSubmittingStaff, setIsSubmittingStaff] = useState(false);
  const [createdActivationUrl, setCreatedActivationUrl] = useState<string | null>(null);

  // Platform Lifecycle Settings
  const [settingsData, setSettingsData] = useState<PlatformSettingsResponse | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [trialDays, setTrialDays] = useState(14);
  const [graceDays, setGraceDays] = useState(7);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const canManagePlatform = userRole === 'platform_owner';

  const loadStaff = async () => {
    setIsLoadingStaff(true);
    try {
      const res = await api.getStaff(token);
      setStaffList(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки сотрудников платформы');
    } finally {
      setIsLoadingStaff(false);
    }
  };

  const loadSettings = async () => {
    setIsLoadingSettings(true);
    try {
      const res = await api.getSettings(token);
      setSettingsData(res);
      if (res.settings_map.trial_days !== undefined) setTrialDays(res.settings_map.trial_days);
      if (res.settings_map.grace_period_days !== undefined) setGraceDays(res.settings_map.grace_period_days);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки настроек платформы');
    } finally {
      setIsLoadingSettings(false);
    }
  };

  useEffect(() => {
    loadStaff();
    loadSettings();
  }, [token]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffEmail.trim() || !newStaffName.trim()) return;
    setIsSubmittingStaff(true);
    try {
      const res = await api.createStaff(
        {
          email: newStaffEmail.toLowerCase().trim(),
          display_name: newStaffName.trim(),
          platform_role: newStaffRole,
        },
        token
      );
      showToast(`Оператор ${newStaffName} (${newStaffRole}) успешно приглашён`);
      const targetPath = res.activation_url || ('/activate-platform?token=' + encodeURIComponent(res.activation_token));
      const fullUrl = new URL(targetPath, window.location.origin).href;
      setCreatedActivationUrl(fullUrl);
      setShowAddStaffModal(false);
      setNewStaffEmail('');
      setNewStaffName('');
      await loadStaff();
    } catch (err: any) {
      showToast(err.message || 'Ошибка добавления оператора');
    } finally {
      setIsSubmittingStaff(false);
    }
  };

  const handleSaveLifecycleSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      await api.updateSetting('trial_days', { value: trialDays, description: 'Длительность пробного периода по умолчанию' }, token);
      await api.updateSetting('grace_period_days', { value: graceDays, description: 'Длительность льготного периода до приостановки' }, token);
      showToast('Настройки жизненного цикла успешно сохранены');
      await loadSettings();
    } catch (err: any) {
      showToast(err.message || 'Ошибка сохранения настроек');
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* TABS BAR */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          padding: '16px 20px',
          border: '1px solid #E2E8F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('staff')}
            data-testid="tab-settings-staff"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'staff' ? '#2563EB' : '#F1F5F9',
              color: activeTab === 'staff' ? '#FFFFFF' : '#475569',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            👥 Персонал платформы
          </button>
          <button
            onClick={() => setActiveTab('rbac')}
            data-testid="tab-settings-rbac"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'rbac' ? '#2563EB' : '#F1F5F9',
              color: activeTab === 'rbac' ? '#FFFFFF' : '#475569',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            🛡️ Матрица прав доступа (RBAC)
          </button>
          <button
            onClick={() => setActiveTab('lifecycle')}
            data-testid="tab-settings-lifecycle"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'lifecycle' ? '#2563EB' : '#F1F5F9',
              color: activeTab === 'lifecycle' ? '#FFFFFF' : '#475569',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ⚙️ Жизненный цикл SaaS
          </button>
        </div>

        {activeTab === 'staff' && canManagePlatform && (
          <button
            onClick={() => setShowAddStaffModal(true)}
            data-testid="add-staff-open-modal-btn"
            style={{
              padding: '8px 16px',
              background: '#2563EB',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Добавить оператора
          </button>
        )}
      </div>

      {/* TAB 1: PLATFORM STAFF */}
      {activeTab === 'staff' && (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', background: '#FAFAFA' }}>
            <b style={{ fontSize: '15px', color: '#0F172A' }}>Сотрудники управляющей компании (Platform Staff)</b>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table
              data-testid="platform-staff-table"
              style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Оператор</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Платформенная роль</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Статус</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Дата добавления</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingStaff ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: '#64748B' }}>
                      Загрузка сотрудников...
                    </td>
                  </tr>
                ) : (
                  staffList.map(st => {
                    const badge = ROLE_BADGE_COLORS[st.platform_role as PlatformRole] || {
                      bg: '#F1F5F9',
                      color: '#475569',
                      border: '#CBD5E1',
                    };
                    return (
                      <tr key={st.id} data-testid={`staff-row-${st.email}`} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '14px 16px', fontWeight: 600, color: '#0F172A' }}>
                          {st.display_name}
                        </td>
                        <td style={{ padding: '14px 16px', color: '#475569' }}>
                          {st.email}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: badge.bg,
                              color: badge.color,
                              border: `1px solid ${badge.border}`,
                            }}
                          >
                            {ROLE_LABELS[st.platform_role as PlatformRole] || st.platform_role}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{ color: '#16A34A', fontWeight: 600, fontSize: '12px' }}>
                            ● {st.status === 'active' ? 'Активен' : st.status}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', color: '#64748B', fontSize: '12px' }}>
                          {new Date(st.created_at).toLocaleDateString('ru-RU')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: RBAC MATRIX */}
      {activeTab === 'rbac' && (
        <div
          data-testid="rbac-matrix-card"
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', background: '#FAFAFA' }}>
            <b style={{ fontSize: '15px', color: '#0F172A' }}>Разграничение полномочий платформы (RBAC Matrix)</b>
            <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
              Разделение прав между владельцем платформы, финансами, поддержкой и наблюдателями
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Действие / Модуль</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>👑 Владелец (Owner)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>💳 Финансы (Finance)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>🛠️ Поддержка (Support)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>👁️ Аналитик (Viewer)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: 'Просмотр всех реестров и карточек (чтение)', owner: '✅', fin: '✅', sup: '✅', viw: '✅' },
                  { name: 'Онбординг новых компаний (создание)', owner: '✅', fin: '❌', sup: '✅', viw: '❌' },
                  { name: 'Приостановка компании (suspend / reactivate)', owner: '✅', fin: '❌', sup: '❌', viw: '❌' },
                  { name: 'Выставление счетов и фиксация оплат', owner: '✅', fin: '✅', sup: '❌', viw: '❌' },
                  { name: 'Управление каталогом тарифов и версий', owner: '✅', fin: '❌', sup: '❌', viw: '❌' },
                  { name: 'Исключения модулей (Entitlement Overrides)', owner: '✅', fin: '❌', sup: '✅', viw: '❌' },
                  { name: 'Запрос временного доступа (30 мин)', owner: '✅', fin: '❌', sup: '✅', viw: '❌' },
                  { name: 'Управление операторами и настройками', owner: '✅', fin: '❌', sup: '❌', viw: '❌' },
                ].map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: '#0F172A' }}>{row.name}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 700 }}>{row.owner}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 700 }}>{row.fin}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 700 }}>{row.sup}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 700 }}>{row.viw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: LIFECYCLE SETTINGS */}
      {activeTab === 'lifecycle' && (
        <div
          data-testid="lifecycle-settings-card"
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            padding: '24px',
            border: '1px solid #E2E8F0',
            maxWidth: '600px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#0F172A' }}>Параметры жизненного цикла подписок</h3>
          <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 20px 0' }}>
            Глобальные константы платформы для расчёта пробных и льготных периодов
          </p>

          <form onSubmit={handleSaveLifecycleSettings} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Пробный период по умолчанию (Trial days):
              </label>
              <input
                type="number"
                min={1}
                max={90}
                value={trialDays}
                onChange={e => setTrialDays(Number(e.target.value))}
                disabled={!canManagePlatform}
                data-testid="trial-days-input"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
              />
              <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>
                Количество дней с момента создания компании, в течение которых доступ предоставляется бесплатно.
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Льготный период при неоплате (Grace period days):
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={graceDays}
                onChange={e => setGraceDays(Number(e.target.value))}
                disabled={!canManagePlatform}
                data-testid="grace-days-input"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
              />
              <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>
                Период после окончания подписки, в течение которого сервис продолжает работу до заморозки.
              </div>
            </div>

            {canManagePlatform && (
              <div style={{ marginTop: '8px' }}>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  data-testid="save-lifecycle-settings-btn"
                  style={{
                    padding: '9px 18px',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isSavingSettings ? 'Сохранение...' : 'Сохранить параметры'}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* MODAL: ADD PLATFORM OPERATOR */}
      {showAddStaffModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px',
          }}
        >
          <div
            data-testid="add-staff-modal"
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', color: '#0F172A' }}>
              Добавить оператора платформы
            </h3>
            <form onSubmit={handleCreateStaff} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Email оператора:
                </label>
                <input
                  type="email"
                  value={newStaffEmail}
                  onChange={e => setNewStaffEmail(e.target.value)}
                  placeholder="operator@platform.example.kz"
                  required
                  data-testid="staff-email-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  ФИО / Отображаемое имя:
                </label>
                <input
                  type="text"
                  value={newStaffName}
                  onChange={e => setNewStaffName(e.target.value)}
                  placeholder="Айбек Сагинов"
                  required
                  data-testid="staff-name-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Платформенная роль:
                </label>
                <select
                  value={newStaffRole}
                  onChange={e => setNewStaffRole(e.target.value as PlatformRole)}
                  data-testid="staff-role-select"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                >
                  <option value="viewer">Аналитик / Наблюдатель (только чтение)</option>
                  <option value="support">Техническая поддержка (тикеты, онбординг, диагностика)</option>
                  <option value="finance">Финансы и биллинг (счета, платежи)</option>
                  <option value="platform_owner">Владелец платформы (полный доступ, suspend, тарифы)</option>
                </select>
              </div>

              <div style={{ background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '8px', padding: '12px', fontSize: '12px', color: '#475569', lineHeight: 1.4 }}>
                🔒 <b>Безопасная активация без пароля по умолчанию:</b><br />
                После создания оператора система сгенерирует защищённую одноразовую ссылку (TTL: 24 часа), по которой сотрудник самостоятельно задаст надёжный пароль.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddStaffModal(false)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingStaff}
                  data-testid="confirm-add-staff-btn"
                  style={{ padding: '8px 18px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSubmittingStaff ? 'Добавление...' : 'Добавить оператора'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ACTIVATION URL SUCCESS MODAL */}
      {createdActivationUrl && (
        <div
          data-testid="activation-url-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '14px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ fontSize: '24px' }}>🔑</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>
                  Ссылка одноразовой активации создана
                </h3>
                <div style={{ fontSize: '12px', color: '#64748B' }}>
                  Срок действия: 24 часа · Защита от повторного использования
                </div>
              </div>
            </div>

            <p style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5, margin: '0 0 16px 0' }}>
              Передайте эту одноразовую ссылку новому оператору платформы. При переходе он установит личный надёжный пароль:
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
              <input
                type="text"
                readOnly
                value={createdActivationUrl}
                data-testid="activation-url-display"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  background: '#F8FAFC',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(createdActivationUrl);
                  showToast('Ссылка скопирована в буфер обмена');
                }}
                style={{
                  padding: '10px 14px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Копировать
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setCreatedActivationUrl(null)}
                data-testid="close-activation-modal-btn"
                style={{
                  padding: '8px 18px',
                  background: '#0F172A',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
