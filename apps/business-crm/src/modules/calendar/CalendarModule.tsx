import React, { useState, useRef } from 'react';
import { CalendarBooking, CalendarStaff, CalendarBlockItem, BookingCardResponse, VisitFinancialSummary } from '../../types';
import { BusinessCrmApiClient, CustomerResponse, PaymentRecord, PaymentMethod } from '@crm/api-client';

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

  // Payments & Cash Desk state (Sprint M12 & M13)
  const [visitPayments, setVisitPayments] = useState<PaymentRecord[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmountStr, setPaymentAmountStr] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentComment, setPaymentComment] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Refund state (Sprint M13)
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [selectedPaymentForRefund, setSelectedPaymentForRefund] = useState<PaymentRecord | null>(null);
  const [refundAmountStr, setRefundAmountStr] = useState('');
  const [refundReason, setRefundReason] = useState('Отказ от части услуги');
  const [refundComment, setRefundComment] = useState('');
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);

  const handleSelectBooking = React.useCallback(async (b: CalendarBooking) => {
    setSelectedBooking(b);
    setRescheduleStaffId(b.staff_id);
    setRescheduleDate(b.starts_at_utc ? b.starts_at_utc.split('T')[0] : currentDate);
    if (b.starts_at_utc) {
      const { hour, minute } = getLocalHourAndMinute(new Date(b.starts_at_utc), timezoneIana);
      setRescheduleTime(`${hour < 10 ? '0' : ''}${hour}:${minute < 10 ? '0' : ''}${minute}`);
    }
    setBookingDetail(null);
    setVisitPayments([]);
    if (!token || !tenantId) return;
    setIsLoadingDetail(true);
    try {
      const card = await api.getBooking(b.id, token, tenantId);
      setBookingDetail(card);
      if (userRole !== 'master') {
        const payments = await api.getVisitPayments(b.id, token, tenantId).catch(() => []);
        setVisitPayments(payments || []);
      }
    } catch (err) {
      console.error('Failed to load full booking details:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  }, [api, token, tenantId, currentDate, timezoneIana, userRole]);

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
          cost_minor: res.finance.cost_minor ?? res.cost_minor,
          rendered_minor: res.finance.rendered_minor ?? res.rendered_minor,
          paid_minor: res.finance.paid_minor ?? res.paid_minor,
          debt_minor: res.finance.debt_minor ?? res.debt_minor,
          payment_status: res.finance.payment_status ?? res.payment_status,
          finance: res.finance
        } : null);
        if (bookingDetail) {
          setBookingDetail(prev => prev ? {
            ...prev,
            status: targetStatus,
            cost_minor: res.finance.cost_minor ?? res.cost_minor,
            rendered_minor: res.finance.rendered_minor ?? res.rendered_minor,
            paid_minor: res.finance.paid_minor ?? res.paid_minor,
            debt_minor: res.finance.debt_minor ?? res.debt_minor,
            payment_status: res.finance.payment_status ?? res.payment_status,
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
      try {
        const updated = await api.getBooking(selectedBooking.id, token, tenantId);
        setSelectedBooking(prev => prev ? {
          ...prev,
          status: updated.status,
          starts_at_utc: updated.starts_at_utc,
          service_ends_at_utc: updated.service_ends_at_utc,
          staff_id: updated.staff_id,
        } : null);
        setBookingDetail(updated);
      } catch {
        setSelectedBooking(null);
      }
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
      try {
        const updated = await api.getBooking(selectedBooking.id, token, tenantId);
        setSelectedBooking(prev => prev ? {
          ...prev,
          status: updated.status,
          starts_at_utc: updated.starts_at_utc,
          service_ends_at_utc: updated.service_ends_at_utc,
          staff_id: updated.staff_id,
        } : null);
        setBookingDetail(updated);
      } catch {
        setSelectedBooking(null);
      }
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

  // Register Payment (Sprint M12)
  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking) return;
    const amountVal = parseFloat(paymentAmountStr);
    if (isNaN(amountVal) || amountVal <= 0) {
      onShowToast('Введите корректную сумму оплаты');
      return;
    }
    const amountMinor = Math.round(amountVal * 100);
    try {
      setIsSubmittingPayment(true);
      const idempotencyKey = `pay_${selectedBooking.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await api.createPayment(
        {
          booking_id: selectedBooking.id,
          amount_minor: amountMinor,
          payment_method: paymentMethod,
          comment: paymentComment.trim() || undefined,
          cashier_name: userRole === 'owner' ? 'Владелец' : 'Администратор',
          customer_id: selectedBooking.customer_id,
        },
        token,
        tenantId,
        idempotencyKey
      );
      onShowToast(`Платёж ${(amountMinor / 100).toLocaleString('ru-RU')} ₸ успешно принят`);
      setShowPaymentModal(false);
      setPaymentComment('');
      // Reload payments and booking financial summary
      const [updatedCard, updatedPayments] = await Promise.all([
        api.getBooking(selectedBooking.id, token, tenantId).catch(() => null),
        api.getVisitPayments(selectedBooking.id, token, tenantId).catch(() => []),
      ]);
      if (updatedCard) setBookingDetail(updatedCard);
      setVisitPayments(updatedPayments || []);
      onRefresh();
    } catch (err: any) {
      onShowToast(`Ошибка приёма оплаты: ${err.message || err}`);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Refund Payment (Sprint M13)
  const handleConfirmRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking || !selectedPaymentForRefund) return;
    const refundVal = parseFloat(refundAmountStr);
    if (isNaN(refundVal) || refundVal <= 0) {
      onShowToast('Введите корректную сумму возврата');
      return;
    }
    const refundMinor = Math.round(refundVal * 100);
    if (refundMinor > selectedPaymentForRefund.amount_minor) {
      onShowToast('Сумма возврата не может превышать сумму исходного платежа');
      return;
    }
    try {
      setIsSubmittingRefund(true);
      const idempotencyKey = `ref_${selectedPaymentForRefund.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await api.refundPayment(
        {
          payment_id: selectedPaymentForRefund.id,
          booking_id: selectedBooking.id,
          amount_minor: refundMinor,
          reason: refundReason,
          comment: refundComment.trim() || undefined,
          cashier_name: userRole === 'owner' ? 'Владелец' : 'Администратор',
          payment_method: selectedPaymentForRefund.payment_method || 'card',
        },
        token,
        tenantId,
        idempotencyKey
      );
      onShowToast(`Возврат ${(refundMinor / 100).toLocaleString('ru-RU')} ₸ успешно оформлен`);
      setShowRefundModal(false);
      setSelectedPaymentForRefund(null);
      setRefundComment('');
      // Reload payments and booking financial summary
      const [updatedCard, updatedPayments] = await Promise.all([
        api.getBooking(selectedBooking.id, token, tenantId).catch(() => null),
        api.getVisitPayments(selectedBooking.id, token, tenantId).catch(() => []),
      ]);
      if (updatedCard) setBookingDetail(updatedCard);
      setVisitPayments(updatedPayments || []);
      onRefresh();
    } catch (err: any) {
      onShowToast(`Ошибка возврата: ${err.message || err}`);
    } finally {
      setIsSubmittingRefund(false);
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
      case 'pending':
        return { bg: 'color-mix(in srgb, var(--s-arrived) 14%, var(--panel))', text: 'var(--s-arrived)', label: 'Ожидает' };
      case 'confirmed':
        return { bg: 'color-mix(in srgb, var(--s-confirmed) 14%, var(--panel))', text: 'var(--s-confirmed)', label: 'Подтверждена' };
      case 'arrived':
        return { bg: 'color-mix(in srgb, var(--s-arrived) 14%, var(--panel))', text: 'var(--s-arrived)', label: 'Прибыл' };
      case 'in_progress':
        return { bg: 'var(--brand)', text: 'var(--brand-fg)', label: 'В работе' };
      case 'completed':
        return { bg: 'color-mix(in srgb, var(--s-completed) 14%, var(--panel))', text: 'var(--s-completed)', label: 'Завершен' };
      case 'cancelled':
        return { bg: 'var(--chip)', text: 'var(--s-cancelled)', label: 'Отменен' };
      case 'no_show':
        return { bg: 'color-mix(in srgb, var(--s-no_show) 14%, var(--panel))', text: 'var(--s-no_show)', label: 'Не явился' };
      default:
        return { bg: 'var(--chip)', text: 'var(--fg)', label: status };
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
          background: 'var(--panel)',
          borderBottom: '1px solid var(--line)',
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
              borderRadius: '12px',
              border: '1px solid var(--line)',
              background: 'var(--panel)',
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
              borderRadius: '12px',
              border: '1px solid var(--line)',
              background: 'var(--panel)',
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
              borderRadius: '12px',
              border: '1px solid var(--line)',
              background: 'var(--panel)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ›
          </button>
          <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--fg)', marginLeft: '6px' }}>
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
              background: 'var(--chip)',
              padding: '3px',
              borderRadius: '14px',
              gap: '2px',
            }}
          >
            <button
              type="button"
              data-testid="calendar-view-day"
              onClick={() => setViewMode('day')}
              style={{
                border: 'none',
                background: viewMode === 'day' ? 'var(--panel)' : 'transparent',
                color: viewMode === 'day' ? 'var(--fg)' : 'var(--muted)',
                borderRadius: '12px',
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
                background: viewMode === 'week' ? 'var(--panel)' : 'transparent',
                color: viewMode === 'week' ? 'var(--fg)' : 'var(--muted)',
                borderRadius: '12px',
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
                background: viewMode === 'list' ? 'var(--panel)' : 'transparent',
                color: viewMode === 'list' ? 'var(--fg)' : 'var(--muted)',
                borderRadius: '12px',
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
              borderRadius: '12px',
              border: '1px solid var(--line)',
              background: 'var(--panel)',
              color: 'var(--fg)',
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
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  background: 'var(--panel)',
                  color: 'var(--fg)',
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
                  borderRadius: '12px',
                  border: 'none',
                  background: 'var(--brand)',
                  color: 'var(--brand-fg)',
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
            background: 'var(--panel)',
            borderBottom: '1px solid var(--line)',
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
              background: selectedStaffFilter === 'all' ? 'var(--brand2)' : 'var(--chip)',
              color: selectedStaffFilter === 'all' ? 'var(--brand-fg)' : 'var(--fg)',
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
                background: selectedStaffFilter === s.id ? 'var(--brand2)' : 'var(--chip)',
                color: selectedStaffFilter === s.id ? 'var(--brand-fg)' : 'var(--fg)',
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
              color: 'var(--muted)',
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
                borderRight: '1px solid var(--line)',
                background: 'var(--panel)',
                flexShrink: 0,
              }}
            >
              <div style={{ height: '54px', borderBottom: '1px solid var(--line)' }} />
              {hours.map(h => (
                <div
                  key={h}
                  style={{
                    height: '80px',
                    padding: '6px 8px',
                    fontSize: '12px',
                    color: 'var(--muted)',
                    fontWeight: 500,
                    textAlign: 'right',
                    borderBottom: '1px dashed var(--chip)',
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
                    borderRight: '1px solid var(--line)',
                    background: 'var(--panel)',
                    position: 'relative',
                  }}
                >
                  {/* Staff Header */}
                  <div
                    style={{
                      height: '54px',
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--line)',
                      background: 'var(--canvas)',
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
                        background: staff.color || 'var(--brand)',
                        color: 'var(--brand-fg)',
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
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
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
                        borderBottom: '1px dashed var(--chip)',
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
                          // макет: фон — оттенок цвета статуса, «в работе» — тёмная карточка, отмена — серая и зачёркнутая
                          background: b.status === 'in_progress' ? 'var(--brand2)' : `color-mix(in srgb, var(--s-${b.status}, var(--s-confirmed)) 22%, var(--panel))`,
                          color: b.status === 'in_progress' ? 'var(--brand2-fg)' : 'var(--fg)',
                          border: 0,
                          opacity: b.status === 'cancelled' ? 0.6 : 1,
                          textDecoration: b.status === 'cancelled' ? 'line-through' : 'none',
                          borderRadius: '12px',
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
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'inherit' }}>
                            {startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezoneIana })}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              background: badge.bg,
                              color: badge.text,
                              padding: '1px 6px',
                              borderRadius: '8px',
                            }}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {b.customer_name}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '11px', color: 'inherit', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {b.services.join(', ')} · {(b.amount_minor / 100).toLocaleString('ru-RU')} ₸
                          </span>
                          {b.status === 'completed' && (b.debt_minor ?? b.amount_minor) > 0 && (
                            <span
                              style={{
                                fontSize: '9px',
                                fontWeight: 700,
                                color: 'var(--neg)',
                                background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))',
                                padding: '1px 4px',
                                borderRadius: '8px',
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
                          background: 'var(--chip)',
                          backgroundImage: 'repeating-linear-gradient(135deg, var(--chip) 0 6px, var(--line) 6px 7px)',
                          border: '1px solid var(--line)',
                          borderLeft: '4px solid var(--muted)',
                          borderRadius: '12px',
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
                          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg)' }}>
                            🔒 {startTimeStr}–{endTimeStr}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              background: 'var(--line)',
                              color: 'var(--muted)',
                              padding: '1px 5px',
                              borderRadius: '8px',
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
                            color: 'var(--fg)',
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
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--fg)' }}>
                  Недельный обзор расписания ({weekDates[0]} – {weekDates[6]})
                </h2>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '2px' }}>
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
                  style={{ padding: '6px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '12px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
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
                  style={{ padding: '6px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '12px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
                >
                  Следующая неделя →
                </button>
              </div>
            </div>

            {weekError && (
              <div style={{ padding: '12px 16px', background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))', border: '1px solid color-mix(in srgb, var(--neg) 30%, var(--panel))', borderRadius: '14px', color: 'var(--neg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontSize: '13px' }}>⚠️ {weekError}</span>
                <button
                  type="button"
                  onClick={() => loadWeekBookings(weekDates)}
                  style={{ padding: '6px 14px', background: 'var(--neg)', color: 'var(--brand-fg)', border: 'none', borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Повторить загрузку
                </button>
              </div>
            )}

            {isLoadingWeek ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '14px' }}>
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
                        background: isCurrent ? 'var(--canvas)' : 'var(--panel)',
                        border: isCurrent ? '2px solid var(--brand)' : '1px solid var(--line)',
                        borderRadius: '18px',
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
                          borderBottom: '1px solid var(--chip)',
                          paddingBottom: '8px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--fg)' }}>{dayNames[idx]}</span>
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{d}</span>
                        </div>
                        {isToday && (
                          <span style={{ fontSize: '10px', fontWeight: 700, background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))', color: 'var(--brand)', padding: '2px 6px', borderRadius: '8px' }}>
                            Сегодня
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
                        <span style={{ color: dayBookings.length > 0 ? 'var(--brand)' : 'var(--muted2)' }}>
                          Записей: {dayBookings.length}
                        </span>
                        {dayBlocks.length > 0 && (
                          <span style={{ color: 'var(--muted)' }}>
                            · Блоков: {dayBlocks.length}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
                        {dayBookings.length === 0 && dayBlocks.length === 0 && (
                          <div style={{ padding: '20px 8px', textAlign: 'center', fontSize: '12px', color: 'var(--muted2)' }}>
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
                                background: 'var(--panel)',
                                border: '1px solid var(--line)',
                                borderLeft: `3px solid ${staff?.color || 'var(--brand)'}`,
                                borderRadius: '12px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                cursor: 'pointer',
                                transition: 'box-shadow 0.15s',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                                <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{startTime}–{endTime}</span>
                                <span style={{ fontSize: '9px', fontWeight: 600, padding: '1px 4px', borderRadius: '3px', background: badge.bg, color: badge.text }}>
                                  {badge.label}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {b.customer_name}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                                background: 'var(--canvas)',
                                backgroundImage: 'repeating-linear-gradient(135deg, var(--canvas) 0 6px, var(--line) 6px 7px)',
                                border: '1px solid var(--line)',
                                borderLeft: '3px solid var(--muted)',
                                borderRadius: '12px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '3px',
                                cursor: 'pointer',
                                transition: 'box-shadow 0.15s',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                                <span style={{ fontWeight: 700, color: 'var(--fg)' }}>🔒 {startTime}–{endTime}</span>
                                <span style={{ fontSize: '9px', fontWeight: 600, padding: '1px 4px', borderRadius: '3px', background: 'var(--line)', color: 'var(--muted)' }}>
                                  Занято
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {bl.block_reason || 'Блокировка времени'}
                              </div>
                              {staff && (
                                <div style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
          <div style={{ flex: 1, padding: '24px', background: 'var(--panel)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)' }}>
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
                    <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
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
                        style={{ borderBottom: '1px solid var(--chip)', cursor: 'pointer' }}
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
                              borderRadius: '8px',
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
        const renderedMinor = bookingDetail?.rendered_minor ?? active.rendered_minor ?? (active.status === 'completed' ? costMinor : 0);
        
        // Sum from actual payments (refunds are negative movements!)
        const paymentsNetMinor = visitPayments.reduce((acc, p) => {
          const isRefund = p.payment_type === 'refund' || (p as any).kind === 'refund';
          return isRefund ? acc - p.amount_minor : acc + p.amount_minor;
        }, 0);
        const paidMinor = visitPayments.length > 0 ? Math.max(0, paymentsNetMinor) : (bookingDetail?.paid_minor ?? active.paid_minor ?? 0);
        
        // Debt: strictly calculated from rendered services upon completion
        const debtMinor = active.status === 'completed' ? Math.max(0, costMinor - paidMinor) : (costMinor - paidMinor > 0 ? costMinor - paidMinor : 0);
        const paymentStatus = (paidMinor >= costMinor && costMinor > 0) ? 'paid' : (paidMinor > 0 ? 'partially_paid' : 'unpaid');
        const currency = bookingDetail?.finance?.currency || 'KZT';
        const currencySymbol = currency === 'KZT' ? '₸' : currency;
        const canManageFinance = userRole === 'owner' || userRole === 'admin' || userRole === 'cashier';

        return (
          <div className="visit-sheet-scrim">
            {/* макет: карточка записи — боковая панель справа (на телефоне — лист снизу) */}
            <div className="visit-sheet" data-testid="visit-card-modal">
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
                    Карточка записи #{active.public_ref}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--fg)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                          borderRadius: '10px',
                          border: '1px solid var(--brand)',
                          background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))',
                          color: 'var(--brand)',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        👤 Карточка
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '2px' }}>
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
                      borderRadius: '10px',
                    }}
                  >
                    {badge.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedBooking(null); setBookingDetail(null); }}
                    style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--muted)', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* M15: Master does not see financial ledger or cashbox (мастер не видит кассу) */}
              {userRole !== 'master' ? (
                <div
                  data-testid="visit-financial-block"
                style={{
                  background: 'var(--canvas)',
                  border: '1px solid var(--line)',
                  borderRadius: '22px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--fg)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Финансовый расчёт визита
                  </div>
                  <div>
                    {paymentStatus === 'paid' && (
                      <span
                        data-testid="payment-status-badge"
                        style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '10px', background: 'color-mix(in srgb, var(--pos) 12%, var(--panel))', color: 'var(--pos)', border: '1px solid color-mix(in srgb, var(--pos) 45%, var(--panel))' }}
                      >
                        ✓ Оплачено
                      </span>
                    )}
                    {paymentStatus === 'partially_paid' && (
                      <span
                        data-testid="payment-status-badge"
                        style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '10px', background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))', color: 'var(--brand)', border: '1px solid color-mix(in srgb, var(--brand) 40%, var(--panel))' }}
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
                          borderRadius: '10px',
                          background: debtMinor > 0 ? 'color-mix(in srgb, var(--neg) 10%, var(--panel))' : 'var(--chip)',
                          color: debtMinor > 0 ? 'var(--neg)' : 'var(--muted)',
                          border: debtMinor > 0 ? '1px solid color-mix(in srgb, var(--neg) 40%, var(--panel))' : '1px solid var(--muted2)',
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
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      borderRadius: '18px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>Стоимость</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--fg)' }}>
                      {(costMinor / 100).toLocaleString('ru-RU')} {currencySymbol}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--muted2)' }}>По прайсу визита</div>
                  </div>

                  {/* 2. Оказано */}
                  <div
                    data-testid="financial-rendered-tile"
                    style={{
                      background: renderedMinor > 0 ? 'color-mix(in srgb, var(--pos) 12%, var(--panel))' : 'var(--panel)',
                      border: `1px solid ${renderedMinor > 0 ? 'color-mix(in srgb, var(--pos) 30%, var(--panel))' : 'var(--line)'}`,
                      borderRadius: '18px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: renderedMinor > 0 ? 'var(--pos)' : 'var(--muted)', fontWeight: 600 }}>
                      Оказано
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: renderedMinor > 0 ? 'var(--pos)' : 'var(--muted)' }}>
                      {(renderedMinor / 100).toLocaleString('ru-RU')} {currencySymbol}
                    </div>
                    <div style={{ fontSize: '10px', color: renderedMinor > 0 ? 'var(--pos)' : 'var(--muted2)' }}>
                      {renderedMinor > 0 ? 'Факт оказания подтверждён' : 'Визит ещё не завершён'}
                    </div>
                  </div>

                  {/* 3. Получено */}
                  <div
                    data-testid="financial-paid-tile"
                    style={{
                      background: paidMinor > 0 ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'var(--panel)',
                      border: `1px solid ${paidMinor > 0 ? 'color-mix(in srgb, var(--brand) 30%, var(--panel))' : 'var(--line)'}`,
                      borderRadius: '18px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: paidMinor > 0 ? 'var(--brand)' : 'var(--muted)', fontWeight: 600 }}>
                      Получено
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: paidMinor > 0 ? 'var(--brand)' : 'var(--muted)' }}>
                      {(paidMinor / 100).toLocaleString('ru-RU')} {currencySymbol}
                    </div>
                    <div style={{ fontSize: '10px', color: paidMinor > 0 ? 'var(--brand)' : 'var(--muted2)' }}>
                      {paidMinor > 0 ? 'Оплата внесена' : 'Оплат не поступало'}
                    </div>
                  </div>

                  {/* 4. Долг */}
                  <div
                    data-testid="financial-debt-tile"
                    style={{
                      background: debtMinor > 0 ? 'color-mix(in srgb, var(--neg) 10%, var(--panel))' : 'var(--panel)',
                      border: `1px solid ${debtMinor > 0 ? 'color-mix(in srgb, var(--neg) 40%, var(--panel))' : 'var(--line)'}`,
                      borderRadius: '18px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: debtMinor > 0 ? 'var(--neg)' : 'var(--muted)', fontWeight: 600 }}>
                      Долг
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: debtMinor > 0 ? 'var(--neg)' : 'var(--pos)' }}>
                      {(debtMinor / 100).toLocaleString('ru-RU')} {currencySymbol}
                    </div>
                    <div style={{ fontSize: '10px', color: debtMinor > 0 ? 'var(--neg)' : 'var(--pos)' }}>
                      {debtMinor > 0 ? 'Подлежит оплате' : 'Долг отсутствует'}
                    </div>
                  </div>
                </div>

                {/* Explanatory Policy Notice */}
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--muted)',
                    background: 'var(--panel)',
                    padding: '8px 10px',
                    borderRadius: '12px',
                    border: '1px solid var(--line)',
                    lineHeight: '1.4',
                  }}
                >
                  ℹ️ <b>Разделение статуса и денег:</b> Завершение визита фиксирует факт оказания услуги, но не закрывает долг и не создаёт фиктивной оплаты.
                </div>

                {/* SPRINT M12: Cash Desk Payment Action */}
                {canManageFinance && (
                  <button
                    type="button"
                    data-testid="register-payment-btn"
                    onClick={() => {
                      setPaymentAmountStr((debtMinor > 0 ? debtMinor / 100 : costMinor / 100).toString());
                      setShowPaymentModal(true);
                    }}
                    style={{
                      height: '40px',
                      borderRadius: '14px',
                      border: 'none',
                      background: 'var(--pos)',
                      color: 'var(--brand-fg)',
                      fontSize: '13.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    💵 {debtMinor > 0 ? `Принять оплату (${(debtMinor / 100).toLocaleString('ru-RU')} ₸)` : 'Принять платёж / аванс'}
                  </button>
                )}

                {/* SPRINT M12 & M13: Payment & Refund History */}
                <div data-testid="payment-history-block" style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--fg)', textTransform: 'uppercase' }}>
                      История кассовых операций ({visitPayments.length})
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      Оплачено: {(paidMinor / 100).toLocaleString('ru-RU')} ₸
                    </span>
                  </div>

                  {visitPayments.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--muted2)', fontStyle: 'italic', padding: '4px 0' }}>
                      Оплат по этому визиту пока не зафиксировано
                    </div>
                  ) : (
                    <div data-testid="payment-history-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {visitPayments.map((p) => {
                        const isRefund = p.payment_type === 'refund' || (p as any).kind === 'refund';
                        const d = new Date(p.created_at);
                        const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const methodLabel = p.payment_method === 'cash' ? 'Наличные' : p.payment_method === 'card' ? 'Карта' : p.payment_method === 'advance' ? 'Аванс' : 'Kaspi / QR';

                        return (
                          <div
                            key={p.id}
                            data-testid="payment-history-item"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '8px 10px',
                              borderRadius: '12px',
                              background: isRefund ? 'color-mix(in srgb, var(--neg) 10%, var(--panel))' : 'color-mix(in srgb, var(--pos) 12%, var(--panel))',
                              border: `1px solid ${isRefund ? 'color-mix(in srgb, var(--neg) 30%, var(--panel))' : 'color-mix(in srgb, var(--pos) 12%, var(--panel))'}`,
                              fontSize: '12px',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 700, color: isRefund ? 'var(--neg)' : 'var(--pos)' }}>
                                {isRefund ? '↺ Возврат' : '✓ Поступление'}: {isRefund ? '-' : '+'}{(p.amount_minor / 100).toLocaleString('ru-RU')} {currencySymbol}
                                <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: '6px' }}>({methodLabel})</span>
                              </div>
                              <div style={{ fontSize: '10.5px', color: 'var(--muted)', marginTop: '2px' }}>
                                {dateStr} • {p.cashier_name} {p.comment ? `• ${p.comment}` : ''}
                              </div>
                            </div>

                            {!isRefund && canManageFinance && (
                              <button
                                type="button"
                                data-testid="refund-payment-btn"
                                onClick={() => {
                                  setSelectedPaymentForRefund(p);
                                  setRefundAmountStr((p.amount_minor / 100).toString());
                                  setShowRefundModal(true);
                                }}
                                title="Оформить возврат средств"
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: '10px',
                                  border: '1px solid color-mix(in srgb, var(--neg) 40%, var(--panel))',
                                  background: 'var(--panel)',
                                  color: 'var(--neg)',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                Возврат
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              ) : (
                <div
                  data-testid="master-restricted-view"
                  style={{
                    background: 'var(--canvas)',
                    border: '1px solid var(--line)',
                    borderRadius: '22px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>✂️</span>
                    <span>Рабочий профиль мастера</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: '1.4' }}>
                    Вы авторизованы как специалист. Доступ к кассовому журналу, долгам и финансовым сводкам компании ограничен ролью управляющего.
                  </div>
                </div>
              )}

              {/* Status Specific Banners (M09) */}
              {active.status === 'cancelled' && (
                <div
                  data-testid="cancelled-banner"
                  style={{
                    background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))',
                    border: '1px solid color-mix(in srgb, var(--neg) 40%, var(--panel))',
                    borderRadius: '18px',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--neg)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>❌</span>
                    <span>Запись отменена</span>
                  </div>
                  {(bookingDetail?.cancellation_reason || cancelReason) && (
                    <div style={{ fontSize: '13px', color: 'var(--neg)' }} data-testid="cancellation-reason-text">
                      <b>Причина:</b> {bookingDetail?.cancellation_reason || cancelReason}
                    </div>
                  )}
                  {bookingDetail?.cancelled_at && (
                    <div style={{ fontSize: '11px', color: 'var(--neg)' }}>
                      Время отмены: {new Date(bookingDetail.cancelled_at).toLocaleString('ru-RU', { timeZone: timezoneIana })}
                    </div>
                  )}
                </div>
              )}

              {active.status === 'no_show' && (
                <div
                  data-testid="no-show-banner"
                  style={{
                    background: '#FFF7ED',
                    border: '1px solid #FDBA74',
                    borderRadius: '18px',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#9A3412', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⚠️</span>
                    <span>Клиент не явился (No-show)</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#C2410C' }}>
                    Неявка зафиксирована в истории визита.
                  </div>
                </div>
              )}

              {/* Services breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--fg)' }}>
                  Состав заказа ({bookingDetail?.items?.length || active.services.length})
                </div>
                {isLoadingDetail ? (
                  <div style={{ fontSize: '12px', color: 'var(--muted2)' }}>Загрузка деталей услуг…</div>
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
                          background: 'var(--canvas)',
                          borderRadius: '12px',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{it.service_name}</span>
                          <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '6px' }}>
                            ({it.duration_minutes} мин.)
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, color: 'var(--fg)' }}>
                          {(it.price_minor / 100).toLocaleString('ru-RU')} {currencySymbol}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                    {active.services.join(', ')}
                    {userRole !== 'master' && ` — ${(active.amount_minor / 100).toLocaleString('ru-RU')} ${currencySymbol}`}
                  </div>
                )}
              </div>

              {/* Event History / Audit Trail (Sprint M09) */}
              <div
                data-testid="visit-history-block"
                style={{
                  background: 'var(--canvas)',
                  border: '1px solid var(--line)',
                  borderRadius: '18px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--fg)' }}>
                    История изменений и событий ({bookingDetail?.events?.length || 0})
                  </div>
                </div>
                {bookingDetail?.events && bookingDetail.events.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '160px', overflowY: 'auto' }}>
                    {bookingDetail.events.map((ev, idx) => {
                      const eventTime = new Date(ev.created_at).toLocaleString('ru-RU', {
                        timeZone: timezoneIana,
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      let title = ev.event_type;
                      let icon = '📝';
                      let color = 'var(--fg)';

                      if (ev.event_type === 'created') {
                        title = 'Запись создана';
                        icon = '✨';
                        color = 'var(--brand)';
                      } else if (ev.event_type === 'confirmed') {
                        title = 'Запись подтверждена';
                        icon = '✓';
                        color = 'var(--pos)';
                      } else if (ev.event_type === 'rescheduled') {
                        title = 'Перенос времени визита';
                        icon = '📅';
                        color = 'var(--s-arrived)';
                      } else if (ev.event_type === 'cancelled') {
                        title = `Запись отменена: ${bookingDetail?.cancellation_reason || 'по запросу'}`;
                        icon = '❌';
                        color = 'var(--neg)';
                      } else if (ev.event_type === 'status_changed') {
                        title = `Смена статуса: ${ev.new_data?.status || 'обновлено'}`;
                        icon = '🔄';
                        color = 'var(--muted)';
                      } else if (ev.event_type === 'visit_completed') {
                        title = 'Визит успешно завершен';
                        icon = '🏁';
                        color = 'var(--pos)';
                      }

                      const actorLabel = ev.actor_type === 'customer' ? 'Клиент' : ev.actor_type === 'staff' ? 'Администратор' : 'Система';

                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                            fontSize: '12px',
                            background: 'var(--panel)',
                            border: '1px solid var(--line)',
                            borderRadius: '12px',
                            padding: '6px 10px',
                          }}
                        >
                          <span style={{ fontSize: '13px' }}>{icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color }}>{title}</div>
                            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                              {actorLabel} • {eventTime}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--muted2)' }}>История событий загружается…</div>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                {active.status === 'pending' && (
                  <button
                    type="button"
                    data-testid="status-btn-confirm"
                    onClick={() => handleUpdateStatus('confirmed')}
                    disabled={isUpdatingStatus}
                    style={{
                      height: '42px',
                      borderRadius: '14px',
                      border: 'none',
                      background: 'var(--brand)',
                      color: 'var(--brand-fg)',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {isUpdatingStatus ? 'Обновление...' : '✓ Подтвердить запись'}
                  </button>
                )}
                {active.status === 'confirmed' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      data-testid="status-btn-arrived"
                      onClick={() => handleUpdateStatus('arrived')}
                      disabled={isUpdatingStatus}
                      style={{
                        flex: 1,
                        height: '42px',
                        borderRadius: '14px',
                        border: 'none',
                        background: 'var(--s-arrived)',
                        color: 'var(--brand-fg)',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {isUpdatingStatus ? 'Обновление...' : 'Клиент прибыл'}
                    </button>
                    <button
                      type="button"
                      data-testid="status-btn-no-show"
                      onClick={() => handleUpdateStatus('no_show')}
                      disabled={isUpdatingStatus}
                      title="Отметить неявку клиента"
                      style={{
                        height: '42px',
                        padding: '0 14px',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                        background: 'var(--panel)',
                        color: 'var(--muted)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Не явился
                    </button>
                  </div>
                )}
                {active.status === 'arrived' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      data-testid="status-btn-in-progress"
                      onClick={() => handleUpdateStatus('in_progress')}
                      disabled={isUpdatingStatus}
                      style={{
                        flex: 1,
                        height: '42px',
                        borderRadius: '14px',
                        border: 'none',
                        background: 'var(--brand)',
                        color: 'var(--brand-fg)',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {isUpdatingStatus ? 'Обновление...' : 'Начать визит'}
                    </button>
                    <button
                      type="button"
                      data-testid="status-btn-no-show"
                      onClick={() => handleUpdateStatus('no_show')}
                      disabled={isUpdatingStatus}
                      title="Отметить неявку клиента"
                      style={{
                        height: '42px',
                        padding: '0 14px',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                        background: 'var(--panel)',
                        color: 'var(--muted)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Не явился
                    </button>
                  </div>
                )}
                {active.status === 'in_progress' && (
                  <button
                    type="button"
                    data-testid="status-btn-completed"
                    onClick={() => handleUpdateStatus('completed')}
                    disabled={isUpdatingStatus}
                    style={{
                      height: '42px',
                      borderRadius: '14px',
                      border: 'none',
                      background: 'var(--pos)',
                      color: 'var(--brand-fg)',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {isUpdatingStatus ? 'Обновление...' : 'Завершить визит'}
                  </button>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {active.status !== 'completed' && active.status !== 'cancelled' && active.status !== 'no_show' && (
                    <>
                      <button
                        type="button"
                        data-testid="visit-card-reschedule-btn"
                        onClick={() => setShowRescheduleModal(true)}
                        style={{
                          flex: 1,
                          height: '38px',
                          borderRadius: '12px',
                          border: '1px solid var(--line)',
                          background: 'var(--panel)',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Перенести
                      </button>
                      <button
                        type="button"
                        data-testid="visit-card-cancel-btn"
                        onClick={() => setShowCancelModal(true)}
                        style={{
                          flex: 1,
                          height: '38px',
                          borderRadius: '12px',
                          border: '1px solid color-mix(in srgb, var(--neg) 40%, var(--panel))',
                          background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))',
                          color: 'var(--neg)',
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
                      borderRadius: '12px',
                      border: '1px solid var(--line)',
                      background: 'var(--canvas)',
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

      {/* Cancel Modal (Sprint M09) */}
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
              maxWidth: '440px',
              background: 'var(--panel)',
              borderRadius: '22px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--fg)' }}>
              Подтверждение отмены записи
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: '1.4' }}>
              Запись <b>#{selectedBooking.public_ref}</b> ({selectedBooking.customer_name}) будет отменена. Слот будет немедленно освобожден в календаре и публичной записи, а факт отмены сохранится в истории.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg)' }}>
                Выберите причину отмены:
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {[
                  'Клиент отменил (звонок / сообщение)',
                  'Клиент не подтвердил запись',
                  'Мастер заболел / недоступен',
                  'Ошибка / дубль записи',
                  'Форс-мажор салона',
                ].map(reason => (
                  <button
                    key={reason}
                    type="button"
                    data-testid="cancel-reason-chip"
                    onClick={() => setCancelReason(reason)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      border: cancelReason === reason ? '1px solid var(--neg)' : '1px solid var(--muted2)',
                      background: cancelReason === reason ? 'color-mix(in srgb, var(--neg) 10%, var(--panel))' : 'var(--canvas)',
                      color: cancelReason === reason ? 'var(--neg)' : 'var(--fg)',
                      cursor: 'pointer',
                      fontWeight: cancelReason === reason ? 600 : 400,
                    }}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <input
                type="text"
                data-testid="cancel-reason-input"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Или введите свою причину отмены"
                style={{
                  marginTop: '6px',
                  height: '38px',
                  padding: '0 12px',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  fontSize: '13px',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                style={{ padding: '8px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)', cursor: 'pointer' }}
              >
                Назад
              </button>
              <button
                type="button"
                data-testid="confirm-cancel-btn"
                onClick={handleCancelBooking}
                disabled={isUpdatingStatus}
                style={{
                  padding: '8px 16px',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'var(--neg)',
                  color: 'var(--brand-fg)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isUpdatingStatus ? 'Отмена...' : 'Подтвердить отмену'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal (Sprint M08 / M09) */}
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
              maxWidth: '420px',
              background: 'var(--panel)',
              borderRadius: '22px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Перенос записи</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Выберите нового специалиста, дату или время для визита #{selectedBooking.public_ref}.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Специалист</label>
              <select
                data-testid="reschedule-staff-select"
                value={rescheduleStaffId || selectedBooking.staff_id}
                onChange={e => setRescheduleStaffId(e.target.value)}
                style={{ height: '40px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)', fontSize: '14px' }}
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
                data-testid="reschedule-date-input"
                value={rescheduleDate}
                onChange={e => setRescheduleDate(e.target.value)}
                style={{ height: '40px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>Новое время</label>
              <input
                type="time"
                data-testid="reschedule-time-input"
                value={rescheduleTime}
                onChange={e => setRescheduleTime(e.target.value)}
                style={{ height: '40px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowRescheduleModal(false)}
                style={{ padding: '8px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)', cursor: 'pointer' }}
              >
                Назад
              </button>
              <button
                type="button"
                data-testid="confirm-reschedule-btn"
                onClick={handleRescheduleBooking}
                disabled={isUpdatingStatus}
                style={{ padding: '8px 16px', borderRadius: '12px', border: 'none', background: 'var(--brand)', color: 'var(--brand-fg)', fontWeight: 600, cursor: 'pointer' }}
              >
                {isUpdatingStatus ? 'Перенос...' : 'Перенести запись'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SPRINT M12: Register Payment Modal */}
      {showPaymentModal && selectedBooking && (
        <div
          data-testid="payment-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
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
              maxWidth: '460px',
              background: 'var(--panel)',
              borderRadius: '22px',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg)' }}>Приём оплаты</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Запись #{selectedBooking.public_ref} • {selectedBooking.customer_name}</div>
                <div style={{ fontSize: '11px', color: 'var(--muted2)', marginTop: '2px' }}>Фискальный чек выбивается салоном на своей ККМ</div>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterPayment} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Financial Context */}
              <div style={{ background: 'var(--canvas)', padding: '12px 14px', borderRadius: '14px', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: '11px' }}>Стоимость заказа</div>
                  <div style={{ fontWeight: 700, color: 'var(--fg)', marginTop: '2px' }}>
                    {((selectedBooking.cost_minor || selectedBooking.amount_minor) / 100).toLocaleString('ru-RU')} ₸
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: '11px' }}>Остаток долга</div>
                  <div style={{ fontWeight: 800, color: 'var(--neg)', marginTop: '2px' }}>
                    {((selectedBooking.debt_minor ?? selectedBooking.amount_minor) / 100).toLocaleString('ru-RU')} ₸
                  </div>
                </div>
              </div>

              {/* Amount Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Сумма платежа (₸) *
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  data-testid="payment-amount-input"
                  value={paymentAmountStr}
                  onChange={e => setPaymentAmountStr(e.target.value)}
                  placeholder="Например, 3000"
                  required
                  style={{
                    height: '42px',
                    padding: '0 12px',
                    borderRadius: '12px',
                    border: '1px solid var(--line)',
                    fontSize: '16px',
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
              </div>

              {/* Quick Fill Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <button
                  type="button"
                  data-testid="pay-full-amount-btn"
                  onClick={() => setPaymentAmountStr(((selectedBooking.debt_minor ?? selectedBooking.amount_minor) / 100).toString())}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '10px',
                    border: '1px solid color-mix(in srgb, var(--pos) 30%, var(--panel))',
                    background: 'color-mix(in srgb, var(--pos) 12%, var(--panel))',
                    color: 'var(--pos)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Вся сумма ({((selectedBooking.debt_minor ?? selectedBooking.amount_minor) / 100).toLocaleString('ru-RU')} ₸)
                </button>
                {[1000, 2000, 3000, 5000].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setPaymentAmountStr(val.toString())}
                    style={{
                      padding: '5px 8px',
                      borderRadius: '10px',
                      border: '1px solid var(--line)',
                      background: 'var(--panel)',
                      color: 'var(--muted)',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {val.toLocaleString('ru-RU')} ₸
                  </button>
                ))}
              </div>

              {/* Payment Method */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Способ оплаты *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {[
                    { id: 'cash' as PaymentMethod, label: 'Наличные', icon: '💵' },
                    { id: 'external_transfer' as PaymentMethod, label: 'Kaspi / QR', icon: '📱' },
                    { id: 'card' as PaymentMethod, label: 'Карта / Терминал', icon: '💳' },
                  ].map(m => (
                    <button
                      key={m.id}
                      type="button"
                      data-testid={`payment-method-${m.id}`}
                      onClick={() => setPaymentMethod(m.id)}
                      style={{
                        padding: '10px 8px',
                        borderRadius: '12px',
                        border: paymentMethod === m.id ? '2px solid var(--brand)' : '1px solid var(--muted2)',
                        background: paymentMethod === m.id ? 'color-mix(in srgb, var(--brand) 10%, var(--panel))' : 'var(--panel)',
                        color: paymentMethod === m.id ? 'var(--brand)' : 'var(--muted)',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>{m.icon}</span>
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Comment */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Комментарий / номер чека (опционально)
                </label>
                <input
                  type="text"
                  data-testid="payment-comment-input"
                  value={paymentComment}
                  onChange={e => setPaymentComment(e.target.value)}
                  placeholder="Чек #1234, без сдачи"
                  style={{
                    height: '38px',
                    padding: '0 10px',
                    borderRadius: '12px',
                    border: '1px solid var(--line)',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  style={{ padding: '9px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  data-testid="submit-payment-btn"
                  disabled={isSubmittingPayment}
                  style={{
                    padding: '9px 20px',
                    borderRadius: '12px',
                    border: 'none',
                    background: 'var(--pos)',
                    color: 'var(--brand-fg)',
                    fontWeight: 700,
                    cursor: isSubmittingPayment ? 'not-allowed' : 'pointer',
                    opacity: isSubmittingPayment ? 0.7 : 1,
                  }}
                >
                  {isSubmittingPayment ? 'Проведение платежа…' : 'Внести платёж'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SPRINT M13: Refund Modal */}
      {showRefundModal && selectedPaymentForRefund && (
        <div
          data-testid="refund-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
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
              maxWidth: '460px',
              background: 'var(--panel)',
              borderRadius: '22px',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--neg)' }}>Оформление возврата</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>К платежу #{(selectedPaymentForRefund.id).slice(-6)}</div>
              </div>
              <button
                type="button"
                onClick={() => { setShowRefundModal(false); setSelectedPaymentForRefund(null); }}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmRefund} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: 'color-mix(in srgb, var(--neg) 10%, var(--panel))', padding: '12px 14px', borderRadius: '14px', border: '1px solid color-mix(in srgb, var(--neg) 30%, var(--panel))', fontSize: '12.5px', color: 'var(--neg)', lineHeight: '1.4' }}>
                ℹ️ <b>Корректирующее движение:</b> Возврат оформляется обратной проводкой. Исходный платёж сохраняется в кассовом аудите.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Сумма возврата (₸) *
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max={selectedPaymentForRefund.amount_minor / 100}
                  data-testid="refund-amount-input"
                  value={refundAmountStr}
                  onChange={e => setRefundAmountStr(e.target.value)}
                  required
                  style={{
                    height: '42px',
                    padding: '0 12px',
                    borderRadius: '12px',
                    border: '1px solid var(--line)',
                    fontSize: '16px',
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  Максимум: {(selectedPaymentForRefund.amount_minor / 100).toLocaleString('ru-RU')} ₸
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Причина возврата *
                </label>
                <select
                  data-testid="refund-reason-select"
                  value={refundReason}
                  onChange={e => setRefundReason(e.target.value)}
                  style={{
                    height: '40px',
                    padding: '0 10px',
                    borderRadius: '12px',
                    border: '1px solid var(--line)',
                    fontSize: '13px',
                    outline: 'none',
                    background: 'var(--panel)',
                  }}
                >
                  <option value="Отказ от части услуги">Отказ от части услуги</option>
                  <option value="Ошибка кассира при вводе суммы">Ошибка кассира при вводе суммы</option>
                  <option value="Претензия по качеству обслуживания">Претензия по качеству обслуживания</option>
                  <option value="Другое">Другое</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                  Пояснение (опционально)
                </label>
                <input
                  type="text"
                  data-testid="refund-comment-input"
                  value={refundComment}
                  onChange={e => setRefundComment(e.target.value)}
                  placeholder="Дополнительное пояснение"
                  style={{
                    height: '38px',
                    padding: '0 10px',
                    borderRadius: '12px',
                    border: '1px solid var(--line)',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => { setShowRefundModal(false); setSelectedPaymentForRefund(null); }}
                  style={{ padding: '9px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)', cursor: 'pointer' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  data-testid="confirm-refund-btn"
                  disabled={isSubmittingRefund}
                  style={{
                    padding: '9px 20px',
                    borderRadius: '12px',
                    border: 'none',
                    background: 'var(--neg)',
                    color: 'var(--brand-fg)',
                    fontWeight: 700,
                    cursor: isSubmittingRefund ? 'not-allowed' : 'pointer',
                    opacity: isSubmittingRefund ? 0.7 : 1,
                  }}
                >
                  {isSubmittingRefund ? 'Оформление…' : 'Подтвердить возврат'}
                </button>
              </div>
            </form>
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
              background: 'var(--panel)',
              borderRadius: '22px',
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))', borderRadius: '12px', border: '1px solid color-mix(in srgb, var(--brand) 30%, var(--panel))', fontSize: '12px', color: 'var(--brand)' }}>
                <span>🔗 Связан с карточкой: <b>{selectedCustomerName}</b></span>
                <button
                  type="button"
                  onClick={handleClearSelectedCustomer}
                  title="Отвязать карточку"
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontWeight: 700 }}
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
              />
            </div>

            {/* Suggestions dropdown */}
            {custSuggestions.length > 0 && !selectedCustomerId && (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                <div style={{ padding: '6px 10px', fontSize: '11px', color: 'var(--muted)', background: 'var(--canvas)', borderBottom: '1px solid var(--line)' }}>
                  Найдено в базе клиентов (нажмите для выбора):
                </div>
                {custSuggestions.map(c => (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCustomer(c)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--chip)', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--chip)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--panel)')}
                  >
                    <span style={{ fontWeight: 600 }}>{c.full_name}</span>
                    <span style={{ color: 'var(--muted)' }}>{(c as any).phone || c.phone_e164}</span>
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
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
                style={{ padding: '8px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                data-testid="submit-booking-btn"
                style={{ padding: '8px 16px', borderRadius: '12px', border: 'none', background: 'var(--brand)', color: 'var(--brand-fg)', fontWeight: 600 }}
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
              background: 'var(--panel)',
              borderRadius: '22px',
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
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
                  style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
                />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Окончание</label>
                <input
                  type="time"
                  value={blockEnd}
                  onChange={e => setBlockEnd(e.target.value)}
                  style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
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
                style={{ height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--line)' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' }}>
                {['Перерыв на обед', 'Обучение', 'Личные дела', 'Технический перерыв'].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setBlockReason(r)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '10px',
                      border: '1px solid var(--line)',
                      background: blockReason === r ? 'var(--brand2)' : 'var(--chip)',
                      color: blockReason === r ? 'var(--brand-fg)' : 'var(--fg)',
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
                style={{ padding: '8px 16px', borderRadius: '12px', border: '1px solid var(--line)', background: 'var(--panel)' }}
              >
                Отмена
              </button>
              <button
                type="submit"
                data-testid="submit-block-btn"
                style={{ padding: '8px 16px', borderRadius: '12px', border: 'none', background: 'var(--brand2)', color: 'var(--brand-fg)', fontWeight: 600 }}
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
              background: 'var(--panel)',
              borderRadius: '22px',
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
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', background: 'var(--canvas)', padding: '14px', borderRadius: '18px', border: '1px solid var(--line)' }}>
              <div>
                <span style={{ color: 'var(--muted)' }}>Специалист: </span>
                <b>{staffList.find(s => s.id === selectedBlock.staff_id)?.name || 'Все / Не указан'}</b>
              </div>
              <div>
                <span style={{ color: 'var(--muted)' }}>Время: </span>
                <b>{formatTimeInZone(selectedBlock.starts_at_utc, timezoneIana)} – {formatTimeInZone(selectedBlock.ends_at_utc, timezoneIana)}</b>
              </div>
              <div>
                <span style={{ color: 'var(--muted)' }}>Причина: </span>
                <b>{selectedBlock.block_reason || 'Перерыв / блокировка'}</b>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
              <button
                type="button"
                onClick={() => setSelectedBlock(null)}
                style={{
                  flex: 1,
                  height: '42px',
                  borderRadius: '14px',
                  border: '1px solid var(--line)',
                  background: 'var(--panel)',
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
                  borderRadius: '14px',
                  border: 'none',
                  background: 'var(--neg)',
                  color: 'var(--brand-fg)',
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
