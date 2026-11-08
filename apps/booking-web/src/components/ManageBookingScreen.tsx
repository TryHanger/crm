import React, { useState, useEffect } from 'react';
import { PublicApiClient, PublicManageBookingResponse, SlotResponse } from '@crm/api-client';

interface ManageBookingScreenProps {
  token: string;
  api: PublicApiClient;
  onBackToBooking: () => void;
  accentColor?: string;
}

export const ManageBookingScreen: React.FC<ManageBookingScreenProps> = ({
  token,
  api,
  onBackToBooking,
  accentColor = '#2563EB',
}) => {
  const [booking, setBooking] = useState<PublicManageBookingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reschedule state
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [availableSlots, setAvailableSlots] = useState<SlotResponse[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotResponse | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Cancel state
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadBooking = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.getBookingManage(token);
      setBooking(res);
    } catch (err: any) {
      setError(err.message || 'Не удалось загрузить данные записи. Возможно, ссылка устарела.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBooking();
  }, [token]);

  // Load slots for reschedule
  useEffect(() => {
    if (!isRescheduling || !booking) return;

    let isCancelled = false;
    const fetchSlots = async () => {
      try {
        setIsLoadingSlots(true);
        const serviceIds = booking.service_ids && booking.service_ids.length > 0
          ? booking.service_ids
          : (booking.items || []).map((it: any) => it.service_id).filter(Boolean);

        const branchId = booking.branch_id;
        const staffId = booking.staff_id;

        if (branchId && serviceIds.length > 0) {
          const res = await api.searchAvailability({
            branch_id: branchId,
            service_ids: serviceIds,
            from_date: rescheduleDate,
            to_date: rescheduleDate,
            staff_id: staffId,
          });
          if (!isCancelled) {
            setAvailableSlots(res.slots || []);
          }
        }
      } catch (e: any) {
        if (!isCancelled) console.error('Failed to load reschedule slots', e);
      } finally {
        if (!isCancelled) setIsLoadingSlots(false);
      }
    };
    fetchSlots();

    return () => {
      isCancelled = true;
    };
  }, [isRescheduling, rescheduleDate, booking, api]);

  const handleConfirmReschedule = async () => {
    if (!selectedSlot) return;
    try {
      setIsLoading(true);
      setError(null);
      await api.rescheduleBooking(token, {
        new_starts_at_utc: selectedSlot.starts_at_utc,
        new_staff_id: selectedSlot.staff_id,
      });
      setIsRescheduling(false);
      setSelectedSlot(null);
      setActionMessage('Запись успешно перенесена на новое время!');
      await loadBooking();
    } catch (err: any) {
      setError(err.message || 'Ошибка при переносе записи');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await api.cancelBooking(token, { reason: cancelReason || 'Отмена клиентом' });
      setIsCancelling(false);
      setActionMessage('Запись успешно отменена.');
      await loadBooking();
    } catch (err: any) {
      setError(err.message || 'Не удалось отменить запись');
    } finally {
      setIsLoading(false);
    }
  };

  const formatCutoffMinutes = (minutes?: number) => {
    if (!minutes) return 'за 2 часа';
    if (minutes < 60) return `за ${minutes} минут`;
    const hours = Math.round(minutes / 60);
    if (hours === 1) return 'за 1 час';
    if (hours >= 2 && hours <= 4) return `за ${hours} часа`;
    return `за ${hours} часов`;
  };

  const formatDateTime = (isoString: string) => {
    const d = new Date(isoString);
    const dateFormatted = d.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Almaty',
    });
    const timeFormatted = d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Almaty',
    });
    return `${dateFormatted} в ${timeFormatted}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return { label: 'Подтверждена', bg: '#DCFCE7', text: '#15803D' };
      case 'cancelled':
        return { label: 'Отменена', bg: '#FEE2E2', text: '#B91C1C' };
      case 'completed':
        return { label: 'Завершена', bg: '#F1F5F9', text: '#475569' };
      case 'in_progress':
        return { label: 'В процессе', bg: '#DBEAFE', text: '#1D4ED8' };
      case 'arrived':
        return { label: 'Клиент прибыл', bg: '#FEF3C7', text: '#B45309' };
      default:
        return { label: status, bg: '#F1F5F9', text: '#475569' };
    }
  };

  if (isLoading && !booking) {
    return (
      <div style={{ maxWidth: '560px', margin: '60px auto', textAlign: 'center', padding: '24px' }}>
        <p style={{ color: '#64748B', fontSize: '16px' }}>Загружаем данные бронирования…</p>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div style={{ maxWidth: '560px', margin: '40px auto', padding: '24px' }}>
        <div
          role="alert"
          style={{
            padding: '20px',
            borderRadius: '16px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#991B1B',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '18px' }}>Ошибка загрузки записи</div>
          <div style={{ fontSize: '14px', lineHeight: 1.5 }}>{error}</div>
          <button
            type="button"
            onClick={onBackToBooking}
            style={{
              marginTop: '8px',
              padding: '10px 16px',
              borderRadius: '10px',
              background: '#991B1B',
              color: '#FFFFFF',
              border: 0,
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            Вернуться на главную
          </button>
        </div>
      </div>
    );
  }

  if (!booking) return null;

  const statusBadge = getStatusBadge(booking.status);
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
        gap: '20px',
      }}
    >
      {/* Back button */}
      <button
        type="button"
        onClick={onBackToBooking}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'none',
          border: 'none',
          padding: 0,
          color: '#64748B',
          fontSize: '15px',
          fontWeight: 500,
          cursor: 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>Новая запись</span>
      </button>

      {/* Title & Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#0F172A' }}>
            Управление записью
          </h1>
          <span style={{ fontSize: '14px', color: '#64748B' }}>Код визита: #{booking.public_ref}</span>
        </div>
        <span
          style={{
            padding: '6px 14px',
            borderRadius: '12px',
            background: statusBadge.bg,
            color: statusBadge.text,
            fontSize: '14px',
            fontWeight: 700,
          }}
        >
          {statusBadge.label}
        </span>
      </div>

      {actionMessage && (
        <div
          role="status"
          style={{
            padding: '14px 18px',
            borderRadius: '12px',
            background: '#F0FDF4',
            border: '1px solid #86EFAC',
            color: '#15803D',
            fontSize: '15px',
            fontWeight: 600,
          }}
        >
          {actionMessage}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: '14px 18px',
            borderRadius: '12px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#991B1B',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {/* Main Info Card */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '18px',
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
          padding: '22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Дата и время</span>
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', textTransform: 'capitalize' }}>
            {formatDateTime(booking.starts_at_utc)}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Клиент</span>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#0F172A' }}>
            {booking.customer_name} ({booking.customer_phone_masked})
          </span>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid #E2E8F0', margin: '2px 0' }} />

        {/* Services List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Услуги в заказе</span>
          {(booking.items || []).map((it: any, idx: number) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px' }}>
              <span style={{ color: '#0F172A', fontWeight: 500 }}>
                {it.service_name} ({it.duration_minutes} мин)
              </span>
              <span style={{ color: '#64748B' }}>
                {(it.price_minor / 100).toLocaleString('ru-RU')} ₸
              </span>
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
              paddingTop: '8px',
              borderTop: '1px dashed #E2E8F0',
            }}
          >
            <span>Итого</span>
            <span style={{ color: accentColor }}>{totalAmountFormatted}</span>
          </div>
        </div>
      </div>

      {/* Reschedule Block */}
      {isRescheduling ? (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '18px',
            border: '1px solid #E2E8F0',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Выберите новое время</h2>
            <button
              type="button"
              onClick={() => setIsRescheduling(false)}
              style={{ background: 'none', border: 0, color: '#64748B', cursor: 'pointer', fontSize: '14px' }}
            >
              Отмена
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Дата переноса</label>
            <input
              type="date"
              value={rescheduleDate}
              onChange={e => setRescheduleDate(e.target.value)}
              style={{
                height: '44px',
                padding: '0 12px',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '15px',
              }}
            />
          </div>

          {isLoadingSlots ? (
            <p style={{ color: '#64748B', fontSize: '14px' }}>Поиск свободных слотов…</p>
          ) : availableSlots.length === 0 ? (
            <p style={{ color: '#64748B', fontSize: '14px' }}>На выбранную дату нет свободных окон.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' }}>
              {availableSlots.map(s => {
                const isSelected = selectedSlot?.starts_at_utc === s.starts_at_utc;
                const d = new Date(s.starts_at_utc);
                const timeLabel = d.toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Almaty',
                });
                return (
                  <button
                    key={s.quote_id}
                    type="button"
                    onClick={() => setSelectedSlot(s)}
                    style={{
                      height: '42px',
                      borderRadius: '8px',
                      border: `1px solid ${isSelected ? accentColor : '#CBD5E1'}`,
                      background: isSelected ? accentColor : '#FFFFFF',
                      color: isSelected ? '#FFFFFF' : '#0F172A',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {timeLabel}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirmReschedule}
            disabled={!selectedSlot || isLoading}
            style={{
              height: '48px',
              borderRadius: '12px',
              border: 0,
              background: selectedSlot && !isLoading ? accentColor : '#CBD5E1',
              color: '#FFFFFF',
              fontSize: '16px',
              fontWeight: 600,
              cursor: selectedSlot && !isLoading ? 'pointer' : 'not-allowed',
            }}
          >
            {isLoading ? 'Сохраняем…' : 'Подтвердить перенос'}
          </button>
        </div>
      ) : isCancelling ? (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '18px',
            border: '1px solid #FCA5A5',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#991B1B' }}>
            Подтвердите отмену записи
          </h2>
          <p style={{ margin: 0, fontSize: '14px', color: '#64748B' }}>
            Вы уверены, что хотите отменить эту запись? Освобожденное время сразу станет доступно другим клиентам.
          </p>
          <input
            type="text"
            placeholder="Причина отмены (необязательно)"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            style={{
              height: '44px',
              padding: '0 12px',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              fontSize: '14px',
            }}
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={handleConfirmCancel}
              disabled={isLoading}
              style={{
                flex: 1,
                height: '48px',
                borderRadius: '12px',
                border: 0,
                background: '#DC2626',
                color: '#FFFFFF',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isLoading ? 'Отменяем…' : 'Да, отменить запись'}
            </button>
            <button
              type="button"
              onClick={() => setIsCancelling(false)}
              style={{
                flex: 1,
                height: '48px',
                borderRadius: '12px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#0F172A',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Назад
            </button>
          </div>
        </div>
      ) : (
        booking.status === 'confirmed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {booking.can_reschedule && (
              <button
                type="button"
                onClick={() => setIsRescheduling(true)}
                style={{
                  height: '50px',
                  borderRadius: '12px',
                  border: `1px solid ${accentColor}`,
                  background: '#FFFFFF',
                  color: accentColor,
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Перенести запись
              </button>
            )}

            {booking.can_cancel && (
              <button
                type="button"
                onClick={() => setIsCancelling(true)}
                style={{
                  height: '50px',
                  borderRadius: '12px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#DC2626',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Отменить запись
              </button>
            )}

            <div style={{ fontSize: '13px', color: '#64748B', textAlign: 'center' }}>
              Бесплатная отмена возможна не позднее чем {formatCutoffMinutes(booking.cancellation_cutoff_minutes)} до визита.
            </div>
          </div>
        )
      )}
    </main>
  );
};
