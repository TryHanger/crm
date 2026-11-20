import React, { useEffect, useState } from 'react';
import { CrmMembership, CrmNavigationSection } from '../types';
import { Icon, IconName } from '../ui/Icon';

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
  /** записей на сегодня — счётчик у «Календаря» */
  todayCount?: number;
  /** false — страница рисует свою шапку (например, «Обзор») */
  showHeader?: boolean;
  children: React.ReactNode;
}

type NavItem = { id: CrmNavigationSection; label: string; icon: IconName };

const ROLE_LABEL: Record<string, string> = { owner: 'Владелец', admin: 'Администратор', master: 'Мастер' };

export const initials = (s?: string) =>
  (s || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '—';

const readTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

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
  todayCount,
  showHeader = true,
  children,
}) => {
  const [branchOpen, setBranchOpen] = useState(false);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('crm_theme', theme);
    } catch {
      /* private mode: тема просто не запомнится */
    }
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBranchOpen(false);
        setTenantOpen(false);
        setMoreOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isMaster = membership.role === 'master';

  const work: NavItem[] = [
    ...(!isMaster ? [{ id: 'overview' as CrmNavigationSection, label: 'Обзор', icon: 'home' as IconName }] : []),
    { id: 'calendar', label: 'Календарь', icon: 'cal' },
    { id: 'customers', label: 'Клиенты', icon: 'users' },
  ];
  const business: NavItem[] = isMaster
    ? []
    : [
        { id: 'staff', label: 'Сотрудники', icon: 'team' },
        { id: 'services', label: 'Услуги', icon: 'tag' },
        { id: 'online-booking', label: 'Онлайн-запись', icon: 'globe' },
        { id: 'cash', label: 'Касса и смены', icon: 'wallet' },
        { id: 'reports', label: 'Отчёты', icon: 'chart' },
      ];
  const system: NavItem[] = isMaster
    ? []
    : [
        { id: 'settings', label: 'Настройки', icon: 'cog' },
        { id: 'onboarding', label: 'Онбординг', icon: 'check' },
      ];
  const groups: [string, NavItem[]][] = [
    ['Работа', work],
    ['Бизнес', business],
    ['Система', system],
  ];
  const all = [...work, ...business, ...system];

  const currentBranch = branches.find(b => b.id === selectedBranchId) || branches[0];
  const branchLabel = currentBranch
    ? [currentBranch.city, currentBranch.address || currentBranch.name].filter(Boolean).join(' · ')
    : 'Филиал не создан';
  const userName = currentUser?.display_name || 'Сотрудник';

  const go = (id: CrmNavigationSection) => {
    setMoreOpen(false);
    onNavigate(id);
    window.scrollTo(0, 0);
  };

  const tabs: NavItem[] = [
    isMaster ? { id: 'calendar', label: 'Календарь', icon: 'cal' } : { id: 'overview', label: 'Обзор', icon: 'home' },
    ...(isMaster ? [] : [{ id: 'calendar' as CrmNavigationSection, label: 'Календарь', icon: 'cal' as IconName }]),
    { id: 'customers', label: 'Клиенты', icon: 'users' },
  ];
  const moreItems = all.filter(i => !tabs.some(t => t.id === i.id));
  const moreActive = moreItems.some(i => i.id === currentSection);

  const branchMenu = branchOpen && branches.length > 0 && (
    <div className="menu" role="menu">
      <div className="menu-h">Филиалы</div>
      {branches.map(b => (
        <button
          key={b.id}
          type="button"
          role="menuitem"
          className={b.id === selectedBranchId ? 'on' : ''}
          onClick={() => {
            onSelectBranch(b.id);
            setBranchOpen(false);
          }}
        >
          <span className="ellip">{b.name}</span>
          {b.city && <small>{b.city}</small>}
        </button>
      ))}
    </div>
  );

  return (
    <div className="app">
      <aside className="side crm-desktop-sidebar">
        <div style={{ position: 'relative' }}>
          <div
            className="brand"
            onClick={() => memberships.length > 1 && setTenantOpen(!tenantOpen)}
            title={memberships.length > 1 ? 'Сменить компанию' : membership.tenant_name}
          >
            <div className="logo">{initials(membership.tenant_name)}</div>
            <div style={{ minWidth: 0 }}>
              <small>Компания</small>
              <b className="ellip">{membership.tenant_name}</b>
            </div>
            {memberships.length > 1 && (
              <span className="chev">
                <Icon name="down" size={14} />
              </span>
            )}
          </div>
          {tenantOpen && memberships.length > 1 && (
            <div className="menu" role="menu">
              <div className="menu-h">Ваши компании</div>
              {memberships.map(m => (
                <button
                  key={m.tenant_id}
                  type="button"
                  role="menuitem"
                  className={m.tenant_id === membership.tenant_id ? 'on' : ''}
                  onClick={() => {
                    onSelectMembership(m);
                    setTenantOpen(false);
                  }}
                >
                  <span className="ellip">{m.tenant_name}</span>
                  <small>{ROLE_LABEL[m.role] || m.role}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <div
            className="branch"
            data-testid="branch-switcher"
            onClick={() => branches.length > 0 && setBranchOpen(!branchOpen)}
          >
            {branchLabel}
            {branches.length > 1 && ' ▾'}
          </div>
          {branchMenu}
        </div>

        <nav className="nav">
          {groups.map(([g, items]) =>
            items.length ? (
              <React.Fragment key={g}>
                <div className="grp">{g}</div>
                {items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`nav-${item.id}`}
                    className={currentSection === item.id ? 'on' : ''}
                    title={item.label}
                    onClick={() => go(item.id)}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                    {item.id === 'calendar' && todayCount !== undefined && <em className="cnt">{todayCount}</em>}
                  </button>
                ))}
              </React.Fragment>
            ) : null,
          )}
        </nav>

        <div className="me">
          <div className="av">{initials(userName)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b className="ellip">{userName}</b>
            <span>{ROLE_LABEL[membership.role] || membership.role}</span>
          </div>
          <button type="button" className="btn sm ghost" data-testid="logout-btn" title="Выйти из CRM" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="row" style={{ minWidth: 0 }}>
            <div className="logo" style={{ width: 32, height: 32 }}>
              {initials(membership.tenant_name)}
            </div>
            <div style={{ minWidth: 0, position: 'relative' }} onClick={() => branches.length > 1 && setBranchOpen(!branchOpen)}>
              <b className="ellip" style={{ display: 'block' }}>
                {membership.tenant_name}
              </b>
              <small className="ellip">{branchLabel}</small>
              {branchMenu}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn ic ghost"
              title="Тема"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Icon name="moon" />
            </button>
            <div className="av" style={{ width: 30, height: 30, fontSize: 11 }} onClick={onLogout} title="Выйти">
              {initials(userName)}
            </div>
          </div>
        </div>

        <header className="crumbs">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <span className="ellip">{membership.tenant_name}</span>
            <span style={{ color: 'var(--muted2)' }}>/</span>
            <b className="ellip">{title}</b>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {topActions}
            {!isMaster && (
              <button
                type="button"
                data-testid="header-onboarding-btn"
                className={`btn sm ${currentSection === 'onboarding' ? 'p' : ''}`}
                onClick={() => go('onboarding')}
              >
                <Icon name="check" size={14} />
                Онбординг-чеклист
                {branches.length === 0 && <span className="pill-hl">1</span>}
              </button>
            )}
            <button
              type="button"
              className="btn ic"
              data-testid="theme-toggle"
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Icon name="moon" size={16} />
            </button>
          </div>
        </header>

        <main className="page">
          {showHeader && (
            <div className="ph">
              <div>
                <h1>{title}</h1>
                {subtitle && <div className="sub">{subtitle}</div>}
              </div>
            </div>
          )}
          {children}
        </main>
      </div>

      <div className="tabbar">
        {tabs.map((t, i) => (
          <React.Fragment key={t.id}>
            {i === 2 && !isMaster && (
              <button type="button" className="plus" title="Новая запись" onClick={() => go('calendar')}>
                <span className="pl">
                  <Icon name="plus" />
                </span>
              </button>
            )}
            <button type="button" className={currentSection === t.id ? 'on' : ''} onClick={() => go(t.id)}>
              <Icon name={t.icon} size={22} />
              {t.label}
            </button>
          </React.Fragment>
        ))}
        <button type="button" className={moreActive ? 'on' : ''} onClick={() => setMoreOpen(true)}>
          <Icon name="more" size={22} />
          Ещё
        </button>
      </div>

      <div className={`scrim ${moreOpen ? 'on' : ''}`} onClick={() => setMoreOpen(false)} />
      <div className={`sheet-more ${moreOpen ? 'on' : ''}`}>
        <div className="grab" />
        {moreItems.map(i => (
          <button key={i.id} type="button" onClick={() => go(i.id)}>
            <Icon name={i.icon} size={20} />
            {i.label}
          </button>
        ))}
        <button type="button" onClick={onLogout}>
          <Icon name="x" size={20} />
          Выйти
        </button>
      </div>
    </div>
  );
};
