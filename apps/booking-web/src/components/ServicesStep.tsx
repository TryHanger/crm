import React, { useState } from 'react';
import { ServiceItemResponse, StaffPublicResponse } from '@crm/api-client';

interface ServicesStepProps {
  categories: any[];
  services: ServiceItemResponse[];
  selectedServices: ServiceItemResponse[];
  onToggleService: (service: ServiceItemResponse) => void;
  selectedStaff: StaffPublicResponse | 'any' | null;
  onClearStaff: () => void;
  onSwitchToMasterFirst: () => void;
  preferredTime?: string | null;
  selectedDate?: string | null;
  accentColor?: string;
}

export const ServicesStep: React.FC<ServicesStepProps> = ({
  categories,
  services,
  selectedServices,
  onToggleService,
  selectedStaff,
  onClearStaff,
  onSwitchToMasterFirst,
  preferredTime,
  selectedDate,
  accentColor = 'var(--accent, #242424)',
}) => {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const selectedIds = new Set(selectedServices.map(s => s.id));

  // Filter services by category if selected
  const filteredServices = activeCategoryId
    ? services.filter(s => s.category_id === activeCategoryId)
    : services;

  const staffObj = typeof selectedStaff === 'object' && selectedStaff !== null ? selectedStaff : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '30px', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink, #202124)' }}>
          Выберите услуги
        </h1>
        <p style={{ margin: 0, color: 'var(--muted, #646464)', fontSize: '15px' }}>
          Можно выбрать одну или несколько процедур для визита
        </p>
      </div>

      {/* Preferred time banner if time-first */}
      {preferredTime && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '14px 18px',
            borderRadius: '14px',
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
          }}
        >
          <span
            style={{
              width: '40px',
              height: '40px',
              flex: 'none',
              borderRadius: '10px',
              background: '#F1F5F9',
              color: '#0F172A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', color: '#64748B' }}>Желаемое время</div>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>
              {selectedDate} в {preferredTime}
            </div>
          </div>
        </div>
      )}

      {/* Selected Master Context Card if master-first */}
      {staffObj && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px 20px',
            borderRadius: '16px',
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
          }}
        >
          <span
            style={{
              width: '48px',
              height: '48px',
              flex: 'none',
              borderRadius: '50%',
              background: '#E2E8F0',
              color: '#334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '17px',
              fontWeight: 600,
            }}
          >
            {staffObj.display_name
              .split(' ')
              .map(w => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '17px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {staffObj.display_name}
            </div>
            <div style={{ fontSize: '14px', color: '#64748B' }}>
              {staffObj.role_title || 'Барбер'} · принимает в этом филиале
            </div>
          </div>
          <button
            type="button"
            onClick={onClearStaff}
            style={{
              flex: 'none',
              border: 0,
              background: 'transparent',
              color: accentColor,
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            Сменить мастера
          </button>
        </div>
      )}

      {/* Category Pills */}
      {categories.length > 1 && (
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          <button
            type="button"
            onClick={() => setActiveCategoryId(null)}
            style={{
              height: '38px',
              padding: '0 16px',
              borderRadius: '999px',
              border: '1px solid',
              borderColor: activeCategoryId === null ? accentColor : '#CBD5E1',
              background: activeCategoryId === null ? accentColor : '#FFFFFF',
              color: activeCategoryId === null ? '#FFFFFF' : '#0F172A',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Все категории
          </button>
          {categories.map(c => {
            const isActive = activeCategoryId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategoryId(c.id)}
                style={{
                  height: '38px',
                  padding: '0 16px',
                  borderRadius: '999px',
                  border: '1px solid',
                  borderColor: isActive ? accentColor : '#CBD5E1',
                  background: isActive ? accentColor : '#FFFFFF',
                  color: isActive ? '#FFFFFF' : '#0F172A',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Service List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredServices.map(s => {
          const isSelected = selectedIds.has(s.id);
          const priceFormatted = s.price_formatted || `${(s.base_price_minor / 100).toLocaleString('ru-RU')} ₸`;
          const durationFormatted = `${s.base_duration_minutes} мин`;

          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onToggleService(s)}
              aria-pressed={isSelected}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                padding: '18px 22px',
                minHeight: '84px',
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
              {/* Checkbox square */}
              <span
                style={{
                  width: '24px',
                  height: '24px',
                  flex: 'none',
                  borderRadius: '7px',
                  boxSizing: 'border-box',
                  border: `2px solid ${isSelected ? accentColor : 'var(--hair, #D9D9D5)'}`,
                  background: isSelected ? accentColor : 'var(--card, #FFFFFF)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isSelected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--on-accent, #FFFFFF)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>

              {/* Service info */}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '17px', fontWeight: 600, color: 'var(--ink, #202124)' }}>{s.name}</span>
                <span style={{ fontSize: '13.5px', color: 'var(--muted, #646464)' }}>
                  {durationFormatted}
                  {s.description ? ` · ${s.description}` : ''}
                </span>
              </span>

              {/* Price */}
              <span style={{ fontSize: '17px', fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--ink, #202124)' }}>
                {priceFormatted}
              </span>
            </button>
          );
        })}
      </div>

      {/* Alternative entry point if not in master-first */}
      {!staffObj && (
        <button
          type="button"
          onClick={onSwitchToMasterFirst}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: '44px',
            color: accentColor,
            fontSize: '15px',
            fontWeight: 600,
            textDecoration: 'none',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Предпочитаю сначала выбрать мастера
        </button>
      )}
    </div>
  );
};
