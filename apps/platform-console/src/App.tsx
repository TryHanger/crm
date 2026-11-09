import React, { useState, useEffect, useCallback } from 'react';
import { PlatformApiClient, PlatformActiveSessionResponse } from '@crm/api-client';
import { PlatformNavigationSection, PlatformUser } from './types';
import { PlatformLoginPage } from './modules/auth/PlatformLoginPage';
import { OperatorActivationPage } from './modules/auth/OperatorActivationPage';
import { PlatformLayout } from './layouts/PlatformLayout';
import { OverviewModule } from './modules/overview/OverviewModule';
import { CompaniesModule } from './modules/companies/CompaniesModule';
import { SubscriptionsModule } from './modules/subscriptions/SubscriptionsModule';
import { PlansModule } from './modules/plans/PlansModule';
import { ModulesCatalogModule } from './modules/modules/ModulesCatalogModule';
import { SupportModule } from './modules/support/SupportModule';
import { AuditModule } from './modules/audit/AuditModule';
import { PlatformSettingsModule } from './modules/settings/PlatformSettingsModule';

export const App: React.FC = () => {
  const [api] = useState(() => new PlatformApiClient());

  // Authentication State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('platform_token') || null);
  const [currentUser, setCurrentUser] = useState<PlatformUser | null>(null);
  const [isVerifyingAuth, setIsVerifyingAuth] = useState(true);

  // Active Navigation
  const [currentSection, setCurrentSection] = useState<PlatformNavigationSection>(() => {
    const hash = window.location.hash.replace('#', '') as PlatformNavigationSection;
    if (['overview', 'companies', 'subs', 'plans', 'modules', 'support', 'audit', 'settings'].includes(hash)) {
      return hash;
    }
    return 'overview';
  });

  // Selected Tenant for Cross-Module Navigation
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  // Active Support Session
  const [activeSession, setActiveSession] = useState<PlatformActiveSessionResponse | null>(null);

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Operator Activation Route
  const [isActivationRoute, setIsActivationRoute] = useState(() => {
    return window.location.pathname === '/activate-platform' || window.location.hash.startsWith('#activate');
  });

  useEffect(() => {
    const checkRoute = () => {
      setIsActivationRoute(window.location.pathname === '/activate-platform' || window.location.hash.startsWith('#activate'));
    };
    window.addEventListener('popstate', checkRoute);
    window.addEventListener('hashchange', checkRoute);
    return () => {
      window.removeEventListener('popstate', checkRoute);
      window.removeEventListener('hashchange', checkRoute);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  }, []);

  // Check current active support session
  const checkActiveSupportSession = useCallback(async (authToken: string) => {
    try {
      const sess = await api.getActiveSupportSession(authToken);
      setActiveSession(sess);
    } catch (e) {
      // ignore
    }
  }, [api]);

  // Verify auth on mount
  useEffect(() => {
    const initAuth = async () => {
      if (!token) {
        setIsVerifyingAuth(false);
        return;
      }
      try {
        const me = await api.getMe(token);
        if (me.platform_role) {
          setCurrentUser({
            id: me.id,
            email: me.email,
            display_name: me.display_name || me.email,
            platform_role: me.platform_role,
          });
          checkActiveSupportSession(token);
        } else {
          // Regular CRM user, not platform staff
          localStorage.removeItem('platform_token');
          setToken(null);
          setCurrentUser(null);
        }
      } catch (e) {
        localStorage.removeItem('platform_token');
        setToken(null);
        setCurrentUser(null);
      } finally {
        setIsVerifyingAuth(false);
      }
    };

    initAuth();
  }, [token, api, checkActiveSupportSession]);

  const handleLoginSuccess = (newToken: string, userRes: any) => {
    localStorage.setItem('platform_token', newToken);
    setToken(newToken);
    setCurrentUser({
      id: userRes.id,
      email: userRes.email,
      display_name: userRes.display_name || userRes.email,
      platform_role: userRes.platform_role,
    });
    checkActiveSupportSession(newToken);
    showToast(`Добро пожаловать в Platform Console, ${userRes.display_name || userRes.email}!`);
  };

  const handleLogout = () => {
    localStorage.removeItem('platform_token');
    setToken(null);
    setCurrentUser(null);
    setActiveSession(null);
  };

  const handleNavigate = (section: PlatformNavigationSection) => {
    setCurrentSection(section);
    window.location.hash = section;
  };

  const handleRevokeSession = async () => {
    if (!token || !activeSession?.request_id) return;
    try {
      await api.revokeAccessRequest(activeSession.request_id, token);
      setActiveSession(null);
      showToast('Сеанс технической поддержки завершён');
      await checkActiveSupportSession(token);
    } catch (err: any) {
      showToast(err.message || 'Ошибка завершения сеанса');
    }
  };

  if (isActivationRoute) {
    return (
      <OperatorActivationPage
        api={api}
        onNavigateToLogin={() => {
          window.history.pushState({}, '', '/login');
          window.location.hash = '';
          setIsActivationRoute(false);
        }}
        showToast={showToast}
      />
    );
  }

  if (isVerifyingAuth) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B1220',
          color: '#94A3B8',
          fontSize: '14px',
        }}
      >
        Проверка платформенной сессии...
      </div>
    );
  }

  if (!token || !currentUser) {
    return <PlatformLoginPage api={api} onLoginSuccess={handleLoginSuccess} />;
  }

  const getSectionTitle = (): { title: string; subtitle: string } => {
    switch (currentSection) {
      case 'overview':
        return { title: 'Операционный обзор платформы', subtitle: 'Ключевые агрегаты SaaS, биллинг и срочные действия' };
      case 'companies':
        return { title: 'Реестр компаний и арендаторов', subtitle: 'Управление доступом, жизненным циклом и квотами' };
      case 'subs':
        return { title: 'Подписки и книга счетов (Ledger)', subtitle: 'Ручной биллинг, выставление счетов и подтверждение оплат' };
      case 'plans':
        return { title: 'Тарифные планы и версионность', subtitle: 'Каталог тарифов и неизменяемые версии для клиентов' };
      case 'modules':
        return { title: 'Каталог модулей и возможностей', subtitle: 'Системный реестр фичей, стадии готовности и подключение' };
      case 'support':
        return { title: 'Служба технической поддержки', subtitle: 'Обращения клиентов, диагностика и временный доступ (30 мин)' };
      case 'audit':
        return { title: 'Журнал аудита действий (Audit Trail)', subtitle: 'Неизменяемая история операций с фиксацией оператора и причины' };
      case 'settings':
        return { title: 'Настройки платформы и персонал', subtitle: 'Управление операторами, матрица RBAC и параметры триала' };
    }
  };

  const { title, subtitle } = getSectionTitle();

  return (
    <>
      <PlatformLayout
        currentSection={currentSection}
        onNavigate={handleNavigate}
        currentUser={currentUser}
        onLogout={handleLogout}
        activeSession={activeSession}
        onRevokeSession={handleRevokeSession}
        title={title}
        subtitle={subtitle}
      >
        {currentSection === 'overview' && (
          <OverviewModule
            api={api}
            token={token}
            userRole={currentUser.platform_role}
            onNavigate={handleNavigate}
            onSelectTenant={(tenantId) => {
              setSelectedTenantId(tenantId);
              handleNavigate('companies');
            }}
          />
        )}

        {currentSection === 'companies' && (
          <CompaniesModule
            api={api}
            token={token}
            userRole={currentUser.platform_role}
            selectedTenantId={selectedTenantId}
            onClearSelectedTenant={() => setSelectedTenantId(null)}
            onNavigateToSupport={(tenantId) => {
              setSelectedTenantId(tenantId);
              handleNavigate('support');
            }}
            showToast={showToast}
          />
        )}

        {currentSection === 'subs' && (
          <SubscriptionsModule
            api={api}
            token={token}
            userRole={currentUser.platform_role}
            showToast={showToast}
          />
        )}

        {currentSection === 'plans' && (
          <PlansModule
            api={api}
            token={token}
            userRole={currentUser.platform_role}
            showToast={showToast}
          />
        )}

        {currentSection === 'modules' && (
          <ModulesCatalogModule
            api={api}
            token={token}
            userRole={currentUser.platform_role}
            showToast={showToast}
          />
        )}

        {currentSection === 'support' && (
          <SupportModule
            api={api}
            token={token}
            userRole={currentUser.platform_role}
            initialTenantId={selectedTenantId}
            onRefreshActiveSession={() => checkActiveSupportSession(token)}
            showToast={showToast}
          />
        )}

        {currentSection === 'audit' && (
          <AuditModule
            api={api}
            token={token}
            userRole={currentUser.platform_role}
            showToast={showToast}
          />
        )}

        {currentSection === 'settings' && (
          <PlatformSettingsModule
            api={api}
            token={token}
            userRole={currentUser.platform_role}
            showToast={showToast}
          />
        )}
      </PlatformLayout>

      {/* GLOBAL TOAST */}
      {toastMessage && (
        <div
          data-testid="platform-toast"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: '#0F172A',
            color: '#FFFFFF',
            padding: '12px 20px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
            border: '1px solid #334155',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>ℹ️</span> {toastMessage}
        </div>
      )}
    </>
  );
};
