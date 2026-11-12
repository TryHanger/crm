import React from 'react';
import { StaffPublicResponse, ServiceItemResponse } from '@crm/api-client';

interface StaffStepProps {
  staffList: StaffPublicResponse[];
  selectedStaff: StaffPublicResponse | 'any' | null;
  onSelectStaff: (staff: StaffPublicResponse | 'any') => void;
  selectedServices: ServiceItemResponse[];
  accentColor?: string;
}

export const StaffStep: React.FC<StaffStepProps> = ({
  staffList,
  selectedStaff,
  onSelectStaff,
  selectedServices,
  accentColor = 'var(--accent, #242424)',
}) => {
  const isAnySelected = selectedStaff === 'any';
  const selectedStaffId = typeof selectedStaff === 'object' && selectedStaff !== null ? selectedStaff.id : null;

  // Calculate base price for selected services
  const basePriceMinor = selectedServices.reduce((sum, s) => sum + s.base_price_minor, 0);
  const baseDurationMinutes = selectedServices.reduce((sum, s) => sum + s.base_duration_minutes, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '30px', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink, #202124)' }}>
          Выберите специалиста
        </h1>
        <p style={{ margin: 0, color: 'var(--muted, #646464)', fontSize: '15px' }}>
          К кому вы хотите записаться на стрижку или уход
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Option: Any master */}
        <button
          type="button"
          onClick={() => onSelectStaff('any')}
          aria-pressed={isAnySelected}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '18px 22px',
            minHeight: '96px',
            borderRadius: 'var(--r, 18px)',
            border: `1px solid ${isAnySelected ? accentColor : 'var(--hair, #D9D9D5)'}`,
            background: isAnySelected ? 'var(--tile, #F0F0EE)' : 'var(--card, #FFFFFF)',
            boxShadow: isAnySelected ? 'var(--sh-acc)' : 'var(--sh1)',
            color: 'var(--ink, #202124)',
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: '15px',
            transition: 'all 0.15s ease-in-out',
          }}
        >
          {/* Radio circle */}
          <span
            style={{
              width: '24px',
              height: '24px',
              flex: 'none',
              borderRadius: '50%',
              boxSizing: 'border-box',
              border: `2px solid ${isAnySelected ? accentColor : '#CBD5E1'}`,
              background: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isAnySelected && (
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: accentColor,
                }}
              />
            )}
          </span>

          {/* Any master icon tile */}
          <span
            style={{
              width: '56px',
              height: '56px',
              flex: 'none',
              borderRadius: '16px',
              background: '#EFF6FF',
              color: accentColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>

          {/* Text */}
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '18px', lineHeight: 1.3, fontWeight: 600 }}>Любой свободный мастер</span>
            <span style={{ fontSize: '15px', color: '#475569' }}>
              Система подберёт ближайшее доступное время среди свободных мастеров
            </span>
          </span>

          {/* Price preview */}
          {basePriceMinor > 0 && (
            <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                от {(basePriceMinor / 100).toLocaleString('ru-RU')} ₸
              </span>
              <span style={{ fontSize: '14px', color: '#64748B' }}>~{baseDurationMinutes} мин</span>
            </span>
          )}
        </button>

        {/* Individual Staff Cards */}
        {staffList.map(st => {
          const isSelected = selectedStaffId === st.id;
          const initials = st.display_name
            .split(' ')
            .map((w: string) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          return (
            <button
              key={st.id}
              type="button"
              onClick={() => onSelectStaff(st)}
              aria-pressed={isSelected}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                padding: '18px 22px',
                minHeight: '96px',
                borderRadius: 'var(--r, 18px)',
                border: `1px solid ${isSelected ? accentColor : 'var(--hair, #D9D9D5)'}`,
                background: isSelected ? 'var(--tile, #F0F0EE)' : 'var(--card, #FFFFFF)',
                boxShadow: isSelected ? 'var(--sh-acc)' : 'var(--sh1)',
                color: 'var(--ink, #202124)',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '15px',
                transition: 'all 0.15s ease-in-out',
              }}
            >
              {/* Radio circle */}
              <span
                style={{
                  width: '24px',
                  height: '24px',
                  flex: 'none',
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  border: `2px solid ${isSelected ? accentColor : '#CBD5E1'}`,
                  background: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isSelected && (
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: accentColor,
                    }}
                  />
                )}
              </span>

              {/* Avatar circle */}
              <span
                style={{
                  width: '56px',
                  height: '56px',
                  flex: 'none',
                  borderRadius: '50%',
                  background: '#E2E8F0',
                  color: '#334155',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  fontWeight: 600,
                }}
              >
                {initials}
              </span>

              {/* Info */}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '18px', lineHeight: 1.3, fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {st.display_name}
                </span>
                <span style={{ fontSize: '15px', color: '#475569' }}>
                  {st.role_title || 'Барбер'}
                </span>
                <span style={{ fontSize: '14px', color: '#64748B' }}>
                  Опыт от 3 лет
                </span>
              </span>

              {/* Price & duration preview */}
              {basePriceMinor > 0 && (
                <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' }}>
                  <span style={{ fontSize: '18px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {(basePriceMinor / 100).toLocaleString('ru-RU')} ₸
                  </span>
                  <span style={{ fontSize: '14px', color: '#64748B' }}>{baseDurationMinutes} мин</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
