import React, { useState, useEffect, useCallback } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';
import { CrmMembership, CalendarStaff, CalendarBooking, CrmNavigationSection } from './types';
import { LoginPage } from './modules/auth/LoginPage';
import { CrmLayout } from './layouts/CrmLayout';
import { CalendarModule } from './modules/calendar/CalendarModule';
import { CustomersModule } from './modules/customers/CustomersModule';
import { StaffModule } from './modules/staff/StaffModule';
import { ServicesModule } from './modules/services/ServicesModule';
import { OnlineBookingModule } from './modules/online-booking/OnlineBookingModule';
import { ReportsModule } from './modules/reports/ReportsModule';
import { SettingsModule } from './modules/settings/SettingsModule';

export const App: React.FC = () => {
  const [api] = useState(() => new BusinessCrmApiClient());

  // Authentication State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('crm_token') || null);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [memberships, setMemberships] = useState<CrmMembership[]>([]);
  const [activeMembership, setActiveMembership] = useState<CrmMembership | null>(null);

  // Active Navigation
  const [currentSection, setCurrentSection] = useState<CrmNavigationSection>(() => {
    const hash = window.location.hash.replace('#', '') as CrmNavigationSection;
    if (['calendar', 'customers', 'staff', 'services', 'online-booking', 'reports', 'settings'].includes(hash)) {
      return hash;
    }
    const params = new URLSearchParams(window.location.search);
    const sec = params.get('section') as CrmNavigationSection;
    if (['calendar', 'customers', 'staff', 'services', 'online-booking', 'reports', 'settings'].includes(sec)) {
      return sec;
    }
    return 'calendar';
  });

  // Calendar State
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
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
      const hash = window.location.hash.replace('#', '') as CrmNavigationSection;
      if (['calendar', 'customers', 'staff', 'services', 'online-booking', 'reports', 'settings'].includes(hash)) {
        setCurrentSection(hash);
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
        }
      })
      .catch((err) => {
        console.error('Failed to load branches', err);
      });

    return () => {
      isMounted = false;
    };
  }, [token, activeMembership, api]);

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
        name: s.name,
        role_title: s.role_title,
        color: s.color || '#3B82F6',
      }));
      setStaffList(mappedStaff);

      const mappedBookings: CalendarBooking[] = (calData.bookings || []).map((b: any) => ({
        id: b.id,
        public_ref: b.public_ref,
        staff_id: b.staff_id,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        status: b.status,
        starts_at_utc: b.starts_at_utc,
        service_ends_at_utc: b.service_ends_at_utc,
        amount_minor: b.amount_minor,
        services: b.services || [],
      }));
      setBookings(mappedBookings);
    } catch (err: any) {
      console.error('Failed to load calendar data', err);
      showToast('Ошибка загрузки записей календаря');
    } finally {
      setIsLoading(false);
    }
  }, [api, token, activeMembership, currentDate, selectedBranchId]);

  useEffect(() => {
    if (token && activeMembership && currentSection === 'calendar') {
      loadCalendarData();
    }
  }, [token, activeMembership, currentSection, loadCalendarData]);

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

  // If not authenticated, render Login Page
  if (!token || !currentUser || !activeMembership) {
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
    reports: { title: 'Отчёты и аналитика', subtitle: 'Операционная выручка, занятость мастеров и статистика' },
    settings: { title: 'Настройки компании', subtitle: 'Филиалы, доступ пользователей и тарифная подписка' },
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
        {currentSection === 'calendar' && (
          <CalendarModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            branchId={selectedBranchId || ''}
            currentDate={currentDate}
            onDateChange={handleDateChange}
            staffList={staffList}
            bookings={bookings}
            isLoading={isLoading}
            onRefresh={loadCalendarData}
            onShowToast={showToast}
            userRole={activeMembership.role}
          />
        )}

        {currentSection === 'customers' && (
          <CustomersModule
            api={api}
            token={token}
            tenantId={activeMembership.tenant_id}
            onShowToast={showToast}
            userRole={activeMembership.role}
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
