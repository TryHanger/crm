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
  const [rescheduleDate, setRescheduleDate] = useState<string>(new Date().toISOString().split('T')[0]);
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
      setError(err.message || 'Не удалось загрузить данные записи');
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

    const fetchSlots = async () => {
      try {
        setIsLoadingSlots(true);
        // Extract service ids from items if available
        const serviceIds = (booking.items || []).map((it: any) => it.service_id).filter(Boolean);
        const staffId = (booking.items || [])[0]?.staff_id;

        // Fetch branches to get default branch
        const branches = await api.getBranches();
        const branchId = branches[0]?.id;

        if (branchId && serviceIds.length > 0) {
          const res = await api.searchAvailability({
            branch_id: branchId,
            service_ids: serviceIds,
            from_date: rescheduleDate,
            to_date: rescheduleDate,
            staff_id: staffId,
          });
          setAvailableSlots(res.slots || []);
        }
      } catch (e: any) {
        console.error(e);
      } finally {
        setIsLoadingSlots(false);
      }
    };
    fetchSlots();
  }, [isRescheduling, rescheduleDate, booking, api]);

  const handleConfirmReschedule = async () => {
    if (!selectedSlot) return;
    try {
      setIsLoading(true);
      await api.rescheduleBooking(token, {
        new_starts_at_utc: selectedSlot.starts_at_utc,
      });
      setIsRescheduling(false);
      setActionMessage('Запись успешно перенесена на новое время!');
      await loadBooking();
    } catch (err: any) {
      setError(err.message || 'Ошибка переноса записи');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    try {
      setIsLoading(true);
      await api.cancelBooking(token, {
        reason: cancelReason || 'Отмена клиентом',
      });
      setIsCancelling(false);
      setActionMessage('Запись успешно отменена.');
      await loadBooking();
    } catch (err: any) {
      setError(err.message || 'Ошибка отмены записи');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <main style={{ maxWidth: '640px', margin: '0 auto', padding: '40px 24px' }}>
        <p style={{ color: '#64748B' }}>Загружаем данные записи…</p>
      </main>
    );
  }

  if (error || !booking) {
    return (
      <main style={{ maxWidth: '640px', margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ padding: '20px', borderRadius: '14px', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px' }}>Ошибка</h2>
          <p style={{ margin: 0 }}>{error || 'Запись не найдена'}</p>
        </div>
        <button
          type="button"
          onClick={onBackToBooking}
          style={{
            alignSelf: 'flex-start',
            height: '44px',
            padding: '0 16px',
            borderRadius: '10px',
            background: accentColor,
            color: '#FFFFFF',
            border: 0,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Вернуться на главную
        </button>
      </main>
    );
  }

  const isCancelled = booking.status === 'cancelled';
  const startD = new Date(booking.starts_at_utc);
  const dateFormatted = startD.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeFormatted = startD.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });

  return (
    <main
      style={{
        width: '100%',
        maxWidth: '720px',
        margin: '0 auto',
        padding: '32px 24px 56px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      <button
        type="button"
        onClick={onBackToBooking}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          color: '#475569',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          fontSize: '15px',
          fontWeight: 500,
        }}
      >
        ← Вернуться к записи
      </button>

      {actionMessage && (
        <div
          role="status"
          style={{
            padding: '16px 20px',
            borderRadius: '14px',
            background: '#F0FDF4',
            border: '1px solid #BBF7D0',
            color: '#166534',
            fontWeight: 600,
          }}
        >
          {actionMessage}
        </div>
      )}

      {/* Booking Header Card */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>
              Запись #{booking.public_ref}
            </h1>
          </div>
          <span
            style={{
              padding: '6px 14px',
              borderRadius: '999px',
              fontSize: '14px',
              fontWeight: 600,
              background: isCancelled ? '#FEE2E2' : '#DCFCE7',
              color: isCancelled ? '#B91C1C' : '#15803D',
            }}
          >
            {isCancelled ? 'Отменена' : 'Подтверждена'}
          </span>
        </div>

        <div style={{ height: '1px', background: '#E2E8F0' }} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', fontSize: '15px' }}>
          <div>
            <div style={{ fontSize: '13px', color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>
              Дата и время
            </div>
            <div style={{ fontWeight: 600, marginTop: '2px' }}>{dateFormatted} в {timeFormatted}</div>
          </div>
          <div>
            <div style={{ fontSize: '13px', color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>
              Клиент
            </div>
            <div style={{ fontWeight: 600, marginTop: '2px' }}>{booking.customer_name}</div>
            <div style={{ color: '#64748B', fontSize: '14px' }}>{booking.customer_phone_masked}</div>
          </div>
          <div>
            <div style={{ fontSize: '13px', color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>
              Стоимость
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px' }}>
              {(booking.total_amount_minor / 100).toLocaleString('ru-RU')} ₸
            </div>
          </div>
        </div>

        {booking.items && booking.items.length > 0 && (
          <div>
            <div style={{ fontSize: '13px', color: '#64748B', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px' }}>
              Услуги и мастер
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {booking.items.map((it: any, idx: number) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                  <span>• {it.service_name || 'Услуга'} ({it.staff_name || 'Мастер'})</span>
                  <span style={{ fontWeight: 600 }}>{((it.price_minor || 0) / 100).toLocaleString('ru-RU')} ₸</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons (only if not cancelled and allowed by policy) */}
      {!isCancelled && (
        <div style={{ display: 'flex', gap: '12px' }}>
          {booking.can_reschedule && (
            <button
              type="button"
              onClick={() => {
                setIsRescheduling(true);
                setIsCancelling(false);
              }}
              style={{
                flex: 1,
                height: '48px',
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
              onClick={() => {
                setIsCancelling(true);
                setIsRescheduling(false);
              }}
              style={{
                flex: 1,
                height: '48px',
                borderRadius: '12px',
                border: '1px solid #FCA5A5',
                background: '#FFFFFF',
                color: '#B91C1C',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Отменить запись
            </button>
          )}
        </div>
      )}

      {/* Reschedule View */}
      {isRescheduling && (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            border: `2px solid ${accentColor}`,
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Перенос на другое время</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600 }}>Выберите новую дату:</label>
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
                width: '200px',
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
              Выберите слот:
            </div>
            {isLoadingSlots ? (
              <p style={{ color: '#64748B' }}>Ищем слоты…</p>
            ) : availableSlots.length === 0 ? (
              <p style={{ color: '#64748B' }}>На эту дату нет свободных мест у мастера.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(85px, 1fr))', gap: '8px' }}>
                {availableSlots.map(s => {
                  const isSel = selectedSlot?.starts_at_utc === s.starts_at_utc;
                  const tStr = new Date(s.starts_at_utc).toLocaleTimeString('ru-RU', {
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
                        border: `1px solid ${isSel ? accentColor : '#CBD5E1'}`,
                        background: isSel ? accentColor : '#FFFFFF',
                        color: isSel ? '#FFFFFF' : '#0F172A',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {tStr}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button
              type="button"
              disabled={!selectedSlot}
              onClick={handleConfirmReschedule}
              style={{
                height: '46px',
                padding: '0 20px',
                borderRadius: '10px',
                background: selectedSlot ? accentColor : '#CBD5E1',
                color: '#FFFFFF',
                border: 0,
                fontWeight: 600,
                cursor: selectedSlot ? 'pointer' : 'not-allowed',
              }}
            >
              Подтвердить перенос
            </button>
            <button
              type="button"
              onClick={() => setIsRescheduling(false)}
              style={{
                height: '46px',
                padding: '0 16px',
                borderRadius: '10px',
                background: 'transparent',
                border: '1px solid #CBD5E1',
                cursor: 'pointer',
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Cancel View */}
      {isCancelling && (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            border: '2px solid #FCA5A5',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#B91C1C' }}>
            Подтверждение отмены
          </h2>
          <p style={{ margin: 0, color: '#475569' }}>
            Вы действительно хотите отменить запись? Освободившееся время станет доступно другим клиентам.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600 }}>Причина отмены (необязательно):</label>
            <input
              type="text"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Изменились планы"
              style={{
                height: '44px',
                padding: '0 12px',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '15px',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={handleConfirmCancel}
              style={{
                height: '46px',
                padding: '0 20px',
                borderRadius: '10px',
                background: '#B91C1C',
                color: '#FFFFFF',
                border: 0,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Да, отменить запись
            </button>
            <button
              type="button"
              onClick={() => setIsCancelling(false)}
              style={{
                height: '46px',
                padding: '0 16px',
                borderRadius: '10px',
                background: 'transparent',
                border: '1px solid #CBD5E1',
                cursor: 'pointer',
              }}
            >
              Не отменять
            </button>
          </div>
        </div>
      )}
    </main>
  );
};
