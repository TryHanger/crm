import React, { useState } from 'react';
import { CrmMembership, CrmNavigationSection } from '../types';

interface CrmLayoutProps {
  membership: CrmMembership;
  memberships: CrmMembership[];
  onSelectMembership: (m: CrmMembership) => void;
  currentSection: CrmNavigationSection;
  onNavigate: (section: CrmNavigationSection) => void;
  currentUser: any;
  onLogout: () => void;
  branches: any[];
  selectedBranchId: string | null;
  onSelectBranch: (branchId: string) => void;
  title: string;
  subtitle?: string;
  topActions?: React.ReactNode;
  children: React.ReactNode;
}

export const CrmLayout: React.FC<CrmLayoutProps> = ({
  membership,
  memberships,
  onSelectMembership,
  currentSection,
  onNavigate,
  currentUser,
  onLogout,
  branches,
  selectedBranchId,
  onSelectBranch,
  title,
  subtitle,
  topActions,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);

  const isMaster = membership.role === 'master';

  const navItems: { id: CrmNavigationSection; label: string; icon: string; count?: number }[] = [
    { id: 'calendar', label: 'Календарь', icon: '📅' },
    { id: 'customers', label: 'Клиенты', icon: '👥' },
    ...(!isMaster
      ? [
          { id: 'staff' as CrmNavigationSection, label: 'Сотрудники', icon: '✂️' },
          { id: 'services' as CrmNavigationSection, label: 'Услуги', icon: '🏷️' },
          { id: 'online-booking' as CrmNavigationSection, label: 'Онлайн-запись', icon: '🌐' },
          { id: 'reports' as CrmNavigationSection, label: 'Отчёты', icon: '📊' },
          { id: 'settings' as CrmNavigationSection, label: 'Настройки', icon: '⚙️' },
        ]
      : []),
  ];

  const currentBranch = branches.find(b => b.id === selectedBranchId) || branches[0];
  const brandInitials = membership.tenant_name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: '#F8FAFC',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#0F172A',
      }}
    >
      {/* Desktop Sidebar (216px as in design) */}
      <aside
        style={{
          width: '216px',
          background: '#FFFFFF',
          borderRight: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 12px',
          gap: '4px',
          flexShrink: 0,
        }}
        className="crm-desktop-sidebar"
      >
        {/* Brand / Logo */}
        <div
          className="crm-brand-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '4px 8px 12px',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: '#0F172A',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {brandInitials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 700,
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {membership.tenant_name}
            </div>
            {memberships.length > 1 && (
              <button
                type="button"
                onClick={() => setTenantDropdownOpen(!tenantDropdownOpen)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: '#2563EB',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                Сменить компанию ▾
              </button>
            )}
          </div>

          {/* Tenant Switcher Dropdown */}
          {tenantDropdownOpen && memberships.length > 1 && (
            <div
              style={{
                position: 'absolute',
                top: '50px',
                left: '8px',
                right: '8px',
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
                zIndex: 50,
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <div style={{ fontSize: '11px', color: '#64748B', padding: '6px 8px', fontWeight: 600 }}>
                Ваши компании:
              </div>
              {memberships.map(m => (
                <button
                  key={m.tenant_id}
                  type="button"
                  onClick={() => {
                    onSelectMembership(m);
                    setTenantDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    background: m.tenant_id === membership.tenant_id ? '#EFF6FF' : 'transparent',
                    color: m.tenant_id === membership.tenant_id ? '#1D4ED8' : '#0F172A',
                    fontSize: '13px',
                    fontWeight: m.tenant_id === membership.tenant_id ? 600 : 400,
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{m.tenant_name}</span>
                  <span style={{ fontSize: '11px', color: '#64748B' }}>({m.role})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Branch Selector Pill */}
        {branches.length > 0 && (
          <div style={{ position: 'relative', marginBottom: '8px' }}>
            <button
              type="button"
              onClick={() => setBranchDropdownOpen(!branchDropdownOpen)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 500,
                background: '#F8FAFC',
                color: '#334155',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                📍 {currentBranch?.name || 'Главный филиал'}
              </span>
              <span style={{ fontSize: '10px', color: '#64748B' }}>▼</span>
            </button>

            {branchDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '4px',
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '10px',
                  boxShadow: '0 6px 16px rgba(15,23,42,0.1)',
                  zIndex: 40,
                  padding: '4px',
                }}
              >
                {branches.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      onSelectBranch(b.id);
                      setBranchDropdownOpen(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '6px',
                      border: 'none',
                      background: b.id === selectedBranchId ? '#EFF6FF' : 'transparent',
                      color: b.id === selectedBranchId ? '#1D4ED8' : '#0F172A',
                      fontSize: '13px',
                      fontWeight: b.id === selectedBranchId ? 600 : 400,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Navigation Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
          {navItems.map(item => {
            const isActive = currentSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '0 10px',
                  height: '40px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#1D4ED8' : '#334155',
                  background: isActive ? '#EFF6FF' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.1s ease',
                }}
              >
                <span style={{ fontSize: '16px' }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.count !== undefined && (
                  <span
                    style={{
                      fontSize: '12px',
                      background: '#E2E8F0',
                      borderRadius: '999px',
                      padding: '1px 8px',
                      color: '#334155',
                    }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User Profile & Logout */}
        <div
          style={{
            borderTop: '1px solid #E2E8F0',
            paddingTop: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                background: '#E2E8F0',
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              {currentUser?.display_name ? currentUser.display_name.slice(0, 2).toUpperCase() : 'С'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {currentUser?.display_name || 'Сотрудник'}
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'capitalize' }}>
                {membership.role}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            style={{
              height: '34px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#475569',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Header Bar (64px) */}
        <header
          style={{
            height: '64px',
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            gap: '16px',
            flexShrink: 0,
          }}
        >
          {/* Mobile hamburger button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              display: 'none',
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
            }}
            className="crm-mobile-hamburger"
          >
            ☰
          </button>

          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, lineHeight: 1.2 }}>{title}</h1>
            <div style={{ fontSize: '13px', color: '#64748B' }}>
              <span style={{ fontWeight: 600, color: '#334155' }}>{membership.tenant_name}</span>
              {subtitle && ` • ${subtitle}`}
            </div>
          </div>

          {topActions && <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{topActions}</div>}
        </header>

        {/* Content Body */}
        <main style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>{children}</main>
      </div>
    </div>
  );
};
