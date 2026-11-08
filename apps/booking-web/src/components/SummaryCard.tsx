import React, { useState } from 'react';
import { BranchResponse, ServiceItemResponse, StaffPublicResponse, SlotResponse } from '@crm/api-client';
import { BookingStep } from '../types';

interface SummaryCardProps {
  branch: BranchResponse | null;
  selectedServices: ServiceItemResponse[];
  selectedStaff: StaffPublicResponse | 'any' | null;
  selectedSlot: SlotResponse | null;
  currentStep: BookingStep;
  onNext: () => void;
  accentColor?: string;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({
  branch,
  selectedServices,
  selectedStaff,
  selectedSlot,
  currentStep,
  onNext,
  accentColor = '#2563EB',
}) => {
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const totalAmountMinor =
    selectedSlot?.price_minor ||
    selectedServices.reduce((sum, s) => sum + s.base_price_minor, 0);

  const totalDurationMinutes =
    selectedSlot?.duration_minutes ||
    selectedServices.reduce((sum, s) => sum + s.base_duration_minutes, 0);

  const staffName =
    typeof selectedStaff === 'object' && selectedStaff !== null
      ? selectedStaff.display_name
      : selectedStaff === 'any'
      ? 'Любой свободный'
      : 'Не выбран';

  const formatSlotTime = (isoString?: string) => {
    if (!isoString) return 'Не выбрано';
    const d = new Date(isoString);
    const dateFormatted = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    const timeFormatted = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
    return `${dateFormatted}, ${timeFormatted}`;
  };

  // Determine CTA label and active status
  let ctaLabel = 'Продолжить';
  let canProceed = false;

  if (currentStep === 'services') {
    ctaLabel = selectedStaff ? 'Выбрать время' : 'Выбрать специалиста';
    canProceed = selectedServices.length > 0;
  } else if (currentStep === 'staff') {
    ctaLabel = selectedServices.length > 0 ? 'Выбрать дату и время' : 'Выбрать услуги';
    canProceed = selectedStaff !== null;
  } else if (currentStep === 'datetime') {
    ctaLabel = selectedServices.length > 0 ? 'Указать контакты' : 'Выбрать услуги';
    canProceed = selectedSlot !== null;
  } else if (currentStep === 'confirm') {
    ctaLabel = 'Подтвердить запись';
    canProceed = true;
  }

  return (
    <aside
      style={{
        flex: '1 1 320px',
        maxWidth: '100%',
        minWidth: 0,
        position: 'sticky',
        top: '24px',
        boxSizing: 'border-box',
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: '16px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Ваша запись</h2>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ color: '#64748B' }}>Филиал: </span>
          <span style={{ fontWeight: 600 }}>{branch?.name || 'Главный филиал'}</span>
        </span>
      </div>

      <div style={{ height: '1px', background: '#E2E8F0' }} />

      {/* Summary Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '15px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ color: '#64748B' }}>Услуги:</span>
          <span style={{ color: '#0F172A', fontWeight: 600, textAlign: 'right' }}>
            {selectedServices.length > 0 ? `${selectedServices.length} шт.` : 'Не выбрано'}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ color: '#64748B' }}>Специалист:</span>
          <span style={{ color: '#0F172A', fontWeight: 600, textAlign: 'right' }}>{staffName}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ color: '#64748B' }}>Дата и время:</span>
          <span style={{ color: '#0F172A', fontWeight: 600, textAlign: 'right' }}>
            {formatSlotTime(selectedSlot?.starts_at_utc)}
          </span>
        </div>

        {totalDurationMinutes > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
            <span style={{ color: '#64748B' }}>Длительность:</span>
            <span style={{ color: '#0F172A', fontWeight: 600, textAlign: 'right' }}>
              ~{totalDurationMinutes} мин
            </span>
          </div>
        )}
      </div>

      {/* Price breakdown toggle */}
      {selectedServices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setBreakdownOpen(!breakdownOpen)}
            aria-expanded={breakdownOpen}
            style={{
              alignSelf: 'flex-start',
              padding: 0,
              border: 0,
              background: 'transparent',
              color: accentColor,
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {breakdownOpen ? 'Скрыть детали' : 'Состав стоимости'}
          </button>

          {breakdownOpen && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '12px 14px',
                borderRadius: '12px',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                fontSize: '14px',
              }}
            >
              {selectedServices.map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', color: '#475569' }}>
                  <span>{s.name}</span>
                  <span style={{ whiteSpace: 'nowrap', color: '#0F172A', fontWeight: 500 }}>
                    {(s.base_price_minor / 100).toLocaleString('ru-RU')} ₸
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Total amount */}
      <div style={{ height: '1px', background: '#E2E8F0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '16px', fontWeight: 600 }}>Итого:</span>
        <span style={{ fontSize: '24px', fontWeight: 800 }}>
          {(totalAmountMinor / 100).toLocaleString('ru-RU')} ₸
        </span>
      </div>

      {/* Next CTA button */}
      {currentStep !== 'confirm' && (
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          style={{
            height: '56px',
            border: 0,
            borderRadius: '12px',
            background: canProceed ? accentColor : '#E2E8F0',
            color: canProceed ? '#FFFFFF' : '#94A3B8',
            fontSize: '17px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: canProceed ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s ease',
          }}
        >
          {ctaLabel}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      )}
    </aside>
  );
};
