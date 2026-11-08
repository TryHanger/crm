import React, { useState } from 'react';
import { BookingCreatedResponse, BranchResponse, ServiceItemResponse, StaffPublicResponse } from '@crm/api-client';

interface ConfirmationScreenProps {
  booking: BookingCreatedResponse;
  branch: BranchResponse | null;
  services: ServiceItemResponse[];
  staff: StaffPublicResponse | 'any' | null;
  clientName: string;
  clientPhone: string;
  onManageClick: (token: string) => void;
  accentColor?: string;
}

export const ConfirmationScreen: React.FC<ConfirmationScreenProps> = ({
  booking,
  branch,
  services,
  staff,
  clientName,
  clientPhone,
  onManageClick,
  accentColor = '#2563EB',
}) => {
  const [calDownloaded, setCalDownloaded] = useState(false);

  const staffName =
    typeof staff === 'object' && staff !== null ? staff.display_name : 'Назначенный мастер';

  const formatDateTime = (isoString: string) => {
    const d = new Date(isoString);
    const dateFormatted = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeFormatted = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
    return { date: dateFormatted, time: timeFormatted };
  };

  const { date, time } = formatDateTime(booking.starts_at_utc);

  // Calculate duration in minutes between starts_at_utc and service_ends_at_utc
  const startMs = new Date(booking.starts_at_utc).getTime();
  const endMs = new Date(booking.service_ends_at_utc).getTime();
  const durationMins = Math.max(15, Math.round((endMs - startMs) / 60000));

  // Generate .ics file for calendar
  const handleDownloadICS = () => {
    const formatICSDate = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SaaS CRM//Booking Engine//RU',
      'BEGIN:VEVENT',
      `UID:${booking.booking_id}@saas-crm.com`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${formatICSDate(new Date(booking.starts_at_utc))}`,
      `DTEND:${formatICSDate(new Date(booking.service_ends_at_utc))}`,
      `SUMMARY:Запись в ${branch?.name || 'барбершоп'}`,
      `DESCRIPTION:Услуги: ${services.map(s => s.name).join(', ')}. Мастер: ${staffName}. Номер записи: ${booking.public_ref}`,
      `LOCATION:${branch?.address || ''}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `booking-${booking.public_ref}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setCalDownloaded(true);
  };

  return (
    <main
      style={{
        width: '100%',
        maxWidth: '760px',
        margin: '0 auto',
        padding: '32px 24px 56px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Success banner */}
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '14px',
          padding: '24px',
          borderRadius: '16px',
          background: '#F0FDF4',
          border: '1px solid #BBF7D0',
          color: '#166534',
        }}
      >
        <span
          style={{
            width: '48px',
            height: '48px',
            flex: 'none',
            borderRadius: '50%',
            background: '#DCFCE7',
            color: '#15803D',
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
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '28px', lineHeight: 1.25, fontWeight: 700 }}>
            Запись подтверждена!
          </h1>
          <span style={{ fontSize: '15px', lineHeight: 1.4, color: '#14532D' }}>
            Ждём вас по адресу филиала. Вы можете сохранить встречу в календарь или управлять ей по ссылке.
          </span>
        </div>
      </div>

      {/* Booking Details Card */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          padding: '24px',
          borderRadius: '16px',
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ color: '#64748B', fontSize: '14px' }}>Номер записи</span>
          <b style={{ fontSize: '18px', letterSpacing: '0.04em', color: '#0F172A' }}>
            #{booking.public_ref}
          </b>
        </div>

        <div style={{ height: '1px', background: '#E2E8F0' }} />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748B' }}>
            Где
          </span>
          <span style={{ fontSize: '16px', fontWeight: 600 }}>{branch?.name}</span>
          <span style={{ fontSize: '15px', color: '#475569' }}>{branch?.address}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748B' }}>
            Когда
          </span>
          <span style={{ fontSize: '16px', fontWeight: 600 }}>{date}</span>
          <span style={{ fontSize: '15px' }}>{time} · {durationMins} мин</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748B' }}>
            Мастер
          </span>
          <span style={{ fontSize: '16px', fontWeight: 600, overflowWrap: 'anywhere' }}>{staffName}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748B' }}>
            Клиент
          </span>
          <span style={{ fontSize: '16px', fontWeight: 600, overflowWrap: 'anywhere' }}>{clientName}</span>
          <span style={{ fontSize: '15px', color: '#475569' }}>{clientPhone}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748B' }}>
            Услуги
          </span>
          {services.map(s => (
            <span key={s.id} style={{ fontSize: '15px', overflowWrap: 'anywhere' }}>
              • {s.name}
            </span>
          ))}
        </div>

        <div style={{ height: '1px', background: '#E2E8F0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '16px', fontWeight: 600 }}>Итого</span>
          <span style={{ fontSize: '24px', fontWeight: 700 }}>
            {(booking.total_amount_minor / 100).toLocaleString('ru-RU')} ₸
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          type="button"
          onClick={handleDownloadICS}
          style={{
            minHeight: '52px',
            padding: '0 18px',
            border: 0,
            borderRadius: '12px',
            background: accentColor,
            color: '#FFFFFF',
            fontSize: '16px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {calDownloaded ? 'Календарь скачан ✓' : 'Добавить в календарь'}
        </button>

        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(branch?.address || '')}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            minHeight: '52px',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '12px',
            border: '1px solid #CBD5E1',
            background: '#FFFFFF',
            color: '#0F172A',
            fontSize: '16px',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Как добраться
        </a>

        <button
          type="button"
          onClick={() => onManageClick(booking.management_token)}
          style={{
            minHeight: '52px',
            padding: '0 18px',
            borderRadius: '12px',
            border: '1px solid #CBD5E1',
            background: '#FFFFFF',
            color: '#0F172A',
            fontSize: '16px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Управление записью (перенос / отмена)
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 4px', fontSize: '13px', color: '#64748B' }}>
        <span>Оплата производится на месте администратору удобным для вас способом.</span>
        <span>Бесплатная отмена возможна не позднее чем за 2 часа до начала визита.</span>
      </div>
    </main>
  );
};
