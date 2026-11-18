import React from 'react';
import { BranchResponse, ServiceItemResponse, StaffPublicResponse, SlotResponse } from '@crm/api-client';

export interface BookingErrorDetail {
  title: string;
  message: string;
  code?: string;
  alternativeSlots?: SlotResponse[];
  priceChange?: { oldPriceMinor: number; newPriceMinor: number };
}

interface ConfirmationStepProps {
  branch: BranchResponse | null;
  selectedServices: ServiceItemResponse[];
  selectedStaff: StaffPublicResponse | 'any' | null;
  selectedSlot: SlotResponse | null;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientNote: string;
  onChangeName: (val: string) => void;
  onChangePhone: (val: string) => void;
  onChangeEmail: (val: string) => void;
  onChangeNote: (val: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  error: BookingErrorDetail | null;
  onSelectAlternativeSlot?: (slot: SlotResponse) => void;
  onAcceptPriceChange?: () => void;
  onGoBackToSlots?: () => void;
  accentColor?: string;
}

export const ConfirmationStep: React.FC<ConfirmationStepProps> = ({
  branch,
  selectedServices,
  selectedStaff,
  selectedSlot,
  clientName,
  clientPhone,
  clientEmail,
  clientNote,
  onChangeName,
  onChangePhone,
  onChangeEmail,
  onChangeNote,
  onSubmit,
  isSubmitting,
  error,
  onSelectAlternativeSlot,
  onAcceptPriceChange,
  onGoBackToSlots,
  accentColor = 'var(--accent, #242424)',
}) => {
  const staffName =
    typeof selectedStaff === 'object' && selectedStaff !== null
      ? selectedStaff.display_name
      : selectedSlot?.staff_name || 'Любой свободный мастер';

  const formatSlotTime = (isoString?: string) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    const dateFormatted = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeFormatted = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
    return `${dateFormatted} в ${timeFormatted}`;
  };

  const formatShortTime = (isoString?: string) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
  };

  const totalAmountMinor = selectedSlot?.price_minor || selectedServices.reduce((sum, s) => sum + s.base_price_minor, 0);
  const totalDuration = selectedSlot?.duration_minutes || selectedServices.reduce((sum, s) => sum + s.base_duration_minutes, 0);

  const isValid = clientName.trim().length >= 2 && clientPhone.replace(/\D/g, '').length >= 10;

  const isSlotConflict =
    error?.code === 'SLOT_TAKEN' ||
    error?.code === 'SLOT_CONFLICT' ||
    error?.code === 'TIME_SLOT_UNAVAILABLE' ||
    Boolean(error?.alternativeSlots && error.alternativeSlots.length > 0) ||
    Boolean(error?.title?.includes('уже занят'));

  const isPriceChange =
    error?.code === 'QUOTE_CHANGED' ||
    error?.code === 'QUOTE_MISMATCH' ||
    Boolean(error?.priceChange);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '30px', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink, #202124)' }}>
          Контактные данные
        </h1>
        <p style={{ margin: 0, color: 'var(--muted, #646464)', fontSize: '15px' }}>
          Укажите контактные данные для связи и подтверждения бронирования
        </p>
      </div>

      {/* SPRINT M07: Concurrency Slot Conflict State */}
      {error && isSlotConflict && (
        <div
          role="alert"
          data-testid="slot-conflict-alert"
          style={{
            padding: '20px',
            borderRadius: '16px',
            background: '#FEF2F2',
            border: '2px solid #F87171',
            color: '#991B1B',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span style={{ fontSize: '24px', lineHeight: '1' }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: '17px', color: '#B91C1C' }}>
                {error.title || 'Выбранный слот только что занят'}
              </div>
              <div style={{ fontSize: '14px', lineHeight: 1.45, color: '#7F1D1D', marginTop: '4px' }}>
                {error.message || 'К сожалению, пока вы заполняли форму, этот слот уже успел занять другой клиент. Ваши контактные данные сохранены — выберите другое свободное время:'}
              </div>
            </div>
          </div>

          {/* Alternative Slots Selector */}
          {error.alternativeSlots && error.alternativeSlots.length > 0 && (
            <div style={{ background: '#FFFFFF', padding: '14px', borderRadius: '12px', border: '1px solid #FECACA' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#991B1B', marginBottom: '8px' }}>
                Ближайшие свободные слоты у мастера ({staffName}):
              </div>
              <div
                data-testid="alternative-slots-list"
                style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
              >
                {error.alternativeSlots.map((altSlot) => (
                  <button
                    key={altSlot.starts_at_utc}
                    type="button"
                    data-testid="alt-slot-item"
                    onClick={() => onSelectAlternativeSlot && onSelectAlternativeSlot(altSlot)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: '1px solid #EF4444',
                      background: '#FFF1F2',
                      color: '#B91C1C',
                      fontSize: '14px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#EF4444';
                      e.currentTarget.style.color = '#FFFFFF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#FFF1F2';
                      e.currentTarget.style.color = '#B91C1C';
                    }}
                  >
                    🕒 {formatShortTime(altSlot.starts_at_utc)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            {onGoBackToSlots && (
              <button
                type="button"
                data-testid="go-back-slots-btn"
                onClick={onGoBackToSlots}
                style={{
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: '1px solid #DC2626',
                  background: '#FFFFFF',
                  color: '#B91C1C',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ← Выбрать другое время в календаре
              </button>
            )}
          </div>
        </div>
      )}

      {/* SPRINT M07: Quote Changed / Price Update State */}
      {error && isPriceChange && !isSlotConflict && (
        <div
          role="alert"
          data-testid="quote-changed-alert"
          style={{
            padding: '18px 20px',
            borderRadius: '16px',
            background: '#FFFBEB',
            border: '2px solid #FCD34D',
            color: '#92400E',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span style={{ fontSize: '24px', lineHeight: '1' }}>💡</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: '17px', color: '#B45309' }}>
                {error.title || 'Условия или стоимость изменились'}
              </div>
              <div style={{ fontSize: '14px', lineHeight: 1.45, color: '#78350F', marginTop: '4px' }}>
                {error.message || 'Срок действия предварительного тарифа обновился. Пожалуйста, подтвердите новую стоимость перед записью.'}
              </div>
            </div>
          </div>

          {error.priceChange && (
            <div style={{ background: '#FFFFFF', padding: '12px 16px', borderRadius: '10px', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', gap: '16px', fontSize: '14px' }}>
              <div>
                <span style={{ color: '#6B7280' }}>Было: </span>
                <span style={{ textDecoration: 'line-through', color: '#9CA3AF', fontWeight: 600 }}>
                  {(error.priceChange.oldPriceMinor / 100).toLocaleString('ru-RU')} ₸
                </span>
              </div>
              <span style={{ fontSize: '18px', color: '#D97706' }}>→</span>
              <div>
                <span style={{ color: '#6B7280' }}>Стало: </span>
                <span style={{ fontWeight: 800, color: '#059669', fontSize: '16px' }}>
                  {(error.priceChange.newPriceMinor / 100).toLocaleString('ru-RU')} ₸
                </span>
              </div>
            </div>
          )}

          {onAcceptPriceChange && (
            <div>
              <button
                type="button"
                data-testid="accept-price-btn"
                onClick={onAcceptPriceChange}
                style={{
                  padding: '10px 18px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#D97706',
                  color: '#FFFFFF',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ✓ Принять новые условия и подтвердить
              </button>
            </div>
          )}
        </div>
      )}

      {/* Generic Error */}
      {error && !isSlotConflict && !isPriceChange && (
        <div
          role="alert"
          style={{
            padding: '16px 20px',
            borderRadius: '14px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#991B1B',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '16px' }}>{error.title}</div>
          <div style={{ fontSize: '14px', lineHeight: 1.4 }}>{error.message}</div>
        </div>
      )}

      {/* Summary card */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
            Детали визита
          </span>
          <span style={{ fontSize: '18px', fontWeight: 700 }}>
            {(totalAmountMinor / 100).toLocaleString('ru-RU')} ₸
          </span>
        </div>

        <div style={{ height: '1px', background: '#E2E8F0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '15px' }}>
          <div>
            <span style={{ color: '#64748B' }}>Филиал: </span>
            <span style={{ fontWeight: 600 }}>{branch?.name} ({branch?.address})</span>
          </div>
          <div>
            <span style={{ color: '#64748B' }}>Время: </span>
            <span style={{ fontWeight: 600 }}>{formatSlotTime(selectedSlot?.starts_at_utc)} ({totalDuration} мин)</span>
          </div>
          <div>
            <span style={{ color: '#64748B' }}>Специалист: </span>
            <span style={{ fontWeight: 600 }}>{staffName}</span>
          </div>
          <div>
            <span style={{ color: '#64748B' }}>Услуги: </span>
            <span style={{ fontWeight: 600 }}>{selectedServices.map(s => s.name).join(', ')}</span>
          </div>
        </div>
      </div>

      {/* Form Fields */}
      <div
        style={{
          background: 'var(--card, #FFFFFF)',
          borderRadius: 'var(--r, 20px)',
          border: '1px solid var(--hair, #D9D9D5)',
          boxShadow: 'var(--sh1)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink, #202124)' }}>
            Ваше имя <span style={{ color: 'var(--err, #C0392B)' }}>*</span>
          </label>
          <input
            type="text"
            value={clientName}
            onChange={e => onChangeName(e.target.value)}
            placeholder="Иван Петров"
            style={{
              height: '46px',
              padding: '0 16px',
              borderRadius: '12px',
              border: '1px solid var(--hair, #D9D9D5)',
              background: 'var(--tile, #F0F0EE)',
              fontSize: '15px',
              color: 'var(--ink, #202124)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink, #202124)' }}>
            Номер телефона <span style={{ color: 'var(--err, #C0392B)' }}>*</span>
          </label>
          <input
            type="tel"
            value={clientPhone}
            onChange={e => onChangePhone(e.target.value)}
            placeholder="+7 (701) 000-00-00"
            style={{
              height: '46px',
              padding: '0 16px',
              borderRadius: '12px',
              border: '1px solid var(--hair, #D9D9D5)',
              background: 'var(--tile, #F0F0EE)',
              fontSize: '15px',
              color: 'var(--ink, #202124)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink, #202124)' }}>
            Электронная почта <span style={{ color: 'var(--muted, #646464)', fontWeight: 400 }}>(по желанию)</span>
          </label>
          <input
            type="email"
            value={clientEmail}
            onChange={e => onChangeEmail(e.target.value)}
            placeholder="client@example.com"
            style={{
              height: '46px',
              padding: '0 16px',
              borderRadius: '12px',
              border: '1px solid var(--hair, #D9D9D5)',
              background: 'var(--tile, #F0F0EE)',
              fontSize: '15px',
              color: 'var(--ink, #202124)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink, #202124)' }}>
            Комментарий к визиту <span style={{ color: 'var(--muted, #646464)', fontWeight: 400 }}>(по желанию)</span>
          </label>
          <textarea
            value={clientNote}
            onChange={e => onChangeNote(e.target.value)}
            rows={2}
            placeholder="Особые пожелания, стрижка ножницами и т.д."
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              border: '1px solid var(--hair, #D9D9D5)',
              background: 'var(--tile, #F0F0EE)',
              fontSize: '15px',
              color: 'var(--ink, #202124)',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Policy note */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: 'var(--muted, #646464)' }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ flex: 'none', marginTop: '2px' }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            Запись подтверждается автоматически. Вы получите ссылку на самостоятельный перенос или отмену записи.
          </span>
        </div>

        {/* Submit button */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!isValid || isSubmitting}
          style={{
            height: '52px',
            border: 0,
            borderRadius: 'var(--r, 16px)',
            background: isValid && !isSubmitting ? accentColor : 'var(--tile, #F0F0EE)',
            color: isValid && !isSubmitting ? 'var(--on-accent, #FFFFFF)' : 'var(--muted, #646464)',
            boxShadow: isValid && !isSubmitting ? 'var(--sh-acc)' : 'none',
            fontSize: '16px',
            fontWeight: 600,
            cursor: isValid && !isSubmitting ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginTop: '8px',
            transition: 'background 0.15s ease',
          }}
        >
          {isSubmitting ? 'Оформляем запись…' : 'Подтвердить запись'}
        </button>
      </div>
    </div>
  );
};
