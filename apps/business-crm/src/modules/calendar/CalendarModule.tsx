import React, { useState, useRef } from 'react';
import { CalendarBooking, CalendarStaff, CalendarBlockItem, BookingCardResponse, VisitFinancialSummary } from '../../types';
import { BusinessCrmApiClient, CustomerResponse } from '@crm/api-client';

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
  onOpenCustomer?: (customerId: string) => void;
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
  onOpenCustomer,
}) => {
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'list'>('day');
  const [weekData, setWeekData] = useState<Record<string, CalendarBooking[]>>({});
  const [weekBlocks, setWeekBlocks] = useState<Record<string, CalendarBlockItem[]>>({});
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
              cost_minor: b.cost_minor ?? b.amount_minor,
              rendered_minor: b.rendered_minor ?? (b.status === 'completed' ? b.amount_minor : 0),
              paid_minor: b.paid_minor ?? 0,
              debt_minor: b.debt_minor ?? (b.status === 'completed' ? b.amount_minor : 0),
              payment_status: b.payment_status ?? 'unpaid',
              finance: b.finance,
              public_ref: b.public_ref,
              services: b.services || ['Визит'],
            }));
            const mappedBlocks: CalendarBlockItem[] = (cal.blocks || []).map((bl: any) => ({
              id: bl.id,
              staff_id: bl.staff_id,
              starts_at_utc: bl.starts_at_utc,
              ends_at_utc: bl.ends_at_utc,
              block_reason: bl.reason || bl.block_reason || 'Блокировка времени',
            }));
            return { date: d, bookings: mapped, blocks: mappedBlocks, ok: true };
          } catch (err: any) {
            hasError = true;
            lastErrMsg = err?.message || 'Ошибка сети или API';
            return { date: d, bookings: [], blocks: [], ok: false };
          }
        })
      );
      if (hasError) {
        setWeekError(`Не удалось загрузить данные части дней расписания (${lastErrMsg}).`);
      }
      const map: Record<string, CalendarBooking[]> = {};
      const blkMap: Record<string, CalendarBlockItem[]> = {};
      for (const r of results) {
        map[r.date] = r.bookings;
        blkMap[r.date] = r.blocks;
      }
      setWeekData(map);
      setWeekBlocks(blkMap);
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
  const [selectedBlock, setSelectedBlock] = useState<CalendarBlockItem | null>(null);
  const [isDeletingBlock, setIsDeletingBlock] = useState(false);
  const [bookingDetail, setBookingDetail] = useState<BookingCardResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Cancel & Reschedule state
  const [cancelReason, setCancelReason] = useState('Отмена по просьбе клиента');
  const [rescheduleDate, setRescheduleDate] = useState(currentDate);
  const [rescheduleTime, setRescheduleTime] = useState('12:00');
  const [rescheduleStaffId, setRescheduleStaffId] = useState('');

  const handleSelectBooking = React.useCallback(async (b: CalendarBooking) => {
    setSelectedBooking(b);
    setRescheduleStaffId(b.staff_id);
    setRescheduleDate(b.starts_at_utc ? b.starts_at_utc.split('T')[0] : currentDate);
    if (b.starts_at_utc) {
      const { hour, minute } = getLocalHourAndMinute(new Date(b.starts_at_utc), timezoneIana);
      setRescheduleTime(`${hour < 10 ? '0' : ''}${hour}:${minute < 10 ? '0' : ''}${minute}`);
    }
    setBookingDetail(null);
    if (!token || !tenantId) return;
    setIsLoadingDetail(true);
    try {
      const card = await api.getBooking(b.id, token, tenantId);
      setBookingDetail(card);
    } catch (err) {
      console.error('Failed to load full booking details:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  }, [api, token, tenantId, currentDate, timezoneIana]);

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

  // Customer Autocomplete / Link State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCustomerName, setSelectedCustomerName] = useState<string | null>(null);
  const [custSuggestions, setCustSuggestions] = useState<CustomerResponse[]>([]);
  const [isSearchingCust, setIsSearchingCust] = useState(false);
  const searchCustomerTimeoutRef = useRef<any>(null);

  const handleCustPhoneOrNameChange = (nameVal: string, phoneVal: string) => {
    setNewCustName(nameVal);
    setNewCustPhone(phoneVal);
    // If user edits text after selecting a customer, clear selection link
    if (selectedCustomerId && nameVal !== selectedCustomerName) {
      setSelectedCustomerId(null);
      setSelectedCustomerName(null);
    }
    const query = phoneVal.trim().length >= 3 ? phoneVal.trim() : nameVal.trim();
    if (searchCustomerTimeoutRef.current) clearTimeout(searchCustomerTimeoutRef.current);
    if (!query || query.length < 2) {
      setCustSuggestions([]);
      return;
    }
    searchCustomerTimeoutRef.current = setTimeout(async () => {
      try {
        setIsSearchingCust(true);
        const res = await api.getCustomers({ search: query, limit: 5 }, token, tenantId);
        setCustSuggestions(res || []);
      } catch (e) {
        setCustSuggestions([]);
      } finally {
        setIsSearchingCust(false);
      }
    }, 250);
  };

  const handleSelectCustomer = (c: CustomerResponse) => {
    setNewCustName(c.full_name);
    setNewCustPhone((c as any).phone || c.phone_e164 || '');
    setSelectedCustomerId(c.id);
    setSelectedCustomerName(c.full_name);
    setCustSuggestions([]);
  };

  const handleClearSelectedCustomer = () => {
    setSelectedCustomerId(null);
    setSelectedCustomerName(null);
  };


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
      setSelectedCustomerId(null);
      setSelectedCustomerName(null);
      setCustSuggestions([]);
      setShowNewBookingModal(true);
    } catch (err: any) {
      onShowToast(`Ошибка загрузки услуг: ${err.message || err}`);
    }
  };

  // Submit New Booking
  const handleCreateBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim() || !newCustPhone.trim() || !newStaffId || newServiceIds.length === 0) {
      onShowToast('Заполните все обязательные поля');
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
          customer_id: selectedCustomerId || undefined,
        },
        token,
        tenantId
      );

      setShowNewBookingModal(false);
      onShowToast('Запись успешно создана');
      onRefresh();
      if (viewMode === 'week') {
        loadWeekBookings(weekDates);
      }
    } catch (err: any) {
      onShowToast(`Ошибка создания записи: ${err.message || err}`);
    }
  };

  // Status transition handler (PATCH)
  const handleUpdateStatus = async (targetStatus: string) => {
    if (!selectedBooking) return;
    try {
      setIsUpdatingStatus(true);
      const res = await api.updateBookingStatus(
        selectedBooking.id,
        { status: targetStatus },
        token,
        tenantId
      );
      onShowToast(`Статус обновлен на «${targetStatus}»`);

      // Update active modal with authoritative financial data from backend
      if (res && res.finance) {
        setSelectedBooking(prev => prev ? {
          ...prev,
          status: targetStatus,
          cost_minor: res.cost_minor,
          rendered_minor: res.rendered_minor,
          paid_minor: res.paid_minor,
          debt_minor: res.debt_minor,
          payment_status: res.payment_status,
          finance: res.finance
        } : null);
        if (bookingDetail) {
          setBookingDetail(prev => prev ? {
            ...prev,
            status: targetStatus,
            cost_minor: res.cost_minor,
            rendered_minor: res.rendered_minor,
            paid_minor: res.paid_minor,
            debt_minor: res.debt_minor,
            payment_status: res.payment_status,
            finance: res.finance
          } : null);
        }
      } else {
        setSelectedBooking(prev => prev ? { ...prev, status: targetStatus } : null);
      }

      onRefresh();
      if (viewMode === 'week') {
        loadWeekBookings(weekDates);
      }
    } catch (err: any) {
      onShowToast(`Ошибка обновления статуса: ${err.message || err}`);
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
      if (viewMode === 'week') {
        loadWeekBookings(weekDates);
      }
    } catch (err: any) {
      onShowToast(`Ошибка отмены: ${err.message || err}`);
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
      const targetStaff = rescheduleStaffId || selectedBooking.staff_id;
      await api.rescheduleBooking(
        selectedBooking.id,
        {
          starts_at_utc: newStartsAt,
          new_starts_at_utc: newStartsAt,
          staff_id: targetStaff,
          new_staff_id: targetStaff,
        },
        token,
        tenantId
      );
      setShowRescheduleModal(false);
      setSelectedBooking(null);
      onShowToast('Запись перенесена');
      onRefresh();
      if (viewMode === 'week') {
        loadWeekBookings(weekDates);
      }
    } catch (err: any) {
      onShowToast(`Ошибка переноса: ${err.message || err}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Create Calendar Block
  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveStaffId = blockStaffId || (staffList.length > 0 ? staffList[0].id : '');
    if (!effectiveStaffId) {
      onShowToast('Выберите специалиста для блокировки времени');
      return;
    }
    try {
      await api.createCalendarBlock(
        {
          branch_id: branchId,
          staff_id: effectiveStaffId,
          starts_at_utc: localToUtcIso(currentDate, blockStart, timezoneIana),
          ends_at_utc: localToUtcIso(currentDate, blockEnd, timezoneIana),
          block_reason: blockReason || 'Блокировка времени',
        },
        token,
        tenantId
      );
      setShowBlockModal(false);
      onShowToast('Блокировка времени добавлена');
      onRefresh();
      if (viewMode === 'week') {
        loadWeekBookings(weekDates);
      }
    } catch (err: any) {
      onShowToast(`Ошибка создания блокировки: ${err.message || err}`);
    }
  };

  // Delete Calendar Block
  const handleDeleteBlock = async () => {
    if (!selectedBlock) return;
    try {
      setIsDeletingBlock(true);
      await api.deleteCalendarBlock(selectedBlock.id, token, tenantId);
      setSelectedBlock(null);
      onShowToast('Блокировка времени удалена');
      onRefresh();
      if (viewMode === 'week') {
        loadWeekBookings(weekDates);
      }
    } catch (err: any) {
      onShowToast(`Ошибка удаления блокировки: ${err.message || err}`);
    } finally {
      setIsDeletingBlock(false);
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
              data-testid="calendar-view-day"
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
              data-testid="calendar-view-week"
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

          <button
            type="button"
            data-testid="calendar-refresh-btn"
            onClick={() => {
              onRefresh();
              if (viewMode === 'week') {
                loadWeekBookings(weekDates);
              }
            }}
            title="Синхронизировать расписание"
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
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>🔄</span>
            <span>Обновить</span>
          </button>

          {userRole !== 'master' && (
            <>
              <button
                type="button"
                data-testid="calendar-create-block-btn"
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
                data-testid="calendar-create-booking-btn"
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
                        onClick={() => handleSelectBooking(b)}
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {b.services.join(', ')} · {(b.amount_minor / 100).toLocaleString('ru-RU')} ₸
                          </span>
                          {b.status === 'completed' && (b.debt_minor ?? b.amount_minor) > 0 && (
                            <span
                              style={{
                                fontSize: '9px',
                                fontWeight: 700,
                                color: '#991B1B',
                                background: '#FEE2E2',
                                padding: '1px 4px',
                                borderRadius: '4px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Долг
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Calendar Blocks rendered in Column */}
                  {staffBlocks.map(bl => {
                    const startDate = new Date(bl.starts_at_utc);
                    const endDate = new Date(bl.ends_at_utc);
                    const { hour: startH, minute: startM } = getLocalHourAndMinute(startDate, timezoneIana);
                    const { hour: endH, minute: endM } = getLocalHourAndMinute(endDate, timezoneIana);

                    const top = (startH - 9) * 80 + (startM / 60) * 80 + 54;
                    const durationM = (endH - startH) * 60 + (endM - startM);
                    const height = Math.max((durationM / 60) * 80 - 4, 34);

                    const startTimeStr = formatTimeInZone(bl.starts_at_utc, timezoneIana);
                    const endTimeStr = formatTimeInZone(bl.ends_at_utc, timezoneIana);

                    return (
                      <div
                        key={bl.id}
                        data-block-id={bl.id}
                        onClick={() => setSelectedBlock(bl)}
                        title={`${bl.block_reason || 'Блокировка'} (${startTimeStr}–${endTimeStr})`}
                        style={{
                          position: 'absolute',
                          top: `${top}px`,
                          left: '4px',
                          right: '4px',
                          height: `${height}px`,
                          background: '#F1F5F9',
                          backgroundImage: 'repeating-linear-gradient(135deg, #F1F5F9 0 6px, #E2E8F0 6px 7px)',
                          border: '1px solid #CBD5E1',
                          borderLeft: '4px solid #64748B',
                          borderRadius: '8px',
                          padding: '4px 8px',
                          boxSizing: 'border-box',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          zIndex: 5,
                          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155' }}>
                            🔒 {startTimeStr}–{endTimeStr}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              background: '#E2E8F0',
                              color: '#475569',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Занято
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#1E293B',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginTop: '2px',
                          }}
                        >
                          {bl.block_reason || 'Блокировка времени'}
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
                  const dayBlocks = (weekBlocks[dateStr] || []).filter(bl => {
                    if (selectedStaffFilter === 'all') return true;
                    return bl.staff_id === selectedStaffFilter;
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

                      <div style={{ display: 'flex', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
                        <span style={{ color: dayBookings.length > 0 ? '#2563EB' : '#94A3B8' }}>
                          Записей: {dayBookings.length}
                        </span>
                        {dayBlocks.length > 0 && (
                          <span style={{ color: '#64748B' }}>
                            · Блоков: {dayBlocks.length}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
                        {dayBookings.length === 0 && dayBlocks.length === 0 && (
                          <div style={{ padding: '20px 8px', textAlign: 'center', fontSize: '12px', color: '#94A3B8' }}>
                            Свободно
                          </div>
                        )}

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
                              onClick={() => handleSelectBooking(b)}
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

                        {dayBlocks.map(bl => {
                          const startTime = formatTimeInZone(bl.starts_at_utc, timezoneIana);
                          const endTime = formatTimeInZone(bl.ends_at_utc, timezoneIana);
                          const staff = staffList.find(s => s.id === bl.staff_id);

                          return (
                            <div
                              key={bl.id}
                              data-block-id={bl.id}
                              onClick={() => setSelectedBlock(bl)}
                              style={{
                                padding: '8px',
                                background: '#F8FAFC',
                                backgroundImage: 'repeating-linear-gradient(135deg, #F8FAFC 0 6px, #E2E8F0 6px 7px)',
                                border: '1px solid #CBD5E1',
                                borderLeft: '3px solid #64748B',
                                borderRadius: '8px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '3px',
                                cursor: 'pointer',
                                transition: 'box-shadow 0.15s',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                                <span style={{ fontWeight: 700, color: '#334155' }}>🔒 {startTime}–{endTime}</span>
                                <span style={{ fontSize: '9px', fontWeight: 600, padding: '1px 4px', borderRadius: '3px', background: '#E2E8F0', color: '#475569' }}>
                                  Занято
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {bl.block_reason || 'Блокировка времени'}
                              </div>
                              {staff && (
                                <div style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {staff.name}
                                </div>
                              )}
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
                        data-booking-id={b.id}
                        data-public-ref={b.public_ref}
                        onClick={() => handleSelectBooking(b)}
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
      {selectedBooking && (() => {
        const active = selectedBooking;
        const badge = getStatusBadge(active.status);
        const costMinor = bookingDetail?.cost_minor ?? active.cost_minor ?? active.amount_minor;
        const renderedMinor = bookingDetail?.rendered_minor ?? active.rendered_minor ?? (active.status === 'completed' ? active.amount_minor : 0);
        const paidMinor = bookingDetail?.paid_minor ?? active.paid_minor ?? 0;
        const debtMinor = bookingDetail?.debt_minor ?? active.debt_minor ?? (active.status === 'completed' ? Math.max(0, costMinor - paidMinor) : 0);
        const paymentStatus = bookingDetail?.payment_status ?? active.payment_status ?? (paidMinor >= renderedMinor && renderedMinor > 0 ? 'paid' : paidMinor > 0 ? 'partially_paid' : 'unpaid');
        const currency = bookingDetail?.finance?.currency || 'KZT';
        const currencySymbol = currency === 'KZT' ? '₸' : currency;

        return (
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
                maxWidth: '520px',
                background: '#FFFFFF',
                borderRadius: '20px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
                maxHeight: '90vh',
                overflowY: 'auto',
              }}
              data-testid="visit-card-modal"
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>
                    Карточка записи #{active.public_ref}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#0F172A', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{active.customer_name}</span>
                    {active.customer_id && onOpenCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          const cid = active.customer_id!;
                          setSelectedBooking(null);
                          setBookingDetail(null);
                          onOpenCustomer(cid);
                        }}
                        title="Перейти в карточку клиента"
                        style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          border: '1px solid #3B82F6',
                          background: '#EFF6FF',
                          color: '#1D4ED8',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        👤 Карточка
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                    {active.customer_phone}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    data-testid="visit-status-badge"
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      background: badge.bg,
                      color: badge.text,
                      padding: '3px 8px',
                      borderRadius: '6px',
                    }}
                  >
                    {badge.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedBooking(null); setBookingDetail(null); }}
                    style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748B', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* M11 Financial Block */}
              <div
                data-testid="visit-financial-block"
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '16px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Финансовый расчёт визита
                  </div>
                  <div>
                    {paymentStatus === 'paid' && (
                      <span
                        data-testid="payment-status-badge"
                        style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' }}
                      >
                        ✓ Оплачено
                      </span>
                    )}
                    {paymentStatus === 'partially_paid' && (
                      <span
                        data-testid="payment-status-badge"
                        style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', background: '#DBEAFE', color: '#1E40AF', border: '1px solid #93C5FD' }}
                      >
                        Частичная оплата
                      </span>
                    )}
                    {paymentStatus === 'unpaid' && (
                      <span
                        data-testid="payment-status-badge"
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: debtMinor > 0 ? '#FEF2F2' : '#F1F5F9',
                          color: debtMinor > 0 ? '#991B1B' : '#475569',
                          border: debtMinor > 0 ? '1px solid #FCA5A5' : '1px solid #CBD5E1',
                        }}
                      >
                        {debtMinor > 0 ? 'Не оплачено (Долг)' : 'Не оплачено'}
                      </span>
                    )}
                  </div>
                </div>

                {/* 4 Separate Financial Fields */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                  {/* 1. Стоимость */}
                  <div
                    data-testid="financial-cost-tile"
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '12px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>Стоимость</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#0F172A' }}>
                      {(costMinor / 100).toLocaleString('ru-RU')} {currencySymbol}
                    </div>
                    <div style={{ fontSize: '10px', color: '#94A3B8' }}>По прайсу визита</div>
                  </div>

                  {/* 2. Оказано */}
                  <div
                    data-testid="financial-rendered-tile"
                    style={{
                      background: renderedMinor > 0 ? '#F0FDF4' : '#FFFFFF',
                      border: `1px solid ${renderedMinor > 0 ? '#BBF7D0' : '#E2E8F0'}`,
                      borderRadius: '12px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: renderedMinor > 0 ? '#166534' : '#64748B', fontWeight: 600 }}>
                      Оказано
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: renderedMinor > 0 ? '#15803D' : '#64748B' }}>
                      {(renderedMinor / 100).toLocaleString('ru-RU')} {currencySymbol}
                    </div>
                    <div style={{ fontSize: '10px', color: renderedMinor > 0 ? '#16A34A' : '#94A3B8' }}>
                      {renderedMinor > 0 ? 'Факт оказания подтверждён' : 'Визит ещё не завершён'}
                    </div>
                  </div>

                  {/* 3. Получено */}
                  <div
                    data-testid="financial-paid-tile"
                    style={{
                      background: paidMinor > 0 ? '#EFF6FF' : '#FFFFFF',
                      border: `1px solid ${paidMinor > 0 ? '#BFDBFE' : '#E2E8F0'}`,
                      borderRadius: '12px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: paidMinor > 0 ? '#1E40AF' : '#64748B', fontWeight: 600 }}>
                      Получено
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: paidMinor > 0 ? '#2563EB' : '#64748B' }}>
                      {(paidMinor / 100).toLocaleString('ru-RU')} {currencySymbol}
                    </div>
                    <div style={{ fontSize: '10px', color: paidMinor > 0 ? '#2563EB' : '#94A3B8' }}>
                      {paidMinor > 0 ? 'Оплата внесена' : 'Оплат не поступало'}
                    </div>
                  </div>

                  {/* 4. Долг */}
                  <div
                    data-testid="financial-debt-tile"
                    style={{
                      background: debtMinor > 0 ? '#FEF2F2' : '#FFFFFF',
                      border: `1px solid ${debtMinor > 0 ? '#FCA5A5' : '#E2E8F0'}`,
                      borderRadius: '12px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: debtMinor > 0 ? '#991B1B' : '#64748B', fontWeight: 600 }}>
                      Долг
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: debtMinor > 0 ? '#DC2626' : '#15803D' }}>
                      {(debtMinor / 100).toLocaleString('ru-RU')} {currencySymbol}
                    </div>
                    <div style={{ fontSize: '10px', color: debtMinor > 0 ? '#B91C1C' : '#16A34A' }}>
                      {debtMinor > 0 ? 'Подлежит оплате' : 'Долг отсутствует'}
                    </div>
                  </div>
                </div>

                {/* Explanatory Policy Notice */}
                <div
                  style={{
                    fontSize: '11px',
                    color: '#475569',
                    background: '#FFFFFF',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                    lineHeight: '1.4',
                  }}
                >
                  ℹ️ <b>Разделение статуса и денег:</b> Завершение визита фиксирует факт оказания услуги, но не закрывает долг и не создаёт фиктивной оплаты.
                </div>
              </div>

              {/* Services breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                  Состав заказа ({bookingDetail?.items?.length || active.services.length})
                </div>
                {isLoadingDetail ? (
                  <div style={{ fontSize: '12px', color: '#94A3B8' }}>Загрузка деталей услуг…</div>
                ) : bookingDetail?.items && bookingDetail.items.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {bookingDetail.items.map((it, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          background: '#F8FAFC',
                          borderRadius: '8px',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600, color: '#0F172A' }}>{it.service_name}</span>
                          <span style={{ fontSize: '11px', color: '#64748B', marginLeft: '6px' }}>
                            ({it.duration_minutes} мин.)
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, color: '#0F172A' }}>
                          {(it.price_minor / 100).toLocaleString('ru-RU')} {currencySymbol}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: '#64748B' }}>
                    {active.services.join(', ')} — {(active.amount_minor / 100).toLocaleString('ru-RU')} {currencySymbol}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #E2E8F0', paddingTop: '16px' }}>
                {active.status === 'confirmed' && (
                  <button
                    type="button"
                    data-testid="status-btn-arrived"
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
                    {isUpdatingStatus ? 'Обновление...' : 'Клиент прибыл'}
                  </button>
                )}
                {active.status === 'arrived' && (
                  <button
                    type="button"
                    data-testid="status-btn-in-progress"
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
                    {isUpdatingStatus ? 'Обновление...' : 'Начать визит'}
                  </button>
                )}
                {active.status === 'in_progress' && (
                  <button
                    type="button"
                    data-testid="status-btn-completed"
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
                    {isUpdatingStatus ? 'Обновление...' : 'Завершить визит'}
                  </button>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {active.status !== 'completed' && active.status !== 'cancelled' && (
                    <>
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
                    </>
                  )}
                  <button
                    type="button"
                    data-testid="visit-card-close-btn"
                    onClick={() => { setSelectedBooking(null); setBookingDetail(null); }}
                    style={{
                      flex: (active.status === 'completed' || active.status === 'cancelled') ? 1 : 'none',
                      padding: '0 16px',
                      height: '38px',
                      borderRadius: '8px',
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Специалист</label>
              <select
                value={rescheduleStaffId || selectedBooking.staff_id}
                onChange={e => setRescheduleStaffId(e.target.value)}
                style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px' }}
              >
                {staffList.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role_title || 'Специалист'})
                  </option>
                ))}
              </select>
            </div>
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

            {/* Linked customer badge */}
            {selectedCustomerId && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#EFF6FF', borderRadius: '8px', border: '1px solid #BFDBFE', fontSize: '12px', color: '#1D4ED8' }}>
                <span>🔗 Связан с карточкой: <b>{selectedCustomerName}</b></span>
                <button
                  type="button"
                  onClick={handleClearSelectedCustomer}
                  title="Отвязать карточку"
                  style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontWeight: 700 }}
                >
                  ✕
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Имя клиента</label>
              <input
                type="text"
                data-testid="booking-cust-name-input"
                value={newCustName}
                onChange={e => handleCustPhoneOrNameChange(e.target.value, newCustPhone)}
                placeholder="Айбек Жумабаев"
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Телефон</label>
              <input
                type="tel"
                data-testid="booking-cust-phone-input"
                value={newCustPhone}
                onChange={e => handleCustPhoneOrNameChange(newCustName, e.target.value)}
                placeholder="+7 (701) 234-56-78"
                required
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>

            {/* Suggestions dropdown */}
            {custSuggestions.length > 0 && !selectedCustomerId && (
              <div style={{ background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                <div style={{ padding: '6px 10px', fontSize: '11px', color: '#64748B', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  Найдено в базе клиентов (нажмите для выбора):
                </div>
                {custSuggestions.map(c => (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCustomer(c)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#FFFFFF')}
                  >
                    <span style={{ fontWeight: 600 }}>{c.full_name}</span>
                    <span style={{ color: '#64748B' }}>{(c as any).phone || c.phone_e164}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Мастер</label>
              <select
                data-testid="booking-staff-select"
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
                data-testid="booking-time-input"
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
                data-testid="submit-booking-btn"
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
                value={blockStaffId || (staffList.length > 0 ? staffList[0].id : '')}
                onChange={e => setBlockStaffId(e.target.value)}
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              >
                {staffList.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.role_title || 'Барбер'})</option>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Причина блокировки</label>
              <input
                type="text"
                value={blockReason}
                onChange={e => setBlockReason(e.target.value)}
                placeholder="Обед, санитарный час, отгул"
                style={{ height: '38px', padding: '0 12px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' }}>
                {['Перерыв на обед', 'Обучение', 'Личные дела', 'Технический перерыв'].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setBlockReason(r)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      border: '1px solid #CBD5E1',
                      background: blockReason === r ? '#0F172A' : '#F1F5F9',
                      color: blockReason === r ? '#FFFFFF' : '#334155',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
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
                data-testid="submit-block-btn"
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#0F172A', color: '#FFFFFF', fontWeight: 600 }}
              >
                Заблокировать
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Block Details Modal */}
      {selectedBlock && (
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
              maxWidth: '420px',
              background: '#FFFFFF',
              borderRadius: '20px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>🔒</span>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Блокировка времени</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBlock(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748B' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', background: '#F8FAFC', padding: '14px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
              <div>
                <span style={{ color: '#64748B' }}>Специалист: </span>
                <b>{staffList.find(s => s.id === selectedBlock.staff_id)?.name || 'Все / Не указан'}</b>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Время: </span>
                <b>{formatTimeInZone(selectedBlock.starts_at_utc, timezoneIana)} – {formatTimeInZone(selectedBlock.ends_at_utc, timezoneIana)}</b>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Причина: </span>
                <b>{selectedBlock.block_reason || 'Перерыв / блокировка'}</b>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #E2E8F0', paddingTop: '16px' }}>
              <button
                type="button"
                onClick={() => setSelectedBlock(null)}
                style={{
                  flex: 1,
                  height: '42px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Закрыть
              </button>
              <button
                type="button"
                data-testid="delete-block-btn"
                onClick={handleDeleteBlock}
                disabled={isDeletingBlock}
                style={{
                  flex: 1,
                  height: '42px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isDeletingBlock ? 'Удаление...' : 'Снять блокировку'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
