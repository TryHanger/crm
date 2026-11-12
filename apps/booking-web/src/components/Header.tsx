import React, { useState } from 'react';
import { BranchResponse, PublicSiteResponse } from '@crm/api-client';
import { BookingFlow, BookingStep } from '../types';

interface HeaderProps {
  site: PublicSiteResponse | null;
  branch: BranchResponse | null;
  branches: BranchResponse[];
  onSelectBranch: (branch: BranchResponse) => void;
  accentColor?: string;
  flow?: BookingFlow;
  onChangeFlow?: (flow: BookingFlow) => void;
  step?: BookingStep;
}

export const Header: React.FC<HeaderProps> = ({
  site,
  branch,
  branches,
  onSelectBranch,
  accentColor = 'var(--accent, #242424)',
  flow = 'service-first',
  onChangeFlow,
  step = 'services',
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  const tenantName = site?.display_name || site?.business_name || 'BARBER HOUSE';
  const initials = tenantName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0].toUpperCase())
    .join('') || 'BH';

  const branchName = branch?.name || 'Главный филиал';
  const branchAddress = branch?.address || '';
  const phone = branch?.phone || '+7 (701) 555-01-23';

  return (
    <header style={{ background: 'var(--card, #FFFFFF)', borderBottom: '1px solid var(--hair, #D9D9D5)', width: '100%', position: 'relative', zIndex: 10 }}>
      <div
        style={{
          maxWidth: '1040px',
          margin: '0 auto',
          padding: '16px 24px',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        {/* Brand & Branch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              flex: 'none',
              borderRadius: '14px',
              background: 'var(--tile, #F0F0EE)',
              color: 'var(--accent, #242424)',
              boxShadow: 'var(--sh1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '17px',
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}
          >
            {initials}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: '19px',
                lineHeight: 1.2,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--ink, #202124)',
              }}
            >
              {tenantName}
            </span>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => branches.length > 1 && setBranchOpen(!branchOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: 'var(--muted, #646464)',
                  fontSize: '13.5px',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: branches.length > 1 ? 'pointer' : 'default',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>{branchName}</span>
                {branches.length > 1 && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                )}
              </button>

              {/* Branch Selector Dropdown */}
              {branchOpen && branches.length > 1 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: 0,
                    zIndex: 50,
                    background: 'var(--card, #FFFFFF)',
                    borderRadius: 'var(--r, 14px)',
                    boxShadow: 'var(--sh2)',
                    border: '1px solid var(--hair, #D9D9D5)',
                    minWidth: '240px',
                    padding: '6px',
                  }}
                >
                  {branches.map(b => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        onSelectBranch(b);
                        setBranchOpen(false);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        border: 'none',
                        borderRadius: '8px',
                        background: b.id === branch?.id ? '#F1F5F9' : 'transparent',
                        fontWeight: b.id === branch?.id ? 600 : 400,
                        fontSize: '14px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                      }}
                    >
                      <span style={{ color: '#0F172A' }}>{b.name}</span>
                      <span style={{ fontSize: '12px', color: '#64748B' }}>{b.address}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contacts Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              height: '38px',
              padding: '0 14px',
              borderRadius: '10px',
              border: '1px solid #E2E8F0',
              background: '#FFFFFF',
              color: '#334155',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Контакты</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                zIndex: 50,
                background: '#FFFFFF',
                borderRadius: '14px',
                boxShadow: '0 12px 28px rgba(0,0,0,0.12)',
                border: '1px solid #E2E8F0',
                width: '280px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Адрес филиала</span>
                <span style={{ fontSize: '14px', color: '#0F172A', fontWeight: 600 }}>{branchAddress}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Телефон для справок</span>
                <span style={{ fontSize: '14px', color: '#0F172A', fontWeight: 600 }}>{phone}</span>
              </div>
              <hr style={{ border: 0, borderTop: '1px solid #F1F5F9', margin: '4px 0' }} />
              <a
                href={`tel:${phone}`}
                style={{
                  height: '38px',
                  borderRadius: '10px',
                  background: accentColor,
                  color: '#FFFFFF',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
                </svg>
                Позвонить
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Entry Flow Selector Tabs */}
      {step !== 'manage' && step !== 'result' && onChangeFlow && (
        <div
          style={{
            maxWidth: '1040px',
            margin: '0 auto',
            padding: '0 24px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500, marginRight: '4px' }}>
            Способ записи:
          </span>
          {[
            { id: 'service-first', label: 'По услуге' },
            { id: 'master-first', label: 'По мастеру' },
            { id: 'time-first', label: 'По времени' },
          ].map(t => {
            const isActive = flow === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChangeFlow(t.id as BookingFlow)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '10px',
                  border: `1px solid ${isActive ? accentColor : '#E2E8F0'}`,
                  background: isActive ? `${accentColor}12` : '#FFFFFF',
                  color: isActive ? accentColor : '#475569',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
