import React, { useState, useEffect, useCallback } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';
import { CrmMembership, CalendarStaff, CalendarBooking, CalendarBlockItem, CrmNavigationSection } from './types';
import { LoginPage } from './modules/auth/LoginPage';
import { AcceptInvitePage } from './modules/auth/AcceptInvitePage';
import { CrmLayout } from './layouts/CrmLayout';
import { CalendarModule } from './modules/calendar/CalendarModule';
import { CustomersModule } from './modules/customers/CustomersModule';
import { StaffModule } from './modules/staff/StaffModule';
import { ServicesModule } from './modules/services/ServicesModule';
import { OnlineBookingModule } from './modules/online-booking/OnlineBookingModule';
import { CashModule } from './modules/cash/CashModule';
import { ReportsModule } from './modules/reports/ReportsModule';
import { SettingsModule } from './modules/settings/SettingsModule';
import { OnboardingModule } from './modules/onboarding/OnboardingModule';

export const App: React.FC = () => {
  const [api] = useState(() => new BusinessCrmApiClient());

  // Feature flag: Onboarding checklist (M02 requirement)
  const [featureOnboardingEnabled] = useState<boolean>(() => {
    return localStorage.getItem('feature_flag_onboarding') === 'true';
  });

  // Standalone Preview Mode ("Экран готовится отдельно")
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    return params.get('preview') === 'onboarding' || hash === '#preview-onboarding' || params.get('mode') === 'preview';
  });

  // Invite Token Detection from URL (Query, Hash or Path)
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    let tok = params.get('token') || params.get('invite_token');
    if (!tok && hash.includes('token=')) {
      const match = hash.match(/token=([^&]+)/);
      if (match) tok = match[1];
    }
    return tok || null;
  });

  // Authentication State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('crm_token') || null);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [memberships, setMemberships] = useState<CrmMembership[]>([]);
  const [activeMembership, setActiveMembership] = useState<CrmMembership | null>(null);

  // Active Navigation Section
  const [currentSection, setCurrentSection] = useState<CrmNavigationSection>(() => {
    const hash = window.location.hash.replace('#', '') as CrmNavigationSection;
    if (['calendar', 'customers', 'staff', 'services', 'online-booking', 'reports', 'settings', 'onboarding'].includes(hash)) {
      return hash;
    }
    const params = new URLSearchParams(window.location.search);
    const sec = params.get('section') as CrmNavigationSection;
    if (['calendar', 'customers', 'staff', 'services', 'online-booking', 'reports', 'settings', 'onboarding'].includes(sec)) {
      return sec;
    }
    return 'calendar';
  });

  // Business State
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<string>(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const dateParam = searchParams.get('date');
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return dateParam;
    }
    return new Date().toISOString().split('T')[0];
  });

  const [staffList, setStaffList] = useState<CalendarStaff[]>([]);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlockItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [targetCustomerId, setTargetCustomerId] = useState<string | null>(null);

  const handleOpenCustomer = (customerId: string) => {
    setTargetCustomerId(customerId);
    setCurrentSection('customers');
    window.location.hash = 'customers';
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Sync date changes to URL query param without full page reload
  const handleDateChange = (newDate: string) => {
    setCurrentDate(newDate);
    const url = new URL(window.location.href);
    url.searchParams.set('date', newDate);
    window.history.replaceState({}, '', url.toString());
  };

  const handleNavigate = (section: CrmNavigationSection) => {
    setCurrentSection(section);
    window.location.hash = section;
  };

  // Listen to hash change for browser back/forward navigation
  useEffect(() => {
    const onHashChange = () => {
      const rawHash = window.location.hash.replace('#', '');
      const validSections: string[] = ['calendar', 'customers', 'staff', 'services', 'online-booking', 'reports', 'settings', 'onboarding'];
      if (rawHash === 'preview-onboarding') {
        setIsPreviewMode(true);
      } else if (validSections.includes(rawHash)) {
        setCurrentSection(rawHash as CrmNavigationSection);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Load Current User and Active Memberships
  const loadUserContext = useCallback(async (authToken: string) => {
    try {
      setIsLoading(true);
      const me = await api.getMe(authToken);
      setCurrentUser(me);

      const mems: CrmMembership[] = me.crm_memberships || [];
      setMemberships(mems);

      if (mems.length > 0) {
        setActiveMembership((prev) => {
          if (prev && mems.some((m) => m.tenant_id === prev.tenant_id)) {
            return prev;
          }
          return mems[0];
        });
      } else {
        setActiveMembership(null);
      }
    } catch (err: any) {
      console.error('Failed to load user context', err);
      setToken(null);
      localStorage.removeItem('crm_token');
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (token) {
      loadUserContext(token);
    }
  }, [token, loadUserContext]);

  // Load Branches when tenant membership changes
  useEffect(() => {
    if (!token || !activeMembership) return;

    let isMounted = true;
    api
      .getBranches(token, activeMembership.tenant_id)
      .then((data) => {
        if (!isMounted) return;
        setBranches(data);
        if (data.length > 0) {
          setSelectedBranchId((prev) => {
            if (prev && data.some((b) => b.id === prev)) return prev;
            return data[0].id;
          });
        } else {
          // If company has NO branches yet and user is owner/admin -> auto-direct to Onboarding!
          if (featureOnboardingEnabled && (activeMembership.role === 'owner' || activeMembership.role === 'admin')) {
            setCurrentSection('onboarding');
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load branches', err);
      });

    return () => {
      isMounted = false;
    };
  }, [token, activeMembership, api, featureOnboardingEnabled]);

  // Load Calendar data (staff + bookings)
  const loadCalendarData = useCallback(async () => {
    const branchId = selectedBranchId || branches[0]?.id;
    if (!token || !activeMembership || !branchId) return;
    try {
      setIsLoading(true);
      const calData = await api.getCalendar(
        {
          date: currentDate,
          branch_id: branchId,
        },
        token,
        activeMembership.tenant_id
      );

      const mappedStaff: CalendarStaff[] = (calData.staff || []).map((s: any) => ({
        id: s.id,
        name: s.display_name || s.name || s.full_name || 'Специалист',
        role_title: s.role_title,
        color: s.color || '#3B82F6',
      }));
      setStaffList(mappedStaff);

      const mappedBookings: CalendarBooking[] = (calData.bookings || []).map((b: any) => ({
        id: b.id,
        public_ref: b.public_ref,
        staff_id: b.staff_id,
        customer_id: b.customer_id,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        status: b.status,
        starts_at_utc: b.starts_at_utc,
        service_ends_at_utc: b.service_ends_at_utc,
        amount_minor: b.amount_minor,
        cost_minor: b.cost_minor ?? b.amount_minor,
        rendered_minor: b.rendered_minor ?? (b.status === 'completed' ? b.amount_minor : 0),
        paid_minor: b.paid_minor ?? 0,
        debt_minor: b.debt_minor ?? (b.status === 'completed' ? b.amount_minor : 0),
        payment_status: b.payment_status ?? 'unpaid',
        finance: b.finance,
        services: b.services || [],
      }));
      setBookings(mappedBookings);

      const mappedBlocks: CalendarBlockItem[] = (calData.blocks || []).map((bl: any) => ({
        id: bl.id,
        staff_id: bl.staff_id,
        starts_at_utc: bl.starts_at_utc,
        ends_at_utc: bl.ends_at_utc,
        block_reason: bl.reason || bl.block_reason || 'Блокировка времени',
      }));
      setBlocks(mappedBlocks);
    } catch (err: any) {
      console.error('Failed to load calendar data', err);
      showToast('Ошибка загрузки записей календаря');
    } finally {
      setIsLoading(false);
    }
  }, [api, token, activeMembership, currentDate, selectedBranchId, branches]);

  useEffect(() => {
    if (token && activeMembership && currentSection === 'calendar' && branches.length > 0) {
      loadCalendarData();
    }
  }, [token, activeMembership, currentSection, loadCalendarData, branches.length]);

  // Auth Handlers
  const handleLoginSuccess = (authToken: string, mems: CrmMembership[], user: any) => {
    localStorage.setItem('crm_token', authToken);
    setToken(authToken);
    setCurrentUser(user);
    setMemberships(mems);
    if (mems.length > 0) {
      setActiveMembership(mems[0]);
    }
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('crm_token');
    setCurrentUser(null);
    setMemberships([]);
    setActiveMembership(null);
  };

  const handleBranchCreatedFromOnboarding = (newBranch: any) => {
    setBranches((prev) => {
      const exists = prev.some((b) => b.id === newBranch.id);
      if (exists) return prev;
      return [...prev, newBranch];
    });
    setSelectedBranchId(newBranch.id);
    showToast(`Филиал "${newBranch.name}" успешно создан!`);
  };

  // Standalone Preview Mode ("Экран готовится отдельно")
  if (isPreviewMode) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
        <header
          style={{
            height: '60px',
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#0F172A' }}>
            CRM · Предпросмотр Онбординга (Спринт M02)
          </div>
          <button
            type="button"
            onClick={() => setIsPreviewMode(false)}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ✕ Выйти из предпросмотра
          </button>
        </header>
        <OnboardingModule
          api={api}
          branches={branches}
          onBranchCreated={handleBranchCreatedFromOnboarding}
          onNavigate={(sec) => {
            if (sec === 'calendar') {
              showToast('Переход в календарь записей (в боевом режиме)');
            } else {
              showToast(`Переход в раздел ${sec}`);
            }
          }}
          onShowToast={showToast}
          isStandalonePreview={true}
        />
      </div>
    );
  }

  // If not authenticated, render AcceptInvitePage or LoginPage
  if (!token || !currentUser || !activeMembership) {
    if (inviteToken) {
      return (
        <AcceptInvitePage
          api={api}
          token={inviteToken}
          onSuccess={(authToken, mems, user) => {
            setInviteToken(null);
            // Clear token from URL query params
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
            handleLoginSuccess(authToken, mems, user);
          }}
          onGoToLogin={() => {
            setInviteToken(null);
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
          }}
        />
      );
    }
    return (
      <LoginPage
        api={api}
        onSuccess={handleLoginSuccess}
      />
    );
  }

  // Section title mapping
  const sectionTitles: Record<CrmNavigationSection, { title: string; subtitle: string }> = {
    calendar: { title: 'Календарь записей', subtitle: 'Журнал бронирований и расписание специалистов' },
    customers: { title: 'Клиентская база', subtitle: 'Профили клиентов, история визитов и заметки' },
    staff: { title: 'Сотрудники и график', subtitle: 'Управление командой, рабочими сменами и ставками' },
    services: { title: 'Услуги и цены', subtitle: 'Категории, прайс-лист и доступность для онлайн-записи' },
    'online-booking': { title: 'Настройки онлайн-записи', subtitle: 'Правила бронирования, дизайн виджета и публикация' },
    cash: { title: 'Касса и смены', subtitle: 'Кассовые смены, приём наличных, авансы и Z-отчёты' },
    reports: { title: 'Отчёты и аналитика', subtitle: 'Операционная выручка, занятость мастеров и статистика' },
    settings: { title: 'Настройки бизнеса', subtitle: 'Филиалы, доступ пользователей и тарифная подписка' },
    onboarding: { title: 'Онбординг-чеклист', subtitle: 'Пошаговая подготовка компании к приёму клиентов' },
  };

  const activeTitle = sectionTitles[currentSection] || sectionTitles.calendar;

  return (
    <>
      <CrmLayout
        membership={activeMembership}
        memberships={memberships}
        onSelectMembership={setActiveMembership}
        currentSection={currentSection}
        onNavigate={handleNavigate}
        currentUser={currentUser}
        onLogout={handleLogout}
        branches={branches}
        selectedBranchId={selectedBranchId}
        onSelectBranch={setSelectedBranchId}
        title={activeTitle.title}
        subtitle={activeTitle.subtitle}
      >
        {currentSection === 'onboarding' && (
          <OnboardingModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            tenantSlug={activeMembership.tenant_slug}
            tenantName={activeMembership.tenant_name}
            membership={activeMembership}
            branches={branches}
            onBranchCreated={handleBranchCreatedFromOnboarding}
            onNavigate={handleNavigate}
            onShowToast={showToast}
            isStandalonePreview={false}
          />
        )}

        {currentSection === 'calendar' && (() => {
          if (branches.length === 0) {
            return (
              <div
                data-testid="no-branches-empty-state"
                style={{
                  padding: '48px 24px',
                  textAlign: 'center',
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  border: '1px solid #E2E8F0',
                  margin: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '36px' }}>📍</div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#0F172A' }}>
                  У вас пока не создано ни одного филиала
                </h3>
                <p style={{ margin: 0, color: '#64748B', fontSize: '14px', maxWidth: '400px' }}>
                  Для отображения календаря и записи клиентов создайте ваш первый рабочий филиал в онбординге.
                </p>
                <button
                  type="button"
                  data-testid="empty-calendar-goto-onboarding-btn"
                  onClick={() => handleNavigate('onboarding')}
                  style={{
                    marginTop: '8px',
                    padding: '10px 20px',
                    borderRadius: '10px',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🚀 Открыть онбординг-чеклист
                </button>
              </div>
            );
          }

          const activeBranch = branches.find(b => b.id === (selectedBranchId || branches[0]?.id)) || branches[0];
          const activeTimezone = activeBranch?.timezone_iana || activeBranch?.timezone || 'Asia/Almaty';
          return (
            <CalendarModule
              api={api}
              token={token}
              tenantId={activeMembership.tenant_id}
              branchId={selectedBranchId || branches[0]?.id || ''}
              currentDate={currentDate}
              onDateChange={handleDateChange}
              staffList={staffList}
              bookings={bookings}
              blocks={blocks}
              isLoading={isLoading}
              onRefresh={loadCalendarData}
              onShowToast={showToast}
              userRole={activeMembership.role}
              timezoneIana={activeTimezone}
              onOpenCustomer={handleOpenCustomer}
            />
          );
        })()}

        {currentSection === 'customers' && (
          <CustomersModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            onShowToast={showToast}
            userRole={activeMembership.role}
            initialCustomerId={targetCustomerId}
            onClearTargetCustomer={() => setTargetCustomerId(null)}
          />
        )}

        {currentSection === 'staff' && (
          <StaffModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            branches={branches}
            onShowToast={showToast}
            userRole={activeMembership.role}
          />
        )}

        {currentSection === 'services' && (
          <ServicesModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            onShowToast={showToast}
            userRole={activeMembership.role}
            branches={branches}
            selectedBranchId={selectedBranchId}
          />
        )}

        {currentSection === 'online-booking' && (
          <OnlineBookingModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            onShowToast={showToast}
            userRole={activeMembership.role}
          />
        )}

        {currentSection === 'cash' && (
          <CashModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            branchId={selectedBranchId || (branches[0]?.id || '')}
            userRole={activeMembership.role}
            onShowToast={showToast}
          />
        )}

        {currentSection === 'reports' && (
          <ReportsModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            currentBranchId={selectedBranchId || undefined}
            userRole={activeMembership.role}
            onShowToast={showToast}
          />
        )}

        {currentSection === 'settings' && (
          <SettingsModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            tenantSlug={activeMembership.tenant_slug}
            userRole={activeMembership.role}
            onShowToast={showToast}
          />
        )}
      </CrmLayout>

      {/* Global Toast Notification */}
      {toastMessage && (
        <div
          data-testid="crm-toast"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            background: '#0F172A',
            color: '#FFFFFF',
            padding: '12px 20px',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: 500,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid #334155',
            animation: 'fadeIn 0.2s ease-out',
            pointerEvents: 'none',
          }}
        >
          <span>✓</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </>
  );
};
export default App;
