import React, { useState } from 'react';
import { PlatformNavigationSection, PlatformUser, ROLE_LABELS, ROLE_BADGE_COLORS } from '../types';
import { PlatformActiveSessionResponse } from '@crm/api-client';

interface PlatformLayoutProps {
  currentSection: PlatformNavigationSection;
  onNavigate: (section: PlatformNavigationSection) => void;
  currentUser: PlatformUser;
  onLogout: () => void;
  activeSession: PlatformActiveSessionResponse | null;
  onRevokeSession: () => void;
  title: string;
  subtitle?: string;
  topActions?: React.ReactNode;
  children: React.ReactNode;
}

export const PlatformLayout: React.FC<PlatformLayoutProps> = ({
  currentSection,
  onNavigate,
  currentUser,
  onLogout,
  activeSession,
  onRevokeSession,
  title,
  subtitle,
  topActions,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navGroups: {
    groupTitle: string;
    items: { id: PlatformNavigationSection; label: string; icon: string; count?: number }[];
  }[] = [
    {
      groupTitle: 'РАБОТА',
      items: [
        { id: 'overview', label: 'Обзор', icon: '📊' },
        { id: 'companies', label: 'Компании', icon: '🏢' },
        { id: 'subs', label: 'Подписки и счета', icon: '💳' },
      ],
    },
    {
      groupTitle: 'ПРОДУКТ',
      items: [
        { id: 'plans', label: 'Тарифы', icon: '🏷️' },
        { id: 'modules', label: 'Модули системы', icon: '🧩' },
      ],
    },
    {
      groupTitle: 'СЕРВИС',
      items: [
        { id: 'support', label: 'Поддержка', icon: '🎧' },
        { id: 'audit', label: 'Аудит действий', icon: '🛡️' },
      ],
    },
    {
      groupTitle: 'ПЛАТФОРМА',
      items: [
        { id: 'settings', label: 'Настройки и персонал', icon: '⚙️' },
      ],
    },
  ];

  const roleStyle = ROLE_BADGE_COLORS[currentUser.platform_role] || {
    bg: '#F1F5F9',
    color: '#475569',
    border: '#CBD5E1',
  };

  const bottomNavItems: { id: PlatformNavigationSection; label: string; icon: string }[] = [
    { id: 'overview', label: 'Обзор', icon: '📊' },
    { id: 'companies', label: 'Компании', icon: '🏢' },
    { id: 'subs', label: 'Подписки', icon: '💳' },
    { id: 'support', label: 'Поддержка', icon: '🎧' },
  ];

  return (
    <div className="platform-root-layout" style={{ display: 'flex', minHeight: '100vh', background: '#F8FAFC', width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
      <style>{`
        @media (max-width: 768px) {
          .platform-root-layout {
            flex-direction: column !important;
          }
          .platform-desktop-sidebar {
            display: none !important;
          }
          .platform-mobile-header {
            display: flex !important;
          }
          .platform-mobile-bottom-bar {
            display: flex !important;
          }
          .platform-top-header {
            display: none !important;
          }
          .platform-page-body {
            padding: 14px 12px 76px 12px !important;
            width: 100% !important;
            max-width: 100vw !important;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
          }
          .platform-page-body > * {
            max-width: 100% !important;
            box-sizing: border-box !important;
          }
        }
        @media (min-width: 769px) {
          .platform-desktop-sidebar {
            display: flex !important;
          }
          .platform-mobile-header {
            display: none !important;
          }
          .platform-mobile-bottom-bar {
            display: none !important;
          }
          .platform-top-header {
            display: flex !important;
          }
          .platform-page-body {
            padding: 24px !important;
          }
        }
      `}</style>

      {/* SIDEBAR (Desktop) */}
      <aside
        data-testid="platform-sidebar"
        className="platform-desktop-sidebar"
        style={{
          width: '240px',
          background: '#0B1220',
          color: '#E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          borderRight: '1px solid #1E293B',
          zIndex: 40,
        }}
      >
        {/* Logo & Header */}
        <div style={{ padding: '20px 16px 14px', borderBottom: '1px solid #1E293B' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: '#2563EB',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 800,
              }}
            >
              PC
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#FFFFFF', lineHeight: 1.2 }}>Platform Console</div>
              <div style={{ fontSize: '11px', color: '#94A3B8' }}>Управление SaaS</div>
            </div>
          </div>
          <div>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: '#EF4444',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '4px',
                padding: '2px 6px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Внутренний доступ
            </span>
          </div>
        </div>

        {/* Navigation Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
          {navGroups.map((g, gIdx) => (
            <div key={gIdx} style={{ marginBottom: '18px' }}>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#64748B',
                  letterSpacing: '0.06em',
                  padding: '4px 10px',
                  marginBottom: '4px',
                }}
              >
                {g.groupTitle}
              </div>
              {g.items.map(item => {
                const isActive = currentSection === item.id;
                return (
                  <button
                    key={item.id}
                    data-testid={`platform-nav-${item.id}`}
                    onClick={() => onNavigate(item.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      marginBottom: '2px',
                      background: isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                      color: isActive ? '#FFFFFF' : '#94A3B8',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 500,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s ease, color 0.15s ease',
                    }}
                  >
                    <span style={{ fontSize: '15px' }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer User Info */}
        <div
          style={{
            padding: '12px 14px',
            borderTop: '1px solid #1E293B',
            background: '#070D18',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#334155',
              color: '#F8FAFC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {currentUser.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#F8FAFC',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {currentUser.display_name}
            </div>
            <div
              style={{
                fontSize: '10px',
                color: '#94A3B8',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {ROLE_LABELS[currentUser.platform_role]}
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Выйти из платформы"
            data-testid="platform-logout-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              fontSize: '14px',
            }}
          >
            🚪
          </button>
        </div>
      </aside>

      {/* MOBILE TOP HEADER (<=768px) */}
      <header
        className="platform-mobile-header"
        style={{
          display: 'none',
          position: 'sticky',
          top: 0,
          left: 0,
          right: 0,
          height: '54px',
          background: '#0B1220',
          borderBottom: '1px solid #1E293B',
          padding: '0 14px',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 45,
          color: '#FFFFFF',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setMobileMenuOpen(true)}
            data-testid="platform-mobile-menu-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#FFFFFF',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Открыть меню"
          >
            ☰
          </button>
          <span
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '6px',
              background: '#2563EB',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 800,
            }}
          >
            PC
          </span>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#FFFFFF' }}>{title}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            data-testid="platform-user-role-badge-mobile"
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '10px',
              background: roleStyle.bg,
              color: roleStyle.color,
              border: `1px solid ${roleStyle.border}`,
            }}
          >
            {ROLE_LABELS[currentUser.platform_role]}
          </span>
          <button
            onClick={onLogout}
            data-testid="platform-mobile-logout-btn"
            title="Выйти"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            🚪
          </button>
        </div>
      </header>

      {/* MOBILE DRAWER (Slide-over when mobileMenuOpen is true) */}
      {mobileMenuOpen && (
        <div
          data-testid="mobile-drawer-overlay"
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 60,
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            data-testid="mobile-drawer"
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: 0,
              bottom: 0,
              left: 0,
              width: '280px',
              maxWidth: '82vw',
              background: '#0B1220',
              color: '#FFFFFF',
              zIndex: 61,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '4px 0 20px rgba(0,0,0,0.5)',
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: '16px',
                borderBottom: '1px solid #1E293B',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 800,
                  }}
                >
                  PC
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#FFFFFF' }}>Platform Console</div>
                  <div style={{ fontSize: '10px', color: '#94A3B8' }}>{ROLE_LABELS[currentUser.platform_role]}</div>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                data-testid="mobile-drawer-close-btn"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94A3B8',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                ✕
              </button>
            </div>

            {/* Drawer Navigation List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
              {navGroups.map((g, gIdx) => (
                <div key={gIdx} style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', padding: '4px 8px', letterSpacing: '0.05em' }}>
                    {g.groupTitle}
                  </div>
                  {g.items.map(item => {
                    const isActive = currentSection === item.id;
                    return (
                      <button
                        key={item.id}
                        data-testid={`drawer-nav-${item.id}`}
                        onClick={() => {
                          onNavigate(item.id);
                          setMobileMenuOpen(false);
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px 12px',
                          marginBottom: '2px',
                          background: isActive ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                          color: isActive ? '#FFFFFF' : '#94A3B8',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '13px',
                          fontWeight: isActive ? 600 : 500,
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Drawer Footer */}
            <div style={{ padding: '14px 16px', borderTop: '1px solid #1E293B', background: '#070D18' }}>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onLogout();
                }}
                data-testid="platform-drawer-logout-btn"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#EF4444',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <span>🚪</span>
                <span>Выйти из консоли</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <div className="platform-main-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
        {/* ACTIVE SUPPORT SESSION BANNER */}
        {activeSession && activeSession.has_active_session && (
          <div
            data-testid="active-support-session-banner"
            style={{
              background: '#0F172A',
              borderBottom: '2px solid #F59E0B',
              color: '#FEF3C7',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '12px',
              fontWeight: 500,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '18px' }}>🛡️</span>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <b>Диагностический доступ активен:</b> <u>{activeSession.tenant_name}</u> · осталось{' '}
              <b>{activeSession.minutes_left} мин.</b>
            </div>
            <button
              onClick={onRevokeSession}
              data-testid="end-support-session-btn"
              style={{
                background: '#FFFFFF',
                color: '#0F172A',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Завершить сеанс
            </button>
          </div>
        )}

        {/* TOP HEADER (Desktop) */}
        <header
          className="platform-top-header"
          style={{
            height: '64px',
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A', lineHeight: 1.2 }}>
                {title}
              </h1>
              {subtitle && <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>{subtitle}</div>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {topActions}

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: roleStyle.bg,
                color: roleStyle.color,
                border: `1px solid ${roleStyle.border}`,
                borderRadius: '16px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
              }}
              data-testid="platform-user-role-badge"
            >
              <span>{ROLE_LABELS[currentUser.platform_role]}</span>
            </div>
          </div>
        </header>

        {/* PAGE BODY */}
        <main
          className="platform-page-body"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          {children}
        </main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR (<=768px) */}
      <nav
        className="platform-mobile-bottom-bar"
        data-testid="platform-bottom-nav"
        style={{
          display: 'none',
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '60px',
          background: '#0B1220',
          borderTop: '1px solid #1E293B',
          zIndex: 50,
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '0 4px',
        }}
      >
        {bottomNavItems.map(item => {
          const isActive = currentSection === item.id;
          return (
            <button
              key={item.id}
              data-testid={`mobile-nav-${item.id}`}
              onClick={() => onNavigate(item.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                color: isActive ? '#38BDF8' : '#94A3B8',
                padding: '4px 6px',
                fontSize: '10px',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                flex: 1,
                gap: '2px',
              }}
            >
              <span style={{ fontSize: '18px' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}

        <button
          onClick={() => setMobileMenuOpen(true)}
          data-testid="mobile-nav-more"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: '#94A3B8',
            padding: '4px 6px',
            fontSize: '10px',
            fontWeight: 500,
            cursor: 'pointer',
            flex: 1,
            gap: '2px',
          }}
        >
          <span style={{ fontSize: '18px' }}>☰</span>
          <span>Ещё</span>
        </button>
      </nav>
    </div>
  );
};
