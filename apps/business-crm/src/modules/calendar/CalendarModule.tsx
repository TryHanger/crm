import React, { useState } from 'react';
import { CalendarBooking, CalendarStaff, CalendarBlockItem } from '../../types';
import { BusinessCrmApiClient } from '@crm/api-client';

export function localToUtcIso(dateStr: string, timeStr: string, timeZone: string = 'Asia/Almaty'): string {
  if (!dateStr || !timeStr) {
    throw new Error(`Missing dateStr or timeStr in localToUtcIso: dateStr='${dateStr}', timeStr='${timeStr}'`);
  }
  const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, min, sec] = cleanTime.split(':').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(min)) {
    throw new Error(`Invalid numeric parts in localToUtcIso: dateStr='${dateStr}', timeStr='${timeStr}'`);
  }

  const targetWallMs = Date.UTC(year, month - 1, day, hour, min, sec || 0);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const getWallMs = (utcDate: Date): number => {
    const parts = formatter.formatToParts(utcDate);
    const m: Record<string, string> = {};
    for (const p of parts) m[p.type] = p.value;
    let h = Number(m.hour);
    if (h === 24) h = 0;
    return Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), h, Number(m.minute), Number(m.second));
  };

  let guessUtcMs = targetWallMs;
  let wallMs = getWallMs(new Date(guessUtcMs));
  let diff = targetWallMs - wallMs;
  guessUtcMs += diff;

  wallMs = getWallMs(new Date(guessUtcMs));
  diff = targetWallMs - wallMs;
  guessUtcMs += diff;

  return new Date(guessUtcMs).toISOString();
}

export function getLocalHourAndMinute(date: Date | string, timeZone: string): { hour: number; minute: number } {
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
  }
  if (hour === 24) hour = 0;
  return { hour, minute };
}

export function formatTimeInZone(date: Date | string, timeZone: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

export function getWeekDates(dateStr: string): string[] {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = targetDate.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(targetDate);
  monday.setUTCDate(targetDate.getUTCDate() + diffToMonday);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setUTCDate(monday.getUTCDate() + i);
    dates.push(cur.toISOString().split('T')[0]);
  }
  return dates;
}


interface CalendarModuleProps {
  api: BusinessCrmApiClient;
  token: string;
  tenantId: string;
  branchId: string;
  currentDate: string;
  onDateChange: (date: string) => void;
  staffList: CalendarStaff[];
  bookings: CalendarBooking[];
  blocks?: CalendarBlockItem[];
  isLoading: boolean;
  onRefresh: () => void;
  onShowToast: (msg: string) => void;
  userRole: string;
  timezoneIana?: string;
}

export const CalendarModule: React.FC<CalendarModuleProps> = ({
  api,
  token,
  tenantId,
  branchId,
  currentDate,
  onDateChange,
  staffList,
  bookings,
  blocks = [],
  isLoading,
  onRefresh,
  onShowToast,
  userRole,
  timezoneIana = 'Asia/Almaty',
}) => {
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'list'>('day');
  const [weekData, setWeekData] = useState<Record<string, CalendarBooking[]>>({});
  const [isLoadingWeek, setIsLoadingWeek] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);

  const weekDates = getWeekDates(currentDate);

  const loadWeekBookings = React.useCallback(async (dates: string[]) => {
    if (!branchId || !token || !tenantId) return;
    setIsLoadingWeek(true);
    setWeekError(null);
    try {
      let hasError = false;
      let lastErrMsg = '';
      const results = await Promise.all(
        dates.map(async (d) => {
          try {
            const cal = await api.getCalendar({ date: d, branch_id: branchId }, token, tenantId);
            const mapped: CalendarBooking[] = (cal.bookings || []).map((b: any) => ({
              id: b.id,
              starts_at_utc: b.starts_at_utc,
              service_ends_at_utc: b.service_ends_at_utc,
              customer_name: b.customer_name || 'Клиент',
              customer_phone: b.customer_phone || '',
              staff_id: b.staff_id,
              status: b.status,
              amount_minor: b.amount_minor,
              public_ref: b.public_ref,
              services: b.services || ['Визит'],
            }));
            return { date: d, bookings: mapped, ok: true };
          } catch (err: any) {
            hasError = true;
            lastErrMsg = err?.message || 'Ошибка сети или API';
            return { date: d, bookings: [], ok: false };
          }
        })
      );
      if (hasError) {
        setWeekError(`Не удалось загрузить данные части дней расписания (${lastErrMsg}).`);
      }
      const map: Record<string, CalendarBooking[]> = {};
      for (const r of results) {
        map[r.date] = r.bookings;
      }
      setWeekData(map);
    } catch (e: any) {
      setWeekError(e?.message || 'Ошибка загрузки недели');
    } finally {
      setIsLoadingWeek(false);
    }
  }, [api, branchId, token, tenantId]);

  React.useEffect(() => {
    if (viewMode === 'week') {
      const dates = getWeekDates(currentDate);
      loadWeekBookings(dates);
    }
  }, [viewMode, currentDate, branchId, loadWeekBookings]);
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('all');
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Modals state
  const [showNewBookingModal, setShowNewBookingModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  // New booking form
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newStaffId, setNewStaffId] = useState('');
  const [newTime, setNewTime] = useState('11:00');
  const [newServiceIds, setNewServiceIds] = useState<string[]>([]);
  const [allServices, setAllServices] = useState<any[]>([]);

  // Cancel & Reschedule state
  const [cancelReason, setCancelReason] = useState('Отмена по просьбе клиента');
  const [rescheduleDate, setRescheduleDate] = useState(currentDate);
  const [rescheduleTime, setRescheduleTime] = useState('12:00');

  // Block modal state
  const [blockStaffId, setBlockStaffId] = useState('');
  const [blockStart, setBlockStart] = useState('14:00');
  const [blockEnd, setBlockEnd] = useState('15:00');
  const [blockReason, setBlockReason] = useState('Перерыв на обед');

  const hours = Array.from({ length: 12 }, (_, i) => i + 9); // 09:00 .. 20:00

  // Date step handlers
  const handlePrevDay = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 1);
    onDateChange(d.toISOString().split('T')[0]);
  };

  const handleNextDay = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 1);
    onDateChange(d.toISOString().split('T')[0]);
  };

  const handleToday = () => {
    onDateChange(new Date().toISOString().split('T')[0]);
  };

  const filteredStaff = selectedStaffFilter === 'all'
    ? staffList
    : staffList.filter(s => s.id === selectedStaffFilter);

  // Open New Booking Modal
  const handleOpenNewBooking = async () => {
    try {
      const svcs = await api.getServices({ branch_id: branchId }, token, tenantId);
      setAllServices(svcs);
      if (svcs.length > 0) setNewServiceIds([svcs[0].id]);
      if (staffList.length > 0) setNewStaffId(staffList[0].id);
      setShowNewBookingModal(true);
    } catch (err: any) {
      alert(`Ошибка загрузки услуг: ${err.message || err}`);
    }
  };

  // Submit New Booking
  const handleCreateBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim() || !newCustPhone.trim() || !newStaffId || newServiceIds.length === 0) {
      alert('Заполните все обязательные поля');
      return;
    }

    try {
      const startsAtUtc = localToUtcIso(currentDate, newTime, timezoneIana);
      await api.createBooking(
        {
          branch_id: branchId,
          staff_id: newStaffId,
          service_ids: newServiceIds,
          starts_at_utc: startsAtUtc,
          customer_name: newCustName.trim(),
          customer_phone: newCustPhone.trim(),
        },
        token,
        tenantId
      );

      setShowNewBookingModal(false);
      onShowToast('Запись успешно создана');
      onRefresh();
    } catch (err: any) {
      alert(`Ошибка создания записи: ${err.message || err}`);
    }
  };

  // Status transition handler (PATCH)
  const handleUpdateStatus = async (targetStatus: string) => {
    if (!selectedBooking) return;
    try {
      setIsUpdatingStatus(true);
      await api.updateBookingStatus(
        selectedBooking.id,
        { status: targetStatus },
        token,
        tenantId
      );
      onShowToast(`Статус обновлен на «${targetStatus}»`);
      setSelectedBooking(null);
      onRefresh();
    } catch (err: any) {
      alert(`Ошибка обновления статуса: ${err.message || err}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Cancel Booking
  const handleCancelBooking = async () => {
    if (!selectedBooking) return;
    try {
      setIsUpdatingStatus(true);
      await api.cancelBooking(selectedBooking.id, { reason: cancelReason }, token, tenantId);
      setShowCancelModal(false);
      setSelectedBooking(null);
      onShowToast('Запись отменена');
      onRefresh();
    } catch (err: any) {
      alert(`Ошибка отмены: ${err.message || err}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Reschedule Booking
  const handleRescheduleBooking = async () => {
    if (!selectedBooking) return;
    try {
      setIsUpdatingStatus(true);
      const newStartsAt = localToUtcIso(rescheduleDate, rescheduleTime, timezoneIana);
      await api.rescheduleBooking(selectedBooking.id, { starts_at_utc: newStartsAt }, token, tenantId);
      setShowRescheduleModal(false);
      setSelectedBooking(null);
      onShowToast('Запись перенесена');
      onRefresh();
    } catch (err: any) {
      alert(`Ошибка переноса: ${err.message || err}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Create Calendar Block
  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockStaffId) return;
    try {
      await api.createCalendarBlock(
        {
          branch_id: branchId,
          staff_id: blockStaffId,
          starts_at_utc: localToUtcIso(currentDate, blockStart, timezoneIana),
          ends_at_utc: localToUtcIso(currentDate, blockEnd, timezoneIana),
          block_reason: blockReason,
        },
        token,
        tenantId
      );
      setShowBlockModal(false);
      onShowToast('Блокировка времени добавлена');
      onRefresh();
    } catch (err: any) {
      alert(`Ошибка создания блокировки: ${err.message || err}`);
    }
  };

  // Format status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return { bg: '#DCFCE7', text: '#166534', label: 'Подтверждена' };
      case 'arrived':
        return { bg: '#FEF3C7', text: '#92400E', label: 'Прибыл' };
      case 'in_progress':
        return { bg: '#DBEAFE', text: '#1E40AF', label: 'В работе' };
      case 'completed':
        return { bg: '#F1F5F9', text: '#475569', label: 'Завершен' };
      case 'cancelled':
        return { bg: '#FEE2E2', text: '#991B1B', label: 'Отменен' };
      default:
        return { bg: '#F1F5F9', text: '#0F172A', label: status };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Calendar Toolbar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          background: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          gap: '12px',
        }}
      >
        {/* Date Navigation & View switchers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handlePrevDay}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={handleToday}
            style={{
              height: '34px',
              padding: '0 12px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={handleNextDay}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ›
          </button>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#0F172A', marginLeft: '6px' }}>
            {new Date(currentDate).toLocaleDateString('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        </div>

        {/* View Mode Switcher (День / Неделя / Список) & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              display: 'flex',
              background: '#F1F5F9',
              padding: '3px',
              borderRadius: '10px',
              gap: '2px',
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('day')}
              style={{
                border: 'none',
                background: viewMode === 'day' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'day' ? '#0F172A' : '#64748B',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: viewMode === 'day' ? 600 : 500,
                boxShadow: viewMode === 'day' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                cursor: 'pointer',
              }}
            >
              День
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              style={{
                border: 'none',
                background: viewMode === 'week' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'week' ? '#0F172A' : '#64748B',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: viewMode === 'week' ? 600 : 500,
                boxShadow: viewMode === 'week' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                cursor: 'pointer',
              }}
            >
              Неделя
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              style={{
                border: 'none',
                background: viewMode === 'list' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'list' ? '#0F172A' : '#64748B',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: viewMode === 'list' ? 600 : 500,
                boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                cursor: 'pointer',
              }}
            >
              Список
            </button>
          </div>

          {userRole !== 'master' && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (staffList.length > 0) setBlockStaffId(staffList[0].id);
                  setShowBlockModal(true);
                }}
                style={{
                  height: '36px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#334155',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                + Блокировка
              </button>
              <button
                type="button"
                onClick={handleOpenNewBooking}
                style={{
                  height: '36px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Запись
              </button>
            </>
          )}
        </div>
      </div>

      {/* Staff Filter Bar */}
      {staffList.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 24px',
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedStaffFilter('all')}
            style={{
              padding: '4px 10px',
              borderRadius: '999px',
              border: 'none',
              background: selectedStaffFilter === 'all' ? '#0F172A' : '#F1F5F9',
              color: selectedStaffFilter === 'all' ? '#FFFFFF' : '#334155',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Все мастера ({staffList.length})
          </button>
          {staffList.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedStaffFilter(s.id)}
              style={{
                padding: '4px 10px',
                borderRadius: '999px',
                border: 'none',
                background: selectedStaffFilter === s.id ? '#0F172A' : '#F1F5F9',
                color: selectedStaffFilter === s.id ? '#FFFFFF' : '#334155',
                fontSize: '12px',
                fontWeight: selectedStaffFilter === s.id ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Main Calendar Viewport */}
      <div style={{ flex: 1, position: 'relative', overflow: 'auto', display: 'flex' }}>
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(255,255,255,0.7)',
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: 500,
              color: '#64748B',
            }}
          >
            Загрузка календаря…
          </div>
        )}

        {/* 1. Day View: Master Grid */}
        {viewMode === 'day' && (
          <div style={{ flex: 1, display: 'flex', minWidth: `${filteredStaff.length * 200 + 60}px` }}>
            {/* Time labels column */}
            <div
              style={{
                width: '60px',
                borderRight: '1px solid #E2E8F0',
                background: '#FFFFFF',
                flexShrink: 0,
              }}
            >
              <div style={{ height: '54px', borderBottom: '1px solid #E2E8F0' }} />
              {hours.map(h => (
                <div
                  key={h}
                  style={{
                    height: '80px',
                    padding: '6px 8px',
                    fontSize: '12px',
                    color: '#64748B',
                    fontWeight: 500,
                    textAlign: 'right',
                    borderBottom: '1px dashed #F1F5F9',
                    boxSizing: 'border-box',
                  }}
                >
                  {`${h}:00`}
                </div>
              ))}
            </div>

            {/* Staff Columns */}
            {filteredStaff.map(staff => {
              const staffBookings = bookings.filter(b => b.staff_id === staff.id);
              const staffBlocks = blocks.filter(b => b.staff_id === staff.id);

              return (
                <div
                  key={staff.id}
                  style={{
                    flex: '1 0 200px',
                    borderRight: '1px solid #E2E8F0',
                    background: '#FFFFFF',
                    position: 'relative',
                  }}
                >
                  {/* Staff Header */}
                  <div
                    style={{
                      height: '54px',
                      padding: '8px 12px',
                      borderBottom: '1px solid #E2E8F0',
                      background: '#F8FAFC',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: staff.color || '#3B82F6',
                        color: '#FFFFFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}
                    >
                      {(staff.name || 'СП').slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {staff.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748B' }}>
                        {staff.role_title || 'Барбер'}
                      </div>
                    </div>
                  </div>

                  {/* Hourly Grid Rows */}
                  {hours.map(h => (
                    <div
                      key={h}
                      style={{
                        height: '80px',
                        borderBottom: '1px dashed #F1F5F9',
                        boxSizing: 'border-box',
                      }}
                    />
                  ))}

                  {/* Booking Cards placed in Column */}
                  {staffBookings.map(b => {
                    const startDate = new Date(b.starts_at_utc);
                    const endDate = new Date(b.service_ends_at_utc);
                    const { hour: startH, minute: startM } = getLocalHourAndMinute(startDate, timezoneIana);
                    const { hour: endH, minute: endM } = getLocalHourAndMinute(endDate, timezoneIana);

                    const top = (startH - 9) * 80 + (startM / 60) * 80 + 54;
                    const durationM = (endH - startH) * 60 + (endM - startM);
                    const height = Math.max((durationM / 60) * 80 - 4, 40);

                    const badge = getStatusBadge(b.status);

                    return (
                      <div
                        key={b.id}
                        data-booking-id={b.id}
                        data-public-ref={b.public_ref}
                        onClick={() => setSelectedBooking(b)}
                        style={{
                          position: 'absolute',
                          top: `${top}px`,
                          left: '4px',
                          right: '4px',
                          height: `${height}px`,
                          background: b.status === 'cancelled' ? '#FEF2F2' : '#EFF6FF',
                          border: `1px ${b.status === 'cancelled' ? 'dashed #FCA5A5' : 'solid #93C5FD'}`,
                          borderLeft: `4px solid ${b.status === 'cancelled' ? '#EF4444' : '#2563EB'}`,
                          borderRadius: '8px',
                          padding: '6px 8px',
                          boxSizing: 'border-box',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          overflow: 'hidden',
                          zIndex: 10,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>
                            {startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezoneIana })}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              background: badge.bg,
                              color: badge.text,
                              padding: '1px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {b.customer_name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {b.services.join(', ')} · {(b.amount_minor / 100).toLocaleString('ru-RU')} ₸
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* 2. Real Week View */}
        {viewMode === 'week' && (
          <div style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#0F172A' }}>
                  Недельный обзор расписания ({weekDates[0]} – {weekDates[6]})
                </h2>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  Часовой пояс филиала: {timezoneIana}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    const prevMon = new Date(weekDates[0]);
                    prevMon.setDate(prevMon.getDate() - 7);
                    onDateChange(prevMon.toISOString().split('T')[0]);
                  }}
                  style={{ padding: '6px 14px', background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
                >
                  ← Предыдущая неделя
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextMon = new Date(weekDates[0]);
                    nextMon.setDate(nextMon.getDate() + 7);
                    onDateChange(nextMon.toISOString().split('T')[0]);
                  }}
                  style={{ padding: '6px 14px', background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
                >
                  Следующая неделя →
                </button>
              </div>
            </div>

            {weekError && (
              <div style={{ padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', color: '#B91C1C', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontSize: '13px' }}>⚠️ {weekError}</span>
                <button
                  type="button"
                  onClick={() => loadWeekBookings(weekDates)}
                  style={{ padding: '6px 14px', background: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Повторить загрузку
                </button>
              </div>
            )}

            {isLoadingWeek ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
                Загрузка недельного расписания команды...
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(130px, 1fr))', gap: '8px', overflowX: 'auto', paddingBottom: '12px' }}>
                {weekDates.map((dateStr, idx) => {
                  const dayBookings = (weekData[dateStr] || []).filter(b => {
                    if (selectedStaffFilter === 'all') return true;
                    return b.staff_id === selectedStaffFilter;
                  });
                  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
                  const [y, m, d] = dateStr.split('-').map(Number);
                  const isCurrent = dateStr === currentDate;
                  const isToday = dateStr === new Date().toISOString().split('T')[0];

                  return (
                    <div
                      key={dateStr}
                      data-date={dateStr}
                      style={{
                        background: isCurrent ? '#F8FAFC' : '#FFFFFF',
                        border: isCurrent ? '2px solid #2563EB' : '1px solid #E2E8F0',
                        borderRadius: '12px',
                        padding: '12px',
                        minHeight: '320px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      }}
                    >
                      <div
                        onClick={() => onDateChange(dateStr)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: '1px solid #F1F5F9',
                          paddingBottom: '8px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, fontSize: '14px', color: '#0F172A' }}>{dayNames[idx]}</span>
                          <span style={{ fontSize: '12px', color: '#64748B' }}>{d}</span>
                        </div>
                        {isToday && (
                          <span style={{ fontSize: '10px', fontWeight: 700, background: '#EFF6FF', color: '#2563EB', padding: '2px 6px', borderRadius: '4px' }}>
                            Сегодня
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '12px', fontWeight: 600, color: dayBookings.length > 0 ? '#2563EB' : '#94A3B8' }}>
                        Записей: {dayBookings.length}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
                        {dayBookings.map(b => {
                          const badge = getStatusBadge(b.status);
                          const startTime = formatTimeInZone(b.starts_at_utc, timezoneIana);
                          const endTime = formatTimeInZone(b.service_ends_at_utc, timezoneIana);
                          const staff = staffList.find(s => s.id === b.staff_id);

                          return (
                            <div
                              key={b.id}
                              data-booking-id={b.id}
                              data-public-ref={b.public_ref}
                              onClick={() => setSelectedBooking(b)}
                              style={{
                                padding: '8px',
                                background: '#FFFFFF',
                                border: '1px solid #CBD5E1',
                                borderLeft: `3px solid ${staff?.color || '#2563EB'}`,
                                borderRadius: '8px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                cursor: 'pointer',
                                transition: 'box-shadow 0.15s',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                                <span style={{ fontWeight: 700, color: '#0F172A' }}>{startTime}–{endTime}</span>
                                <span style={{ fontSize: '9px', fontWeight: 600, padding: '1px 4px', borderRadius: '3px', background: badge.bg, color: badge.text }}>
                                  {badge.label}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {b.customer_name}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {b.services[0] || 'Визит'} · {staff?.name || 'Мастер'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 3. List View (Таблица записей) */}
        {viewMode === 'list' && (
          <div style={{ flex: 1, padding: '24px', background: '#FFFFFF' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>
                  <th style={{ padding: '10px 12px' }}>Код</th>
                  <th style={{ padding: '10px 12px' }}>Время</th>
                  <th style={{ padding: '10px 12px' }}>Клиент</th>
                  <th style={{ padding: '10px 12px' }}>Телефон</th>
                  <th style={{ padding: '10px 12px' }}>Мастер</th>
                  <th style={{ padding: '10px 12px' }}>Услуги</th>
                  <th style={{ padding: '10px 12px' }}>Сумма</th>
                  <th style={{ padding: '10px 12px' }}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {bookings.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
                      Нет записей на выбранную дату
                    </td>
                  </tr>
                ) : (
                  bookings.map(b => {
                    const badge = getStatusBadge(b.status);
                    const masterName = staffList.find(s => s.id === b.staff_id)?.name || 'Мастер';
                    return (
                      <tr
                        key={b.id}
                        onClick={() => setSelectedBooking(b)}
                        style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }}
                      >
                        <td style={{ padding: '12px', fontWeight: 600 }}>{b.public_ref}</td>
                        <td style={{ padding: '12px' }}>
                          {new Date(b.starts_at_utc).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezoneIana })}
                        </td>
                        <td style={{ padding: '12px', fontWeight: 600 }}>{b.customer_name}</td>
                        <td style={{ padding: '12px' }}>{b.customer_phone}</td>
                        <td style={{ padding: '12px' }}>{masterName}</td>
                        <td style={{ padding: '12px' }}>{b.services.join(', ')}</td>
                        <td style={{ padding: '12px', fontWeight: 600 }}>
                          {(b.amount_minor / 100).toLocaleString('ru-RU')} ₸
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              fontSize: '12px',
                              background: badge.bg,
                              color: badge.text,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontWeight: 600,
                            }}
                          >
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected Booking Detail Modal */}
      {selectedBooking && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '460px',
              background: '#FFFFFF',
              borderRadius: '20px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 700 }}>Карточка записи</div>
              <button
                type="button"
                onClick={() => setSelectedBooking(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px' }}>
              <div><b>Код бронирования:</b> {selectedBooking.public_ref}</div>
              <div><b>Клиент:</b> {selectedBooking.customer_name}</div>
              <div><b>Телефон:</b> {selectedBooking.customer_phone}</div>
              <div><b>Услуги:</b> {selectedBooking.services.join(', ')}</div>
              <div><b>Сумма:</b> {(selectedBooking.amount_minor / 100).toLocaleString('ru-RU')} ₸</div>
              <div><b>Статус:</b> {selectedBooking.status}</div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #E2E8F0', paddingTop: '16px' }}>
              {selectedBooking.status === 'confirmed' && (
                <button
                  type="button"
                  onClick={() => handleUpdateStatus('arrived')}
                  disabled={isUpdatingStatus}
                  style={{
                    height: '42px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#D97706',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Клиент прибыл
                </button>
              )}
              {selectedBooking.status === 'arrived' && (
                <button
                  type="button"
                  onClick={() => handleUpdateStatus('in_progress')}
                  disabled={isUpdatingStatus}
                  style={{
                    height: '42px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Начать визит
                </button>
              )}
              {selectedBooking.status === 'in_progress' && (
                <button
                  type="button"
                  onClick={() => handleUpdateStatus('completed')}
                  disabled={isUpdatingStatus}
                  style={{
                    height: '42px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#059669',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Завершить визит
                </button>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowRescheduleModal(true)}
                  style={{
                    flex: 1,
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Перенести
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelModal(true)}
                  style={{
                    flex: 1,
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #FCA5A5',
                    background: '#FEF2F2',
                    color: '#991B1B',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Отменить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && selectedBooking && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            zIndex: 110,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '400px',
              background: '#FFFFFF',
              borderRadius: '16px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Подтверждение отмены записи</h3>
            <p style={{ margin: 0, fontSize: '14px', color: '#64748B' }}>
              Запись {selectedBooking.public_ref} будет отменена, а временной интервал освобожден.
            </p>
            <input
              type="text"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Причина отмены"
              style={{
                height: '40px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                fontSize: '14px',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
              >
                Назад
              </button>
              <button
                type="button"
                onClick={handleCancelBooking}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#EF4444', color: '#FFFFFF', fontWeight: 600 }}
              >
                Подтвердить отмену
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {showRescheduleModal && selectedBooking && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            zIndex: 110,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '400px',
              background: '#FFFFFF',
              borderRadius: '16px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Перенос записи</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Новая дата</label>
              <input
                type="date"
                value={rescheduleDate}
                onChange={e => setRescheduleDate(e.target.value)}
                style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Новое время</label>
              <input
                type="time"
                value={rescheduleTime}
                onChange={e => setRescheduleTime(e.target.value)}
                style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowRescheduleModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
              >
                Назад
              </button>
              <button
                type="button"
                onClick={handleRescheduleBooking}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 600 }}
              >
                Перенести запись
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Booking Modal */}
      {showNewBookingModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <form
            onSubmit={handleCreateBookingSubmit}
            style={{
              width: '100%',
              maxWidth: '460px',
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Новая запись</h3>
              <button
                type="button"
                onClick={() => setShowNewBookingModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Имя клиента</label>
              <input
                type="text"
                value={newCustName}
                onChange={e => setNewCustName(e.target.value)}
                placeholder="Айбек Жумабаев"
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Телефон</label>
              <input
                type="tel"
                value={newCustPhone}
                onChange={e => setNewCustPhone(e.target.value)}
                placeholder="+7 (701) 234-56-78"
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Мастер</label>
              <select
                value={newStaffId}
                onChange={e => setNewStaffId(e.target.value)}
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              >
                {staffList.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.role_title || 'Барбер'})</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Время визита</label>
              <input
                type="time"
                value={newTime}
                onChange={e => setNewTime(e.target.value)}
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Услуги</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                {allServices.map(s => {
                  const isChecked = newServiceIds.includes(s.id);
                  return (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            setNewServiceIds(newServiceIds.filter(id => id !== s.id));
                          } else {
                            setNewServiceIds([...newServiceIds, s.id]);
                          }
                        }}
                      />
                      <span>{s.name} — {(s.base_price_minor / 100).toLocaleString('ru-RU')} ₸</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setShowNewBookingModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#FFFFFF', fontWeight: 600 }}
              >
                Создать бронь
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Block Time Modal */}
      {showBlockModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <form
            onSubmit={handleCreateBlock}
            style={{
              width: '100%',
              maxWidth: '400px',
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Блокировка времени</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Сотрудник</label>
              <select
                value={blockStaffId}
                onChange={e => setBlockStaffId(e.target.value)}
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              >
                {staffList.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Начало</label>
                <input
                  type="time"
                  value={blockStart}
                  onChange={e => setBlockStart(e.target.value)}
                  style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Окончание</label>
                <input
                  type="time"
                  value={blockEnd}
                  onChange={e => setBlockEnd(e.target.value)}
                  style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Причина блокировки</label>
              <input
                type="text"
                value={blockReason}
                onChange={e => setBlockReason(e.target.value)}
                placeholder="Обед, санитарный час, отгул"
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setShowBlockModal(false)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#0F172A', color: '#FFFFFF', fontWeight: 600 }}
              >
                Заблокировать
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
