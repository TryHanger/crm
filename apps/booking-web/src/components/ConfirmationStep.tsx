import React from 'react';
import { BranchResponse, ServiceItemResponse, StaffPublicResponse, SlotResponse } from '@crm/api-client';

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
  error: { title: string; message: string } | null;
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
  accentColor = '#2563EB',
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

  const totalAmountMinor = selectedSlot?.price_minor || selectedServices.reduce((sum, s) => sum + s.base_price_minor, 0);
  const totalDuration = selectedSlot?.duration_minutes || selectedServices.reduce((sum, s) => sum + s.base_duration_minutes, 0);

  const isValid = clientName.trim().length >= 2 && clientPhone.replace(/\D/g, '').length >= 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '32px', lineHeight: 1.2, fontWeight: 700 }}>
          Контактные данные
        </h1>
        <p style={{ margin: 0, color: '#475569', fontSize: '16px' }}>
          Укажите телефон для SMS-напоминания и ссылки на управление записью
        </p>
      </div>

      {error && (
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
          background: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
            Ваше имя <span style={{ color: '#DC2626' }}>*</span>
          </label>
          <input
            type="text"
            value={clientName}
            onChange={e => onChangeName(e.target.value)}
            placeholder="Иван Петров"
            style={{
              height: '48px',
              padding: '0 16px',
              borderRadius: '12px',
              border: '1px solid #CBD5E1',
              fontSize: '16px',
              color: '#0F172A',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
            Номер телефона <span style={{ color: '#DC2626' }}>*</span>
          </label>
          <input
            type="tel"
            value={clientPhone}
            onChange={e => onChangePhone(e.target.value)}
            placeholder="+7 (701) 000-00-00"
            style={{
              height: '48px',
              padding: '0 16px',
              borderRadius: '12px',
              border: '1px solid #CBD5E1',
              fontSize: '16px',
              color: '#0F172A',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
            Электронная почта (необязательно)
          </label>
          <input
            type="email"
            value={clientEmail}
            onChange={e => onChangeEmail(e.target.value)}
            placeholder="client@example.com"
            style={{
              height: '48px',
              padding: '0 16px',
              borderRadius: '12px',
              border: '1px solid #CBD5E1',
              fontSize: '16px',
              color: '#0F172A',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
            Комментарий к визиту
          </label>
          <textarea
            value={clientNote}
            onChange={e => onChangeNote(e.target.value)}
            rows={2}
            placeholder="Особые пожелания, стрижка ножницами и т.д."
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              border: '1px solid #CBD5E1',
              fontSize: '15px',
              color: '#0F172A',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Policy note */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#64748B' }}>
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
            height: '56px',
            border: 0,
            borderRadius: '14px',
            background: isValid && !isSubmitting ? accentColor : '#CBD5E1',
            color: '#FFFFFF',
            fontSize: '17px',
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
