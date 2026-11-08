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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F8FAFC' }}>
      {/* SIDEBAR (Desktop) */}
      <aside
        data-testid="platform-sidebar"
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

      {/* MAIN CONTENT AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* ACTIVE SUPPORT SESSION BANNER */}
        {activeSession && activeSession.has_active_session && (
          <div
            data-testid="active-support-session-banner"
            style={{
              background: '#0F172A',
              borderBottom: '2px solid #F59E0B',
              color: '#FEF3C7',
              padding: '10px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '13px',
              fontWeight: 500,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <span style={{ fontSize: '18px' }}>🛡️</span>
            <div style={{ flex: 1 }}>
              <b>Диагностический доступ активен:</b> компания <u>{activeSession.tenant_name}</u> · осталось{' '}
              <b>{activeSession.minutes_left} мин.</b> · Все действия строго логируются в журнал аудита
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
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Завершить сеанс
            </button>
          </div>
        )}

        {/* TOP HEADER */}
        <header
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
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
};
