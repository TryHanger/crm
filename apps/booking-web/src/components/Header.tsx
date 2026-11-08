import React, { useState } from 'react';
import { BranchResponse, PublicSiteResponse } from '@crm/api-client';

interface HeaderProps {
  site: PublicSiteResponse | null;
  branch: BranchResponse | null;
  branches: BranchResponse[];
  onSelectBranch: (branch: BranchResponse) => void;
  accentColor?: string;
}

export const Header: React.FC<HeaderProps> = ({
  site,
  branch,
  branches,
  onSelectBranch,
  accentColor = '#2563EB',
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
    <header style={{ background: '#FFFFFF', borderBottom: '1px solid #E2E8F0', width: '100%' }}>
      <div
        style={{
          maxWidth: '1040px',
          margin: '0 auto',
          padding: '14px 24px',
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
              width: '48px',
              height: '48px',
              flex: 'none',
              borderRadius: '12px',
              background: '#0F172A',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '17px',
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            {initials}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: '18px',
                lineHeight: 1.3,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
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
                  color: '#64748B',
                  fontSize: '14px',
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
                  <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>{branchName}</span>
                {branches.length > 1 && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                )}
              </button>

              {branchOpen && branches.length > 1 && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '24px',
                    zIndex: 20,
                    minWidth: '220px',
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '10px',
                    boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
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
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: b.id === branch?.id ? '#EFF6FF' : 'transparent',
                        color: b.id === branch?.id ? accentColor : '#0F172A',
                        fontWeight: b.id === branch?.id ? 600 : 400,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                      }}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contacts menu button */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            style={{
              height: '48px',
              padding: '0 18px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              border: '1px solid #CBD5E1',
              borderRadius: '10px',
              background: '#FFFFFF',
              color: '#0F172A',
              fontSize: '16px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Контакты
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
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
                right: 0,
                top: '56px',
                zIndex: 30,
                width: '240px',
                padding: '6px',
                boxSizing: 'border-box',
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
              }}
            >
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(branchAddress || branchName)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  minHeight: '48px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  color: '#0F172A',
                  textDecoration: 'none',
                  fontSize: '16px',
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
                  <polygon points="3 11 22 2 13 21 11 13 3 11" />
                </svg>
                Построить маршрут
              </a>
              <a
                href={`tel:${phone.replace(/\s+/g, '')}`}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  minHeight: '48px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  color: '#0F172A',
                  textDecoration: 'none',
                  fontSize: '16px',
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
    </header>
  );
};
