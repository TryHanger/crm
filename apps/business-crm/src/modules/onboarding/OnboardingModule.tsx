import React, { useState, useEffect } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';
import { CrmMembership, CrmNavigationSection } from '../../types';

interface OnboardingModuleProps {
  api?: BusinessCrmApiClient;
  token?: string | null;
  tenantId?: string;
  tenantSlug?: string;
  tenantName?: string;
  membership?: CrmMembership | null;
  branches: any[];
  onBranchCreated: (branch: any) => void;
  onNavigate: (section: CrmNavigationSection) => void;
  onShowToast: (message: string) => void;
  isStandalonePreview?: boolean;
}

export const OnboardingModule: React.FC<OnboardingModuleProps> = ({
  api,
  token,
  tenantId,
  tenantSlug,
  tenantName,
  membership,
  branches,
  onBranchCreated,
  onNavigate,
  onShowToast,
  isStandalonePreview = false,
}) => {
  // Branch form state
  const [branchName, setBranchName] = useState('');
  const [branchCity, setBranchCity] = useState('Астана');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('+7 (701) ');
  const [branchTimezone, setBranchTimezone] = useState('Asia/Almaty');
  const [isSubmittingBranch, setIsSubmittingBranch] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  // Quick service creation state (Step 2)
  const [showQuickService, setShowQuickService] = useState(false);
  const [serviceName, setServiceName] = useState('Стрижка классическая');
  const [servicePrice, setServicePrice] = useState('8000');
  const [serviceDuration, setServiceDuration] = useState('60');
  const [serviceCreated, setServiceCreated] = useState(false);
  const [isSubmittingService, setIsSubmittingService] = useState(false);

  // Quick staff state (Step 3)
  const [showQuickStaff, setShowQuickStaff] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState('Старший мастер');
  const [staffCreated, setStaffCreated] = useState(false);
  const [isSubmittingStaff, setIsSubmittingStaff] = useState(false);

  // Online booking state (Step 4)
  const [isBookingPublished, setIsBookingPublished] = useState(true);

  // Derived completion statuses
  const hasBranch = branches.length > 0;
  const isStep1Done = hasBranch;
  const isStep2Done = serviceCreated;
  const isStep3Done = staffCreated;
  const isStep4Done = isStep1Done && isBookingPublished;

  const completedStepsCount = [isStep1Done, isStep2Done, isStep3Done, isStep4Done].filter(Boolean).length;
  const progressPercent = Math.round((completedStepsCount / 4) * 100);

  const activeTenantName = tenantName || membership?.tenant_name || 'Ваш бизнес';
  const activeSlug = tenantSlug || membership?.tenant_slug || 'salon';
  const bookingUrl = `https://${activeSlug}.book.example.kz`;

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) {
      setBranchError('Укажите название первого филиала');
      return;
    }
    if (!branchAddress.trim()) {
      setBranchError('Укажите адрес филиала');
      return;
    }

    setBranchError(null);
    setIsSubmittingBranch(true);

    try {
      if (isStandalonePreview || !api || !token || !tenantId) {
        // Standalone preview mock
        const mockBranch = {
          id: `preview-branch-${Date.now()}`,
          name: branchName.trim(),
          city: branchCity,
          address: branchAddress.trim(),
          phone: branchPhone.trim(),
          timezone_iana: branchTimezone,
        };
        onBranchCreated(mockBranch);
        onShowToast('Первый филиал успешно создан (Режим предпросмотра)');
      } else {
        const payload = {
          name: branchName.trim(),
          city: branchCity.trim(),
          address: branchAddress.trim(),
          phone: branchPhone.trim(),
          timezone_iana: branchTimezone,
        };
        const created = await api.createBranch(payload, token, tenantId);
        onBranchCreated(created);
        onShowToast('Первый филиал успешно создан!');
      }
    } catch (err: any) {
      setBranchError(err?.message || 'Не удалось создать филиал. Проверьте соединение.');
    } finally {
      setIsSubmittingBranch(false);
    }
  };

  const handleCreateQuickService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceName.trim()) return;

    setIsSubmittingService(true);
    try {
      if (!isStandalonePreview && api && token && tenantId) {
        await api.createService(
          {
            name: serviceName.trim(),
            base_price_minor: Math.round(parseFloat(servicePrice || '0') * 100),
            base_duration_minutes: parseInt(serviceDuration || '60', 10),
            active: true,
            online_visible: true,
          },
          token,
          tenantId
        );
      }
      setServiceCreated(true);
      setShowQuickService(false);
      onShowToast(`Услуга "${serviceName}" успешно добавлена!`);
    } catch (err: any) {
      onShowToast(err?.message || 'Не удалось сохранить услугу');
    } finally {
      setIsSubmittingService(false);
    }
  };

  const handleCreateQuickStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = staffName.trim() || membership?.tenant_name || 'Мастер';
    setIsSubmittingStaff(true);
    try {
      if (!isStandalonePreview && api && token && tenantId) {
        await api.createStaff(
          {
            display_name: name,
            role_title: staffRole,
            branch_ids: branches.map(b => b.id),
          },
          token,
          tenantId
        );
      }
      setStaffCreated(true);
      setShowQuickStaff(false);
      onShowToast(`Специалист "${name}" добавлен!`);
    } catch (err: any) {
      onShowToast(err?.message || 'Не удалось сохранить сотрудника');
    } finally {
      setIsSubmittingStaff(false);
    }
  };

  return (
    <div
      data-testid="onboarding-module"
      style={{
        padding: '32px 24px',
        maxWidth: '960px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Standalone Preview Banner */}
      {isStandalonePreview && (
        <div
          data-testid="onboarding-preview-badge"
          style={{
            background: '#FEF3C7',
            color: '#92400E',
            padding: '10px 16px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: '1px solid #FCD34D',
          }}
        >
          <span>
            ℹ️ <strong>Режим предпросмотра экрана онбординга (M02).</strong> Вы можете интерактивно протестировать создание филиала и чеклист.
          </span>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Standalone</span>
        </div>
      )}

      {/* Hero Welcome Card */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
          borderRadius: '20px',
          padding: '32px',
          color: '#FFFFFF',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(59, 130, 246, 0.2)',
                color: '#93C5FD',
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '8px',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              <span>🚀 Первый вход владельца</span>
              <span>·</span>
              <span>Спринт M02</span>
            </div>
            <h1
              data-testid="onboarding-welcome-title"
              style={{ margin: 0, fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em' }}
            >
              Добро пожаловать в {activeTenantName}!
            </h1>
            <p style={{ margin: '6px 0 0', color: '#94A3B8', fontSize: '15px' }}>
              Подготовьте систему к работе за несколько минут. Начните с создания вашего первого филиала.
            </p>
          </div>

          <div
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '12px 16px',
              textAlign: 'right',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
          >
            <div style={{ fontSize: '12px', color: '#94A3B8' }}>Готовность бизнеса</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#38BDF8' }}>
              {progressPercent}%
            </div>
            <div style={{ fontSize: '11px', color: '#CBD5E1' }}>
              {completedStepsCount} из 4 шагов завершено
            </div>
          </div>
        </div>

        {/* Progress Track */}
        <div
          style={{
            height: '8px',
            background: 'rgba(255, 255, 255, 0.15)',
            borderRadius: '999px',
            overflow: 'hidden',
          }}
        >
          <div
            data-testid="onboarding-progress-bar"
            style={{
              height: '100%',
              width: `${Math.max(progressPercent, 5)}%`,
              background: 'linear-gradient(90deg, #38BDF8 0%, #2563EB 100%)',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Onboarding Steps Checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* STEP 1: First Branch Creation (Focus of M02) */}
        <div
          data-testid="onboarding-step-branch"
          style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            border: isStep1Done ? '1px solid #BBF7D0' : '2px solid #3B82F6',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: isStep1Done ? '#DCFCE7' : '#EFF6FF',
                  color: isStep1Done ? '#16A34A' : '#2563EB',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '16px',
                }}
              >
                {isStep1Done ? '✓' : '1'}
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#0F172A' }}>
                  Шаг 1: Создание первого филиала
                </h2>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748B' }}>
                  Точка обслуживания, расписание и привязка мастеров к локации
                </p>
              </div>
            </div>

            {isStep1Done ? (
              <span
                data-testid="step-branch-completed-badge"
                style={{
                  background: '#DCFCE7',
                  color: '#16A34A',
                  fontSize: '13px',
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: '999px',
                }}
              >
                ✓ Филиал создан
              </span>
            ) : (
              <span
                style={{
                  background: '#FEF3C7',
                  color: '#B45309',
                  fontSize: '13px',
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: '999px',
                }}
              >
                Требуется
              </span>
            )}
          </div>

          {/* If branch is already created */}
          {isStep1Done ? (
            <div
              style={{
                background: '#F8FAFC',
                borderRadius: '12px',
                padding: '16px',
                border: '1px solid #E2E8F0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px', color: '#0F172A' }}>
                  📍 {branches[0]?.name || 'Основной филиал'}
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  {branches[0]?.city ? `${branches[0].city}, ` : ''}{branches[0]?.address || 'Адрес не указан'}
                  {branches[0]?.phone ? ` · ${branches[0].phone}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#334155',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Управление филиалами ⚙️
              </button>
            </div>
          ) : (
            /* First branch creation form */
            <form onSubmit={handleCreateBranch} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {branchError && (
                <div
                  role="alert"
                  data-testid="onboarding-branch-error"
                  style={{
                    background: '#FEE2E2',
                    color: '#991B1B',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    border: '1px solid #FCA5A5',
                  }}
                >
                  {branchError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                    Название филиала *
                  </label>
                  <input
                    type="text"
                    required
                    value={branchName}
                    onChange={e => setBranchName(e.target.value)}
                    placeholder="Например: Флагманский филиал на Достык"
                    data-testid="onboarding-branch-name-input"
                    style={{
                      height: '40px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                    Город
                  </label>
                  <input
                    type="text"
                    value={branchCity}
                    onChange={e => setBranchCity(e.target.value)}
                    placeholder="Астана"
                    data-testid="onboarding-branch-city-input"
                    style={{
                      height: '40px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                    Адрес филиала *
                  </label>
                  <input
                    type="text"
                    required
                    value={branchAddress}
                    onChange={e => setBranchAddress(e.target.value)}
                    placeholder="пр. Достык, 42, 1 этаж"
                    data-testid="onboarding-branch-address-input"
                    style={{
                      height: '40px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                    Контактный телефон
                  </label>
                  <input
                    type="text"
                    value={branchPhone}
                    onChange={e => setBranchPhone(e.target.value)}
                    placeholder="+7 (701) 000-00-00"
                    data-testid="onboarding-branch-phone-input"
                    style={{
                      height: '40px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                  Часовой пояс
                </label>
                <select
                  value={branchTimezone}
                  onChange={e => setBranchTimezone(e.target.value)}
                  style={{
                    height: '40px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E1',
                    fontSize: '14px',
                    outline: 'none',
                    background: '#FFFFFF',
                  }}
                >
                  <option value="Asia/Almaty">Asia/Almaty (UTC+5)</option>
                  <option value="Asia/Qyzylorda">Asia/Qyzylorda (UTC+5)</option>
                  <option value="Asia/Aqtau">Asia/Aqtau (UTC+5)</option>
                  <option value="Asia/Tashkent">Asia/Tashkent (UTC+5)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button
                  type="submit"
                  disabled={isSubmittingBranch}
                  data-testid="onboarding-create-branch-btn"
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: isSubmittingBranch ? 'not-allowed' : 'pointer',
                    opacity: isSubmittingBranch ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  {isSubmittingBranch ? 'Создание филиала...' : '✓ Создать первый филиал'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* STEP 2: Services & Pricing (M04 preparation) */}
        <div
          data-testid="onboarding-step-services"
          style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            border: isStep2Done ? '1px solid #BBF7D0' : '1px solid #E2E8F0',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: isStep2Done ? '#DCFCE7' : '#F1F5F9',
                  color: isStep2Done ? '#16A34A' : '#64748B',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '16px',
                }}
              >
                {isStep2Done ? '✓' : '2'}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0F172A' }}>
                  Шаг 2: Услуги и прайс-лист
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748B' }}>
                  Добавьте хотя бы одну базовую услугу с ценой и длительностью
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {isStep2Done ? (
                <span
                  style={{
                    background: '#DCFCE7',
                    color: '#16A34A',
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: '999px',
                  }}
                >
                  ✓ Добавлено
                </span>
              ) : (
                <button
                  type="button"
                  data-testid="onboarding-quick-service-toggle"
                  onClick={() => setShowQuickService(!showQuickService)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#2563EB',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {showQuickService ? 'Скрыть форму' : '+ Быстро добавить услугу'}
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('services')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#F1F5F9',
                  color: '#475569',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Перейти в каталог →
              </button>
            </div>
          </div>

          {showQuickService && !isStep2Done && (
            <form onSubmit={handleCreateQuickService} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', background: '#F8FAFC', padding: '16px', borderRadius: '12px' }}>
              <div style={{ flex: 2, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', color: '#475569' }}>Название услуги</label>
                <input
                  type="text"
                  value={serviceName}
                  onChange={e => setServiceName(e.target.value)}
                  placeholder="Стрижка"
                  data-testid="onboarding-service-name-input"
                  style={{ height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: '100px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', color: '#475569' }}>Цена (₸)</label>
                <input
                  type="number"
                  value={servicePrice}
                  onChange={e => setServicePrice(e.target.value)}
                  placeholder="8000"
                  data-testid="onboarding-service-price-input"
                  style={{ height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: '90px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', color: '#475569' }}>Минут</label>
                <input
                  type="number"
                  value={serviceDuration}
                  onChange={e => setServiceDuration(e.target.value)}
                  placeholder="60"
                  style={{ height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                />
              </div>
              <button
                type="submit"
                disabled={isSubmittingService}
                data-testid="onboarding-submit-service-btn"
                style={{
                  height: '36px',
                  padding: '0 16px',
                  borderRadius: '6px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isSubmittingService ? 'Сохранение...' : 'Сохранить услугу'}
              </button>
            </form>
          )}
        </div>

        {/* STEP 3: Staff & Specialists (M05 preparation) */}
        <div
          data-testid="onboarding-step-staff"
          style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            border: isStep3Done ? '1px solid #BBF7D0' : '1px solid #E2E8F0',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: isStep3Done ? '#DCFCE7' : '#F1F5F9',
                  color: isStep3Done ? '#16A34A' : '#64748B',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '16px',
                }}
              >
                {isStep3Done ? '✓' : '3'}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0F172A' }}>
                  Шаг 3: Мастера и специалисты
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748B' }}>
                  Добавьте мастера для ведения расписания в календаре
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {isStep3Done ? (
                <span
                  style={{
                    background: '#DCFCE7',
                    color: '#16A34A',
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: '999px',
                  }}
                >
                  ✓ Мастер добавлен
                </span>
              ) : (
                <button
                  type="button"
                  data-testid="onboarding-quick-staff-toggle"
                  onClick={() => setShowQuickStaff(!showQuickStaff)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#2563EB',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {showQuickStaff ? 'Скрыть форму' : '+ Быстро добавить мастера'}
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('staff')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#F1F5F9',
                  color: '#475569',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Управление штатом →
              </button>
            </div>
          </div>

          {showQuickStaff && !isStep3Done && (
            <form onSubmit={handleCreateQuickStaff} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', background: '#F8FAFC', padding: '16px', borderRadius: '12px' }}>
              <div style={{ flex: 2, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', color: '#475569' }}>Имя специалиста</label>
                <input
                  type="text"
                  value={staffName}
                  onChange={e => setStaffName(e.target.value)}
                  placeholder="Руслан Ибрагимов"
                  data-testid="onboarding-staff-name-input"
                  style={{ height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: '140px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', color: '#475569' }}>Должность</label>
                <input
                  type="text"
                  value={staffRole}
                  onChange={e => setStaffRole(e.target.value)}
                  placeholder="Старший мастер"
                  style={{ height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #CBD5E1' }}
                />
              </div>
              <button
                type="submit"
                disabled={isSubmittingStaff}
                data-testid="onboarding-submit-staff-btn"
                style={{
                  height: '36px',
                  padding: '0 16px',
                  borderRadius: '6px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isSubmittingStaff ? 'Сохранение...' : 'Сохранить мастера'}
              </button>
            </form>
          )}
        </div>

        {/* STEP 4: Public Online Booking (M03 preparation) */}
        <div
          data-testid="onboarding-step-booking"
          style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            border: isStep4Done ? '1px solid #BBF7D0' : '1px solid #E2E8F0',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: isStep4Done ? '#DCFCE7' : '#F1F5F9',
                  color: isStep4Done ? '#16A34A' : '#64748B',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '16px',
                }}
              >
                {isStep4Done ? '✓' : '4'}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0F172A' }}>
                  Шаг 4: Онлайн-запись и витрина салона
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748B' }}>
                  Публичный адрес страницы записи ваших клиентов
                </p>
              </div>
            </div>

            <span
              style={{
                background: isBookingPublished ? '#DCFCE7' : '#FEF3C7',
                color: isBookingPublished ? '#16A34A' : '#B45309',
                fontSize: '12px',
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: '999px',
              }}
            >
              {isBookingPublished ? '● Онлайн-запись активна' : '○ Приостановлена'}
            </span>
          </div>

          <div
            style={{
              background: '#F8FAFC',
              borderRadius: '12px',
              padding: '14px 16px',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#64748B' }}>Публичный адрес для клиентов:</div>
              <a
                href={bookingUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#2563EB',
                  textDecoration: 'none',
                }}
              >
                {bookingUrl} ↗
              </a>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(bookingUrl);
                  onShowToast('Ссылка скопирована в буфер обмена!');
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#334155',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Копировать ссылку 📋
              </button>
              <button
                type="button"
                onClick={() => onNavigate('online-booking')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#F1F5F9',
                  color: '#475569',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Настроить виджет ⚙️
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Actions Bar */}
      <div
        style={{
          marginTop: '8px',
          padding: '20px',
          background: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: '15px', color: '#0F172A' }}>
            {hasBranch ? 'Первый филиал готов к приему клиентов' : 'Сделайте шаг 1: создайте филиал'}
          </div>
          <div style={{ fontSize: '13px', color: '#64748B' }}>
            Вы всегда можете вернуться к чеклисту из шапки системы.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            data-testid="onboarding-go-to-calendar-btn"
            onClick={() => onNavigate('calendar')}
            disabled={!hasBranch}
            style={{
              padding: '12px 24px',
              borderRadius: '10px',
              background: hasBranch ? '#2563EB' : '#94A3B8',
              color: '#FFFFFF',
              border: 'none',
              fontSize: '14px',
              fontWeight: 600,
              cursor: hasBranch ? 'pointer' : 'not-allowed',
              boxShadow: hasBranch ? '0 4px 12px rgba(37, 99, 235, 0.25)' : 'none',
              transition: 'background 0.2s ease',
            }}
          >
            Перейти в журнал записей 📅
          </button>
        </div>
      </div>
    </div>
  );
};
export default OnboardingModule;
