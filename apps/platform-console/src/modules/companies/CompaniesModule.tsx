import React, { useState, useEffect } from 'react';
import {
  PlatformApiClient,
  PlatformTenantListItem,
  PlatformTenantDetailResponse,
  PlatformTenantUsersResponse,
  PlatformTenantEntitlement,
  PlatformAuditEventItem,
} from '@crm/api-client';
import { PlatformRole } from '../../types';

interface CompaniesModuleProps {
  api: PlatformApiClient;
  token: string;
  userRole: PlatformRole;
  selectedTenantId: string | null;
  onClearSelectedTenant: () => void;
  onNavigateToSupport: (tenantId: string) => void;
  showToast: (msg: string) => void;
}

export const CompaniesModule: React.FC<CompaniesModuleProps> = ({
  api,
  token,
  userRole,
  selectedTenantId,
  onClearSelectedTenant,
  onNavigateToSupport,
  showToast,
}) => {
  // Repertoire list state
  const [tenants, setTenants] = useState<PlatformTenantListItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [verticalFilter, setVerticalFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');

  // Active Tenant Detail state
  const [activeTenantId, setActiveTenantId] = useState<string | null>(selectedTenantId);
  const [detail, setDetail] = useState<PlatformTenantDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'subscription' | 'entitlements' | 'users' | 'domains' | 'activity' | 'support'
  >('overview');

  // Sub-resource states for Detail Tabs
  const [usersData, setUsersData] = useState<PlatformTenantUsersResponse | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [entitlementsData, setEntitlementsData] = useState<PlatformTenantEntitlement[]>([]);
  const [activityData, setActivityData] = useState<PlatformAuditEventItem[]>([]);

  // Modals state
  const [showWizard, setShowWizard] = useState(false);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [showChangePlanModal, setShowChangePlanModal] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [modalReason, setModalReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Wizard state (4 steps)
  const [wizardStep, setWizardStep] = useState(1);
  const [wizName, setWizName] = useState('');
  const [wizSlug, setWizSlug] = useState('');
  const [wizVertical, setWizVertical] = useState('barbershop');
  const [wizPlan, setWizPlan] = useState('start');
  const [wizOwnerName, setWizOwnerName] = useState('');
  const [wizOwnerEmail, setWizOwnerEmail] = useState('');
  const [wizResult, setWizResult] = useState<{ tenantId: string; inviteUrl: string } | null>(null);

  // Override form
  const [overrideKey, setOverrideKey] = useState('max_branches');
  const [overrideValue, setOverrideValue] = useState<number>(3);
  const [overrideDays, setOverrideDays] = useState<number>(30);
  const [overrideReason, setOverrideReason] = useState('');

  // Change Plan form
  const [newPlanCode, setNewPlanCode] = useState('pro');

  const canSuspend = userRole === 'platform_owner';
  const canModifyModules = ['platform_owner', 'support'].includes(userRole);
  const canCreateCompany = ['platform_owner', 'support'].includes(userRole);

  // Load Tenants Repertoire
  const loadTenants = async () => {
    setIsLoadingList(true);
    try {
      const res = await api.getTenants(
        {
          query: searchQuery || undefined,
          niche: verticalFilter || undefined,
          plan_code: planFilter || undefined,
          status_filter: statusFilter || undefined,
          payment_status: paymentFilter || undefined,
        },
        token
      );
      setTenants(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки списка компаний');
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, [token, verticalFilter, planFilter, statusFilter, paymentFilter]);

  // Handle selectedTenantId prop change
  useEffect(() => {
    if (selectedTenantId) {
      setActiveTenantId(selectedTenantId);
    }
  }, [selectedTenantId]);

  // Load Tenant Detail and Sub-resources
  const loadTenantDetail = async (tenantId: string) => {
    setIsLoadingDetail(true);
    try {
      const d = await api.getTenantDetails(tenantId, token);
      setDetail(d);

      // Load sub-resources concurrently with explicit error tracking
      setUsersError(null);
      const [uRes, ent, act] = await Promise.all([
        api.getTenantUsers(tenantId, token).then(res => ({ ok: true as const, data: res })).catch(err => ({ ok: false as const, error: err.message || 'Ошибка загрузки пользователей' })),
        api.getTenantEntitlements(tenantId, token).catch(() => []),
        api.getTenantActivity(tenantId, token).catch(() => []),
      ]);

      if (uRes.ok) {
        setUsersData(uRes.data);
        setUsersError(null);
      } else {
        setUsersError(uRes.error);
        setUsersData(null);
      }
      setEntitlementsData(ent);
      setActivityData(act);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки карточки компании');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (activeTenantId) {
      loadTenantDetail(activeTenantId);
    } else {
      setDetail(null);
    }
  }, [activeTenantId]);

  // Action: Suspend Tenant
  const handleSuspendTenant = async () => {
    if (!activeTenantId || !modalReason.trim()) return;
    setIsSubmitting(true);
    try {
      await api.suspendTenant(activeTenantId, modalReason.trim(), token);
      showToast('Компания успешно приостановлена');
      setShowSuspendModal(false);
      setModalReason('');
      await loadTenantDetail(activeTenantId);
      await loadTenants();
    } catch (err: any) {
      showToast(err.message || 'Ошибка приостановки компании');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Reactivate Tenant
  const handleReactivateTenant = async () => {
    if (!activeTenantId || !modalReason.trim()) return;
    setIsSubmitting(true);
    try {
      await api.reactivateTenant(activeTenantId, modalReason.trim(), token);
      showToast('Доступ компании успешно восстановлен');
      setShowReactivateModal(false);
      setModalReason('');
      await loadTenantDetail(activeTenantId);
      await loadTenants();
    } catch (err: any) {
      showToast(err.message || 'Ошибка восстановления доступа');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Change Plan
  const handleChangePlan = async () => {
    if (!activeTenantId) return;
    setIsSubmitting(true);
    try {
      await api.changeTenantPlan(activeTenantId, { new_plan_code: newPlanCode, reason: modalReason }, token);
      showToast(`Тариф успешно изменён на ${newPlanCode.toUpperCase()}`);
      setShowChangePlanModal(false);
      setModalReason('');
      await loadTenantDetail(activeTenantId);
      await loadTenants();
    } catch (err: any) {
      showToast(err.message || 'Ошибка смены тарифа');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Add Entitlement Override
  const handleSaveOverride = async () => {
    if (!activeTenantId || !overrideReason.trim()) {
      showToast('Укажите обязательную причину предоставления исключения');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.setTenantEntitlementOverride(
        activeTenantId,
        {
          feature_key: overrideKey,
          override_value: overrideValue,
          expires_days: overrideDays,
          reason: overrideReason.trim(),
        },
        token
      );
      showToast(`Исключение для ${overrideKey} успешно добавлено на ${overrideDays} дн.`);
      setShowOverrideModal(false);
      setOverrideReason('');
      const ents = await api.getTenantEntitlements(activeTenantId, token);
      setEntitlementsData(ents);
    } catch (err: any) {
      showToast(err.message || 'Ошибка добавления исключения');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Resend Invite
  const handleResendInvite = async (email: string) => {
    if (!activeTenantId) return;
    try {
      const res = await api.resendInvite(activeTenantId, email, token);
      showToast(`Ссылка-приглашение обновлена для ${email}`);
      if (res.invite_url) {
        navigator.clipboard.writeText(res.invite_url);
        showToast('Ссылка скопирована в буфер обмена!');
      }
      const u = await api.getTenantUsers(activeTenantId, token);
      setUsersData(u);
    } catch (err: any) {
      showToast(err.message || 'Ошибка обновления приглашения');
    }
  };

  // Action: Submit Onboarding Wizard
  const handleFinishWizard = async () => {
    if (!wizName || !wizSlug || !wizOwnerEmail) {
      showToast('Заполните все обязательные поля');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.createTenant(
        {
          slug: wizSlug.toLowerCase().trim(),
          display_name: wizName.trim(),
          owner_name: wizOwnerName.trim() || wizName.trim(),
          owner_email: wizOwnerEmail.toLowerCase().trim(),
          vertical: wizVertical,
          plan_code: wizPlan,
        },
        token
      );

      setWizResult({
        tenantId: res.tenant_id,
        inviteUrl: res.invite_url || `https://crm.example.kz/accept-invite?token=${res.invite_token}`,
      });
      setWizardStep(4);
      await loadTenants();
      showToast('Компания успешно создана!');
    } catch (err: any) {
      showToast(err.message || 'Ошибка создания компании');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetWizard = () => {
    setShowWizard(false);
    setWizardStep(1);
    setWizName('');
    setWizSlug('');
    setWizVertical('barbershop');
    setWizPlan('start');
    setWizOwnerName('');
    setWizOwnerEmail('');
    setWizResult(null);
  };

  // =========================================================================
  // RENDER: COMPANY DETAIL VIEW (7 TABS)
  // =========================================================================
  if (activeTenantId && detail) {
    const isSuspended = detail.lifecycle_status === 'suspended';

    return (
      <div data-testid="tenant-detail-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Top Header Card */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            padding: '20px 24px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  background: '#3B82F6',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  fontWeight: 800,
                }}
              >
                {detail.display_name.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0F172A' }}>
                    {detail.display_name}
                  </h2>
                  <span
                    data-testid="tenant-detail-status-pill"
                    style={{
                      padding: '3px 10px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: isSuspended ? '#FEE2E2' : '#DCFCE7',
                      color: isSuspended ? '#991B1B' : '#166534',
                      border: `1px solid ${isSuspended ? '#FCA5A5' : '#86EFAC'}`,
                    }}
                  >
                    {isSuspended ? '⛔ Приостановлена' : '✅ Активна'}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                  Поддомен: <b>{detail.slug}.book.example.kz</b> · Ниша:{' '}
                  <b>{detail.vertical}</b> · Регистрация:{' '}
                  {new Date(detail.created_at).toLocaleDateString('ru-RU')}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => {
                  setActiveTenantId(null);
                  onClearSelectedTenant();
                }}
                data-testid="tenant-back-to-list-btn"
                style={{
                  padding: '8px 14px',
                  background: '#F1F5F9',
                  color: '#475569',
                  border: '1px solid #CBD5E1',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                ← К списку
              </button>

              {canSuspend && (
                <>
                  {!isSuspended ? (
                    <button
                      onClick={() => {
                        setModalReason('');
                        setShowSuspendModal(true);
                      }}
                      data-testid="tenant-suspend-open-modal-btn"
                      style={{
                        padding: '8px 14px',
                        background: '#DC2626',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Приостановить компанию
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setModalReason('');
                        setShowReactivateModal(true);
                      }}
                      data-testid="tenant-reactivate-open-modal-btn"
                      style={{
                        padding: '8px 14px',
                        background: '#16A34A',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Восстановить доступ
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Suspended Reason Banner */}
          {isSuspended && detail.suspension_reason && (
            <div
              data-testid="tenant-suspended-banner"
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#991B1B',
              }}
            >
              <b>Причина приостановки:</b> {detail.suspension_reason} · Дата:{' '}
              {detail.suspended_at ? new Date(detail.suspended_at).toLocaleString('ru-RU') : '—'}
            </div>
          )}

          {/* 7 Tabs Bar */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              borderBottom: '1px solid #E2E8F0',
              marginTop: '20px',
              overflowX: 'auto',
            }}
          >
            {[
              { id: 'overview', label: '1. Обзор' },
              { id: 'subscription', label: '2. Подписка' },
              { id: 'entitlements', label: '3. Модули и лимиты' },
              { id: 'users', label: '4. Доступы' },
              { id: 'domains', label: '5. Адреса и домены' },
              { id: 'activity', label: '6. Активность' },
              { id: 'support', label: '7. Поддержка' },
            ].map(tab => (
              <button
                key={tab.id}
                data-testid={`tenant-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid #2563EB' : '2px solid transparent',
                  color: activeTab === tab.id ? '#2563EB' : '#64748B',
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: '12px',
                padding: '20px',
                border: '1px solid #E2E8F0',
              }}
            >
              <b style={{ fontSize: '14px', color: '#0F172A' }}>Использование системы</b>
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#64748B' }}>Активных филиалов:</span>
                  <b>{detail.usage_aggregates.branches_count}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#64748B' }}>Сотрудников в графике:</span>
                  <b>{detail.usage_aggregates.staff_count}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#64748B' }}>Всего записей клиентов:</span>
                  <b>{detail.usage_aggregates.total_bookings_count}</b>
                </div>
              </div>
            </div>

            <div
              style={{
                background: '#FFFFFF',
                borderRadius: '12px',
                padding: '20px',
                border: '1px solid #E2E8F0',
              }}
            >
              <b style={{ fontSize: '14px', color: '#0F172A' }}>Параметры окружения</b>
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#64748B' }}>Изоляция данных:</span>
                  <span style={{ color: '#16A34A', fontWeight: 600 }}>PostgreSQL RLS strict</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#64748B' }}>Режим доступа:</span>
                  <b>{isSuspended ? 'Read-only (приостановлен)' : 'Полный доступ (чтение/запись)'}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#64748B' }}>Публичная запись:</span>
                  <b>{isSuspended ? '❌ Заблокирована' : '✅ Открыта'}</b>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SUBSCRIPTION */}
        {activeTab === 'subscription' && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #E2E8F0',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <b style={{ fontSize: '16px', color: '#0F172A' }}>Параметры подписки</b>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  История тарифа и ручное управление циклом жизни
                </div>
              </div>
              {userRole === 'platform_owner' && (
                <button
                  onClick={() => setShowChangePlanModal(true)}
                  data-testid="tenant-change-plan-btn"
                  style={{
                    padding: '8px 14px',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Сменить тариф
                </button>
              )}
            </div>

            {detail.subscription ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <div style={{ padding: '16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>Текущий тариф</div>
                  <b style={{ fontSize: '18px', color: '#0F172A', marginTop: '4px', display: 'block' }}>
                    {detail.subscription.plan_name} ({detail.subscription.plan_code.toUpperCase()})
                  </b>
                  <div style={{ fontSize: '13px', color: '#2563EB', marginTop: '4px' }}>
                    {(detail.subscription.price_minor / 100).toLocaleString('ru-RU')} ₸ / мес.
                  </div>
                </div>

                <div style={{ padding: '16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>Статус подписки</div>
                  <b style={{ fontSize: '18px', color: '#0F172A', marginTop: '4px', display: 'block' }}>
                    {detail.subscription.status.toUpperCase()}
                  </b>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                    Режим: {detail.subscription.renewal_mode}
                  </div>
                </div>

                <div style={{ padding: '16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>Окончание периода</div>
                  <b style={{ fontSize: '18px', color: '#0F172A', marginTop: '4px', display: 'block' }}>
                    {new Date(detail.subscription.period_end).toLocaleDateString('ru-RU')}
                  </b>
                  {detail.subscription.grace_ends_at && (
                    <div style={{ fontSize: '12px', color: '#D97706', marginTop: '4px' }}>
                      Льготный до: {new Date(detail.subscription.grace_ends_at).toLocaleDateString('ru-RU')}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ color: '#94A3B8' }}>У компании нет активной записи подписки.</div>
            )}
          </div>
        )}

        {/* TAB 3: ENTITLEMENTS & LIMITS */}
        {activeTab === 'entitlements' && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #E2E8F0',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <b style={{ fontSize: '16px', color: '#0F172A' }}>Модули и лимиты тарифа</b>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  Базовые лимиты по тарифу и временные исключения с фиксацией обоснования
                </div>
              </div>
              {canModifyModules && (
                <button
                  onClick={() => setShowOverrideModal(true)}
                  data-testid="add-override-open-modal-btn"
                  style={{
                    padding: '8px 14px',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Добавить исключение
                </button>
              )}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Функция / Лимит</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>По тарифу</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Исключение</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Причина и срок</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Итоговое значение</th>
                </tr>
              </thead>
              <tbody>
                {entitlementsData.map(ent => (
                  <tr key={ent.feature_key} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '12px', fontWeight: 600, color: '#0F172A' }}>
                      {ent.feature_key === 'max_branches'
                        ? 'Количество филиалов'
                        : ent.feature_key === 'max_active_staff'
                        ? 'Количество мастеров'
                        : ent.feature_key === 'online_booking'
                        ? 'Онлайн-запись клиентов'
                        : ent.feature_key === 'basic_reports'
                        ? 'Базовые отчёты'
                        : ent.feature_key === 'loyalty_program'
                        ? 'Программа лояльности'
                        : ent.feature_key}
                    </td>
                    <td style={{ padding: '12px', color: '#475569' }}>
                      {ent.plan_value !== null ? ent.plan_value : ent.plan_enabled ? 'Включено' : 'Выключено'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {ent.is_overridden ? (
                        <span
                          style={{
                            padding: '2px 8px',
                            background: '#FEF3C7',
                            color: '#92400E',
                            borderRadius: '10px',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          Исключение: {ent.override_value}
                        </span>
                      ) : (
                        <span style={{ color: '#94A3B8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px', fontSize: '12px', color: '#475569' }}>
                      {ent.is_overridden ? (
                        <div>
                          <b>{ent.override_reason}</b>
                          <div style={{ color: '#94A3B8' }}>
                            Истекает: {ent.override_expires_at ? new Date(ent.override_expires_at).toLocaleDateString('ru-RU') : '—'}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 700, color: '#2563EB' }}>
                      {ent.effective_value !== null ? ent.effective_value : ent.plan_enabled ? 'Да' : 'Нет'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: USERS & ACCESS */}
        {activeTab === 'users' && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #E2E8F0',
            }}
          >
            <b style={{ fontSize: '16px', color: '#0F172A', display: 'block', marginBottom: '16px' }}>
              Сотрудники компании и приглашения
            </b>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
                Пользователи с активным доступом:
              </div>
              {usersError && (
                <div data-testid="users-load-error" style={{ padding: '12px', background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: '8px', marginBottom: '14px', fontSize: '13px' }}>
                  {usersError}
                  <button onClick={() => loadTenantDetail(activeTenantId!)} style={{ marginLeft: '12px', padding: '4px 10px', background: '#EF4444', color: '#FFF', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    Повторить
                  </button>
                </div>
              )}
              <table data-testid="tenant-members-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>
                    <th style={{ padding: '8px 12px' }}>ФИО</th>
                    <th style={{ padding: '8px 12px' }}>Email</th>
                    <th style={{ padding: '8px 12px' }}>Роль в CRM</th>
                    <th style={{ padding: '8px 12px' }}>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {usersData?.members.map(m => (
                    <tr key={m.membership_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{m.display_name}</td>
                      <td style={{ padding: '10px 12px', color: '#475569' }}>{m.email}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '2px 8px', background: '#F1F5F9', borderRadius: '4px', fontSize: '12px' }}>
                          {m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Администратор' : 'Мастер'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: m.status === 'active' ? '#16A34A' : '#D97706' }}>
                        {m.status === 'active' ? 'Активен' : 'Приглашён'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
                Ожидающие приглашения:
              </div>
              {usersData?.invites.length === 0 ? (
                <div style={{ color: '#94A3B8', fontSize: '13px' }}>Нет активных ожидающих приглашений.</div>
              ) : (
                <table data-testid="tenant-invites-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>
                      <th style={{ padding: '8px 12px' }}>Email</th>
                      <th style={{ padding: '8px 12px' }}>Роль</th>
                      <th style={{ padding: '8px 12px' }}>Срок действия</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersData?.invites.map(inv => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{inv.email}</td>
                        <td style={{ padding: '10px 12px' }}>{inv.role}</td>
                        <td style={{ padding: '10px 12px', color: '#64748B' }}>
                          до {inv.expires_at ? new Date(inv.expires_at).toLocaleString('ru-RU') : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleResendInvite(inv.email)}
                            data-testid={`resend-invite-btn-${inv.email}`}
                            style={{
                              padding: '5px 10px',
                              background: '#2563EB',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            Повторить приглашение
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: DOMAINS */}
        {activeTab === 'domains' && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #E2E8F0',
            }}
          >
            <b style={{ fontSize: '16px', color: '#0F172A', display: 'block', marginBottom: '16px' }}>
              Подключенные домены и маршрутизация
            </b>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {detail.domains.map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px',
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <b style={{ fontSize: '14px', color: '#0F172A' }}>{d.hostname}</b>
                      {d.canonical && (
                        <span style={{ fontSize: '10px', background: '#DBEAFE', color: '#1D4ED8', padding: '2px 6px', borderRadius: '4px' }}>
                          Канонический
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                      Тип: {d.domain_type} · Статус: {d.status}
                    </div>
                  </div>
                  <span style={{ color: '#16A34A', fontWeight: 600, fontSize: '13px' }}>
                    🔒 SSL активен / Маршрутизируется
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 6: ACTIVITY TIMELINE */}
        {activeTab === 'activity' && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #E2E8F0',
            }}
          >
            <b style={{ fontSize: '16px', color: '#0F172A', display: 'block', marginBottom: '16px' }}>
              Журнал событий компании (Audit Trail)
            </b>
            {activityData.length === 0 ? (
              <div style={{ color: '#94A3B8', fontSize: '13px' }}>Нет зарегистрированных событий аудита для этой компании.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activityData.map(ev => (
                  <div
                    key={ev.id}
                    style={{
                      padding: '12px 16px',
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <b style={{ color: '#0F172A' }}>{ev.action}</b>
                      <span style={{ color: '#94A3B8', fontSize: '12px' }}>
                        {new Date(ev.occurred_at).toLocaleString('ru-RU')}
                      </span>
                    </div>
                    <div style={{ color: '#475569' }}>
                      Оператор: <b>{ev.actor_email || 'система'}</b>
                      {ev.reason && (
                        <span>
                          {' '}
                          · Причина: <i>«{ev.reason}»</i>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 7: SUPPORT */}
        {activeTab === 'support' && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #E2E8F0',
            }}
          >
            <b style={{ fontSize: '16px', color: '#0F172A', display: 'block', marginBottom: '16px' }}>
              Сервис и техническая поддержка компании
            </b>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              <button
                onClick={() => onNavigateToSupport(detail.id)}
                data-testid="tenant-open-support-tickets-btn"
                style={{
                  padding: '10px 18px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Открыть тикеты поддержки компании →
              </button>
            </div>
          </div>
        )}

        {/* MODAL: SUSPEND TENANT */}
        {showSuspendModal && (
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
              data-testid="suspend-tenant-modal"
              style={{
                background: '#FFFFFF',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '480px',
                width: '100%',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              }}
            >
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#991B1B' }}>
                Приостановить компанию {detail.display_name}?
              </h3>
              <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.4, margin: '0 0 16px 0' }}>
                Публичный букинг будет заблокирован, Business CRM перейдёт в режим только для чтения. Исторические данные сохраняются.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Обязательная причина приостановки:
                </label>
                <textarea
                  value={modalReason}
                  onChange={e => setModalReason(e.target.value)}
                  placeholder="Например: неоплата подписки более 14 дней, запрос владельца..."
                  rows={3}
                  required
                  data-testid="suspend-reason-input"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowSuspendModal(false)}
                  style={{
                    padding: '8px 14px',
                    background: '#F1F5F9',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSuspendTenant}
                  disabled={isSubmitting || !modalReason.trim()}
                  data-testid="confirm-suspend-tenant-btn"
                  style={{
                    padding: '8px 16px',
                    background: '#DC2626',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    cursor: isSubmitting || !modalReason.trim() ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    opacity: isSubmitting || !modalReason.trim() ? 0.6 : 1,
                  }}
                >
                  {isSubmitting ? 'Приостановка...' : 'Подтвердить приостановку'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: REACTIVATE TENANT */}
        {showReactivateModal && (
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
              data-testid="reactivate-tenant-modal"
              style={{
                background: '#FFFFFF',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '480px',
                width: '100%',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              }}
            >
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#166534' }}>
                Восстановить доступ для {detail.display_name}?
              </h3>
              <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.4, margin: '0 0 16px 0' }}>
                Публичная запись и полный доступ к CRM будут снова активированы.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Обязательная причина восстановления доступа:
                </label>
                <textarea
                  value={modalReason}
                  onChange={e => setModalReason(e.target.value)}
                  placeholder="Например: подтверждена оплата счёта № 214..."
                  rows={3}
                  required
                  data-testid="reactivate-reason-input"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowReactivateModal(false)}
                  style={{
                    padding: '8px 14px',
                    background: '#F1F5F9',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleReactivateTenant}
                  disabled={isSubmitting || !modalReason.trim()}
                  data-testid="confirm-reactivate-tenant-btn"
                  style={{
                    padding: '8px 16px',
                    background: '#16A34A',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    cursor: isSubmitting || !modalReason.trim() ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    opacity: isSubmitting || !modalReason.trim() ? 0.6 : 1,
                  }}
                >
                  {isSubmitting ? 'Восстановление...' : 'Восстановить доступ'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: CHANGE PLAN */}
        {showChangePlanModal && (
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
              style={{
                background: '#FFFFFF',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '460px',
                width: '100%',
              }}
            >
              <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', color: '#0F172A' }}>Смена тарифа компании</h3>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Выберите новый тариф:
                </label>
                <select
                  value={newPlanCode}
                  onChange={e => setNewPlanCode(e.target.value)}
                  data-testid="select-new-plan"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                >
                  <option value="start">Start (1 филиал, 5 мастеров) — 9 900 ₸</option>
                  <option value="pro">Pro (3 филиала, 15 мастеров) — 19 000 ₸</option>
                  <option value="business">Business (10 филиалов, 50 мастеров) — 39 000 ₸</option>
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Обоснование смены тарифа:
                </label>
                <textarea
                  value={modalReason}
                  onChange={e => setModalReason(e.target.value)}
                  placeholder="Причина перехода на другой тариф..."
                  rows={2}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowChangePlanModal(false)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleChangePlan}
                  disabled={isSubmitting}
                  data-testid="confirm-change-plan-btn"
                  style={{ padding: '8px 16px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: ADD ENTITLEMENT OVERRIDE */}
        {showOverrideModal && (
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
              data-testid="add-override-modal"
              style={{
                background: '#FFFFFF',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '480px',
                width: '100%',
              }}
            >
              <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', color: '#0F172A' }}>
                Добавить исключение лимита (Override)
              </h3>
              <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 16px 0' }}>
                Временное расширение квоты для компании с обязательной фиксацией причины в журнале аудита.
              </p>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Функция / Лимит:
                </label>
                <select
                  value={overrideKey}
                  onChange={e => setOverrideKey(e.target.value)}
                  data-testid="override-feature-select"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                >
                  <option value="max_branches">Количество филиалов (max_branches)</option>
                  <option value="max_active_staff">Количество сотрудников (max_active_staff)</option>
                  <option value="custom_domain">Свой домен компании (custom_domain)</option>
                  <option value="loyalty_program">Программа лояльности (loyalty_program)</option>
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Новое значение лимита:
                </label>
                <input
                  type="number"
                  min={1}
                  value={overrideValue}
                  onChange={e => setOverrideValue(Number(e.target.value))}
                  data-testid="override-value-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Срок действия (дней):
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={overrideDays}
                  onChange={e => setOverrideDays(Number(e.target.value))}
                  data-testid="override-days-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Обязательная причина исключения:
                </label>
                <textarea
                  value={overrideReason}
                  onChange={e => setOverrideReason(e.target.value)}
                  placeholder="Например: открытие второго филиала на время ремонта первого по заявке #902"
                  rows={3}
                  required
                  data-testid="override-reason-input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSaveOverride}
                  disabled={isSubmitting || !overrideReason.trim()}
                  data-testid="confirm-save-override-btn"
                  style={{ padding: '8px 16px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {isSubmitting ? 'Сохранение...' : 'Применить исключение'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // RENDER: COMPANIES REPERTOIRE LIST VIEW
  // =========================================================================
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* FILTER & TOP ACTION BAR */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          padding: '16px 20px',
          border: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadTenants()}
              placeholder="Поиск по названию или slug компании..."
              data-testid="tenants-search-input"
              style={{
                width: '100%',
                padding: '9px 14px',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={loadTenants}
              data-testid="tenants-search-btn"
              style={{
                padding: '9px 16px',
                background: '#F1F5F9',
                color: '#1E293B',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Найти
            </button>

            {canCreateCompany && (
              <button
                onClick={() => {
                  resetWizard();
                  setShowWizard(true);
                }}
                data-testid="new-tenant-open-wizard-btn"
                style={{
                  padding: '9px 18px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>+</span> Новая компания
              </button>
            )}
          </div>
        </div>

        {/* 4 Multi-Select Filters */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <select
            value={verticalFilter}
            onChange={e => setVerticalFilter(e.target.value)}
            data-testid="filter-vertical"
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', background: '#FFFFFF' }}
          >
            <option value="">Все ниши</option>
            <option value="barbershop">Барбершопы</option>
            <option value="beauty_salon">Салоны красоты</option>
            <option value="dentistry">Стоматологии</option>
          </select>

          <select
            value={planFilter}
            onChange={e => setPlanFilter(e.target.value)}
            data-testid="filter-plan"
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', background: '#FFFFFF' }}
          >
            <option value="">Все тарифы</option>
            <option value="start">Тариф Start</option>
            <option value="pro">Тариф Pro</option>
            <option value="business">Тариф Business</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            data-testid="filter-status"
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', background: '#FFFFFF' }}
          >
            <option value="">Все статусы</option>
            <option value="active">Только активные</option>
            <option value="suspended">Только приостановленные</option>
          </select>

          <select
            value={paymentFilter}
            onChange={e => setPaymentFilter(e.target.value)}
            data-testid="filter-payment"
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', background: '#FFFFFF' }}
          >
            <option value="">Все статусы оплаты</option>
            <option value="paid">Оплачен</option>
            <option value="unpaid">Ожидает оплаты</option>
          </select>
        </div>
      </div>

      {/* REPERTOIRE TABLE */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          border: '1px solid #E2E8F0',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            data-testid="tenants-table"
            style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Компания</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Ниша</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Тариф</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Статус компании</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Подписка</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Оплата</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingList ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>
                    Загрузка списка компаний...
                  </td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>
                    Компании не найдены по заданным критериям фильтра.
                  </td>
                </tr>
              ) : (
                tenants.map(t => (
                  <tr
                    key={t.id}
                    data-testid={`tenant-row-${t.slug}`}
                    style={{ borderBottom: '1px solid #F1F5F9', transition: 'background 0.15s ease' }}
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            background: '#EFF6FF',
                            color: '#1D4ED8',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '13px',
                          }}
                        >
                          {t.display_name.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <b style={{ color: '#0F172A', display: 'block' }}>{t.display_name}</b>
                          <span style={{ fontSize: '11px', color: '#94A3B8' }}>{t.slug}.book.example.kz</span>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#475569' }}>
                      {t.vertical === 'barbershop'
                        ? 'Барбершоп'
                        : t.vertical === 'beauty_salon'
                        ? 'Салон красоты'
                        : t.vertical === 'dentistry'
                        ? 'Стоматология'
                        : t.vertical}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          background: '#F1F5F9',
                          color: '#334155',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        {t.subscription?.plan_name || 'Start'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: t.lifecycle_status === 'active' ? '#DCFCE7' : '#FEE2E2',
                          color: t.lifecycle_status === 'active' ? '#166534' : '#991B1B',
                        }}
                      >
                        {t.lifecycle_status === 'active' ? 'Активна' : 'Приостановлена'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#475569', fontSize: '12px' }}>
                      {t.subscription ? (
                        <div>
                          <b style={{ textTransform: 'uppercase' }}>{t.subscription.status}</b>
                          <div style={{ color: '#94A3B8' }}>
                            до {new Date(t.subscription.period_end).toLocaleDateString('ru-RU')}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: t.payment_status === 'paid' ? '#DCFCE7' : '#FEF3C7',
                          color: t.payment_status === 'paid' ? '#166534' : '#92400E',
                        }}
                      >
                        {t.payment_status === 'paid' ? 'Оплачен' : 'Ожидает'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => setActiveTenantId(t.id)}
                        data-testid={`open-tenant-detail-${t.slug}`}
                        style={{
                          padding: '6px 12px',
                          background: '#F1F5F9',
                          color: '#2563EB',
                          border: '1px solid #CBD5E1',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Карточка →
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4-STEP ONBOARDING WIZARD MODAL */}
      {showWizard && (
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
            data-testid="onboarding-wizard-modal"
            style={{
              background: '#FFFFFF',
              borderRadius: '14px',
              padding: '28px',
              maxWidth: '540px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            {/* Steps indicator */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
              {[
                { s: 1, label: 'Данные' },
                { s: 2, label: 'Тариф' },
                { s: 3, label: 'Владелец' },
                { s: 4, label: 'Готово' },
              ].map(st => (
                <div key={st.s} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: wizardStep >= st.s ? '#2563EB' : '#E2E8F0',
                      color: wizardStep >= st.s ? '#FFFFFF' : '#64748B',
                      fontSize: '12px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {st.s}
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: wizardStep === st.s ? 700 : 500, color: '#334155' }}>
                    {st.label}
                  </span>
                </div>
              ))}
            </div>

            {/* STEP 1: COMPANY DATA */}
            {wizardStep === 1 && (
              <div>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0F172A' }}>
                  Шаг 1. Данные новой компании
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      Название компании:
                    </label>
                    <input
                      type="text"
                      value={wizName}
                      onChange={e => {
                        setWizName(e.target.value);
                        if (!wizSlug) {
                          setWizSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''));
                        }
                      }}
                      placeholder="Например: Elite Barbershop"
                      data-testid="wizard-input-name"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      Системный поддомен (slug):
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={wizSlug}
                        onChange={e => setWizSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        placeholder="elitebarber"
                        data-testid="wizard-input-slug"
                        style={{ flex: 1, padding: '9px 12px', borderRadius: '6px 0 0 6px', border: '1px solid #CBD5E1', borderRight: 'none' }}
                      />
                      <span style={{ padding: '9px 12px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '0 6px 6px 0', color: '#64748B', fontSize: '13px' }}>
                        .book.example.kz
                      </span>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      Ниша бизнеса:
                    </label>
                    <select
                      value={wizVertical}
                      onChange={e => setWizVertical(e.target.value)}
                      data-testid="wizard-select-vertical"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                    >
                      <option value="barbershop">Барбершоп (мужские стрижки, уход)</option>
                      <option value="beauty_salon">Салон красоты (косметология, укладки)</option>
                      <option value="dentistry">Стоматологическая клиника</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
                  <button
                    type="button"
                    onClick={resetWizard}
                    style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!wizName.trim() || !wizSlug.trim()) {
                        showToast('Заполните название и поддомен');
                        return;
                      }
                      setWizardStep(2);
                    }}
                    data-testid="wizard-step1-next-btn"
                    style={{ padding: '8px 18px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Далее →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: PLAN SELECTION */}
            {wizardStep === 2 && (
              <div>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0F172A' }}>
                  Шаг 2. Выбор тарифа и пробного периода
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {[
                    { id: 'start', name: 'Start', price: '9 900 ₸', desc: '1 филиал, до 5 мастеров. Базовые отчёты и онлайн-запись.' },
                    { id: 'pro', name: 'Pro', price: '19 000 ₸', desc: 'До 3 филиалов, до 15 мастеров. Свой домен и приоритетная поддержка.' },
                    { id: 'business', name: 'Business', price: '39 000 ₸', desc: 'До 10 филиалов, до 50 мастеров. Неограниченный онлайн-букинг.' },
                  ].map(p => (
                    <div
                      key={p.id}
                      onClick={() => setWizPlan(p.id)}
                      data-testid={`wizard-plan-option-${p.id}`}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '8px',
                        border: `2px solid ${wizPlan === p.id ? '#2563EB' : '#E2E8F0'}`,
                        background: wizPlan === p.id ? '#EFF6FF' : '#FFFFFF',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <b style={{ color: '#0F172A' }}>{p.name}</b>
                        <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>{p.desc}</div>
                      </div>
                      <div style={{ fontWeight: 700, color: '#2563EB' }}>{p.price}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: '14px', padding: '10px 14px', background: '#F8FAFC', borderRadius: '6px', fontSize: '12px', color: '#475569' }}>
                  🎁 Новая компания получит <b>14 дней бесплатного пробного периода (Trial)</b> с момента регистрации.
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    ← Назад
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    data-testid="wizard-step2-next-btn"
                    style={{ padding: '8px 18px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Далее →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: OWNER DETAILS */}
            {wizardStep === 3 && (
              <div>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0F172A' }}>
                  Шаг 3. Владелец компании и приглашение
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      ФИО владельца:
                    </label>
                    <input
                      type="text"
                      value={wizOwnerName}
                      onChange={e => setWizOwnerName(e.target.value)}
                      placeholder="Олжас Ержанов"
                      data-testid="wizard-input-owner-name"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      Email владельца:
                    </label>
                    <input
                      type="email"
                      value={wizOwnerEmail}
                      onChange={e => setWizOwnerEmail(e.target.value)}
                      placeholder="owner@elitebarber.kz"
                      data-testid="wizard-input-owner-email"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ padding: '10px 14px', background: '#FFFBEB', borderRadius: '6px', fontSize: '12px', color: '#92400E' }}>
                    ℹ️ Владелец получит статус <b>invited</b> и одноразовую защищённую ссылку для активации аккаунта и установки пароля.
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    ← Назад
                  </button>
                  <button
                    type="button"
                    onClick={handleFinishWizard}
                    disabled={isSubmitting || !wizOwnerEmail.trim()}
                    data-testid="wizard-finish-btn"
                    style={{
                      padding: '8px 20px',
                      background: '#16A34A',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 600,
                      cursor: isSubmitting || !wizOwnerEmail.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSubmitting ? 'Создание...' : 'Завершить онбординг'}
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: SUCCESS & INVITE LINK */}
            {wizardStep === 4 && wizResult && (
              <div data-testid="wizard-step4-success">
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <div style={{ fontSize: '40px', marginBottom: '10px' }}>🎉</div>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', color: '#166534' }}>
                    Компания успешно создана!
                  </h3>
                  <p style={{ fontSize: '13px', color: '#475569', margin: 0 }}>
                    Арендатор зарегистрирован, поддомен настроен, 14-дневный триал активирован.
                  </p>
                </div>

                <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0', marginBottom: '20px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Одноразовая ссылка-приглашение владельца:
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      readOnly
                      value={wizResult.inviteUrl}
                      data-testid="wizard-invite-url-display"
                      style={{ flex: 1, padding: '8px 10px', fontSize: '12px', border: '1px solid #CBD5E1', borderRadius: '6px', background: '#FFFFFF' }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(wizResult.inviteUrl);
                        showToast('Ссылка скопирована!');
                      }}
                      data-testid="wizard-copy-invite-btn"
                      style={{ padding: '8px 12px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Копировать
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                  <button
                    type="button"
                    onClick={resetWizard}
                    style={{ padding: '10px 18px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                  >
                    Закрыть
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetWizard();
                      setActiveTenantId(wizResult.tenantId);
                    }}
                    data-testid="wizard-go-to-tenant-btn"
                    style={{ padding: '10px 20px', background: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Открыть карточку компании →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
