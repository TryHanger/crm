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
  cancellationCutoffMinutes?: number;
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
  cancellationCutoffMinutes = 120,
}) => {
  const [calDownloaded, setCalDownloaded] = useState(false);

  const staffName =
    typeof staff === 'object' && staff !== null ? staff.display_name : 'Назначенный мастер';

  const formatDateTime = (isoString: string) => {
    const d = new Date(isoString);
    const dateFormatted = d.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: branch?.timezone_iana || 'Asia/Almaty',
    });
    const timeFormatted = d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: branch?.timezone_iana || 'Asia/Almaty',
    });
    return `${dateFormatted} в ${timeFormatted}`;
  };

  const formatCutoffMinutes = (minutes: number) => {
    if (minutes < 60) return `за ${minutes} минут`;
    const hours = Math.round(minutes / 60);
    if (hours === 1) return 'за 1 час';
    if (hours >= 2 && hours <= 4) return `за ${hours} часа`;
    return `за ${hours} часов`;
  };

  // Generate and download .ics calendar event
  const downloadIcs = () => {
    const start = new Date(booking.starts_at_utc);
    const end = new Date(booking.service_ends_at_utc);

    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const formatIcsDate = (d: Date) =>
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

    const summary = `${branch?.name || 'Салон'} — ${services.map(s => s.name).join(', ')}`;
    const description = `Мастер: ${staffName}\\nКод записи: ${booking.public_ref}\\nТелефон клиента: ${clientPhone}`;
    const location = branch?.address || '';

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SaaS CRM Platform//Booking System//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${booking.booking_id}@crm.platform`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      `LOCATION:${location}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `booking-${booking.public_ref}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setCalDownloaded(true);
  };

  const totalAmountFormatted = `${(booking.total_amount_minor / 100).toLocaleString('ru-RU')} ₸`;

  return (
    <main
      style={{
        maxWidth: '560px',
        margin: '32px auto',
        padding: '0 16px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      {/* Success Badge & Title */}
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: '#DCFCE7',
            color: '#15803D',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 800, color: '#0F172A', lineHeight: 1.2 }}>
          Запись подтверждена!
        </h1>
        <p style={{ margin: 0, fontSize: '16px', color: '#64748B' }}>
          Мы ждем вас в назначенное время. Сохраните ссылку для управления визитом: вы сможете перенести или отменить запись в любое время.
        </p>
      </div>

      {/* Booking Details Card */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '20px',
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: '#F8FAFC',
            padding: '16px 20px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
            Номер визита
          </span>
          <span
            data-public-ref={booking.public_ref}
            data-booking-id={booking.booking_id}
            data-management-token={booking.management_token}
            style={{
              fontSize: '18px',
              fontWeight: 700,
              color: accentColor,
              letterSpacing: '0.04em',
              fontFamily: 'monospace',
            }}
          >
            #{booking.public_ref}
          </span>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Time & Date */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
            <span style={{ color: '#64748B', marginTop: '2px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 14 14" />
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Дата и время</span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#0F172A', textTransform: 'capitalize' }}>
                {formatDateTime(booking.starts_at_utc)}
              </span>
            </div>
          </div>

          {/* Master */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
            <span style={{ color: '#64748B', marginTop: '2px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Специалист</span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#0F172A' }}>{staffName}</span>
            </div>
          </div>

          {/* Location */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
            <span style={{ color: '#64748B', marginTop: '2px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Филиал и адрес</span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#0F172A' }}>
                {branch?.name || 'Главный филиал'}
              </span>
              <span style={{ fontSize: '14px', color: '#64748B' }}>{branch?.address}</span>
            </div>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid #E2E8F0', margin: '4px 0' }} />

          {/* Services list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Выбранные услуги</span>
            {services.map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px' }}>
                <span style={{ color: '#0F172A', fontWeight: 500 }}>{s.name}</span>
                <span style={{ color: '#64748B' }}>{s.price_formatted}</span>
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '17px',
                fontWeight: 700,
                color: '#0F172A',
                marginTop: '6px',
                paddingTop: '10px',
                borderTop: '1px dashed #E2E8F0',
              }}
            >
              <span>Итого к оплате</span>
              <span style={{ color: accentColor }}>{totalAmountFormatted}</span>
            </div>
          </div>

          {/* Client info */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              background: '#F8FAFC',
              fontSize: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748B' }}>Клиент:</span>
              <span style={{ fontWeight: 600, color: '#0F172A' }}>{clientName}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748B' }}>Телефон:</span>
              <span style={{ fontWeight: 600, color: '#0F172A' }}>{clientPhone}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <button
          type="button"
          onClick={downloadIcs}
          style={{
            height: '52px',
            borderRadius: '14px',
            border: 0,
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
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {calDownloaded ? 'Календарь скачан (.ics)' : 'Добавить в календарь'}
        </button>

        <button
          type="button"
          onClick={() => {
            const url = `${window.location.origin}/manage/${booking.management_token}`;
            navigator.clipboard?.writeText(url);
            alert('Ссылка на управление записью скопирована!');
          }}
          style={{
            minHeight: '48px',
            padding: '0 18px',
            borderRadius: '12px',
            border: '1px solid #CBD5E1',
            background: '#F8FAFC',
            color: '#0F172A',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Скопировать ссылку управления визитом
        </button>

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
        <span>Бесплатная отмена возможна не позднее чем {formatCutoffMinutes(cancellationCutoffMinutes)} до начала визита.</span>
      </div>
    </main>
  );
};
