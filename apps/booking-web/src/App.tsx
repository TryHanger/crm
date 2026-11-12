import React, { useState, useEffect, useMemo } from 'react';
import {
  PublicApiClient,
  PublicSiteResponse,
  BranchResponse,
  ServiceItemResponse,
  StaffPublicResponse,
  SlotResponse,
  BookingCreatedResponse,
  ApiError,
} from '@crm/api-client';
import { ManageBookingScreen } from './components/ManageBookingScreen';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

function getLocalDateString(dateObj: Date = new Date(), timeZone: string = 'Asia/Almaty'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(dateObj);
  } catch {
    return dateObj.toISOString().split('T')[0];
  }
}

function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getBranchPhones(branch?: (BranchResponse & { phones?: string[] | null }) | null): string[] {
  if (!branch) return ['+7 (701) 555-01-23'];
  if (Array.isArray(branch.phones) && branch.phones.length > 0) {
    const cleaned = branch.phones.map((p) => p.trim()).filter(Boolean);
    if (cleaned.length > 0) return cleaned;
  }
  const raw = String(branch.phone || branch.phone_number || '');
  const list = raw
    .split(/[,;\n]+/)
    .map((p: string) => p.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ['+7 (701) 555-01-23'];
}

function formatDayTitle(ymd: string, todayYmd: string): string {
  if (!ymd) return 'Дата не выбрана';
  const d = parseYMD(ymd);
  const diffDays = Math.round((parseYMD(ymd).getTime() - parseYMD(todayYmd).getTime()) / 86400000);
  const base = `${WD_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS_G[d.getMonth()]}`;
  if (diffDays === 0) return `Сегодня · ${base}`;
  if (diffDays === 1) return `Завтра · ${base}`;
  return base;
}

function formatShortDay(ymd: string, todayYmd: string): string {
  if (!ymd) return '';
  const d = parseYMD(ymd);
  const diffDays = Math.round((parseYMD(ymd).getTime() - parseYMD(todayYmd).getTime()) / 86400000);
  if (diffDays === 0) return `Сегодня, ${d.getDate()} ${MONTHS_G[d.getMonth()]}`;
  if (diffDays === 1) return `Завтра, ${d.getDate()} ${MONTHS_G[d.getMonth()]}`;
  return `${WD[d.getDay()]}, ${d.getDate()} ${MONTHS_G[d.getMonth()]}`;
}

function formatTime(isoUtc: string, timeZone: string = 'Asia/Almaty'): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(isoUtc));
  } catch {
    const d = new Date(isoUtc);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function toMin(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export const App: React.FC = () => {
  const [api] = useState(() => new PublicApiClient());

  // Global Tenant state
  const [site, setSite] = useState<PublicSiteResponse | null>(null);
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<BranchResponse | null>(null);
  const [services, setServices] = useState<ServiceItemResponse[]>([]);
  const [staffList, setStaffList] = useState<StaffPublicResponse[]>([]);

  // Deep-link Manage token
  const [manageToken, setManageToken] = useState<string | null>(() => {
    const pathname = window.location.pathname;
    const match = pathname.match(/^\/manage\/([^/]+)/);
    if (match) return match[1];
    const params = new URLSearchParams(window.location.search);
    return params.get('manage') || null;
  });

  // Flow & Step state
  // mode: null (shows chooser), 'master' (master-first), 'date' (date-first)
  const [mode, setMode] = useState<'master' | 'date' | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const flow = params.get('flow');
    if (flow === 'master-first' || params.get('master')) return 'master';
    if (flow === 'time-first') return 'date';
    return null;
  });

  // Current open accordion step
  const [activeStep, setActiveStep] = useState<string>('service');

  // Booking selections
  const [selectedServices, setSelectedServices] = useState<ServiceItemResponse[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffPublicResponse | 'any' | null>(null);
  const todayYmd = useMemo(() => getLocalDateString(new Date(), selectedBranch?.timezone_iana), [selectedBranch]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [datePageOffset, setDatePageOffset] = useState<number>(0);
  const [availableSlots, setAvailableSlots] = useState<SlotResponse[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotResponse | null>(null);

  // Customer info
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('+7 ');
  const [clientEmail, setClientEmail] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [touchedContacts, setTouchedContacts] = useState(false);

  // Review & Booking result
  const [isReview, setIsReview] = useState(false);
  const [bookingResult, setBookingResult] = useState<BookingCreatedResponse | null>(null);
  const [bookingIntentKey, setBookingIntentKey] = useState<string | null>(null);

  // Calendar & Call Modal state
  const [isCalOpen, setIsCalOpen] = useState(false);
  const [isCallOpen, setIsCallOpen] = useState(false);
  const [expandedSvc, setExpandedSvc] = useState<string[]>([]);
  const [calMonthOffset, setCalMonthOffset] = useState(0);

  // Loading & error
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [domainNotFound, setDomainNotFound] = useState(false);
  const [tenantSuspended, setTenantSuspended] = useState(false);

  // Step ordering: service is always first in both variants
  const stepOrder = useMemo(() => {
    if (mode === 'date') {
      return ['service', 'date', 'time', 'master', 'contacts'];
    }
    return ['service', 'master', 'date', 'time', 'contacts'];
  }, [mode]);

  // Load tenant
  useEffect(() => {
    const initTenant = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const siteData = await api.getSite();
        setSite(siteData);

        if (!siteData.is_published) {
          setTenantSuspended(true);
          return;
        }

        const branchList = await api.getBranches();
        setBranches(branchList);
        const defBranch = branchList[0] || null;
        setSelectedBranch(defBranch);

        if (defBranch) {
          const svcs = await api.getServices(defBranch.id);
          setServices(svcs || []);

          const stf = await api.getStaff(defBranch.id);
          setStaffList(stf || []);

          // Check query param for master
          const params = new URLSearchParams(window.location.search);
          const masterId = params.get('master');
          if (masterId && stf) {
            const found = stf.find(s => s.id === masterId);
            if (found) {
              setSelectedStaff(found);
              setMode('master');
              setActiveStep('service');
            }
          }
        }
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 404) {
          setDomainNotFound(true);
        } else if (err instanceof ApiError && err.status === 403) {
          setTenantSuspended(true);
        } else {
          setError({
            title: 'Не удалось загрузить данные',
            message: err.message || 'Проверьте соединение с интернетом',
          });
        }
      } finally {
        setIsLoading(false);
      }
    };
    initTenant();
  }, [api]);

  // Fetch slots whenever branch, services, staff, date change
  useEffect(() => {
    let isCancelled = false;
    if (!selectedBranch || !selectedDate) return;

    const fetchSlots = async () => {
      try {
        setIsLoadingSlots(true);
        const staffId = typeof selectedStaff === 'object' && selectedStaff !== null ? selectedStaff.id : undefined;
        const serviceIds = selectedServices.length > 0 ? selectedServices.map(s => s.id) : (services[0] ? [services[0].id] : []);

        const res = await api.searchAvailability({
          branch_id: selectedBranch.id,
          service_ids: serviceIds,
          from_date: selectedDate,
          to_date: selectedDate,
          staff_id: staffId,
          staff_mode: selectedStaff === 'any' ? 'any' : undefined,
        });

        if (isCancelled) return;
        const slots = res.slots || [];
        setAvailableSlots(slots);

        // Keep or reset selected slot
        if (selectedSlot && !slots.some(s => s.quote_id === selectedSlot.quote_id)) {
          setSelectedSlot(null);
        }
      } catch (err) {
        if (!isCancelled) {
          setAvailableSlots([]);
        }
      } finally {
        if (!isCancelled) setIsLoadingSlots(false);
      }
    };

    fetchSlots();
    return () => { isCancelled = true; };
  }, [selectedBranch, selectedDate, selectedStaff, selectedServices, services, api]);

  // Completion check for each step
  const contactsValid = useMemo(() => {
    const rawDigits = clientPhone.replace(/\D/g, '');
    return clientName.trim().length >= 2 && rawDigits.length >= 10;
  }, [clientName, clientPhone]);

  const have = (stepId: string): boolean => {
    if (stepId === 'master') return selectedStaff !== null;
    if (stepId === 'service') return selectedServices.length > 0;
    if (stepId === 'date') return !!selectedDate;
    if (stepId === 'time') return selectedSlot !== null;
    if (stepId === 'contacts') return contactsValid;
    return false;
  };

  const isUnlocked = (stepId: string): boolean => {
    const idx = stepOrder.indexOf(stepId);
    if (idx <= 0) return true;
    for (let i = 0; i < idx; i++) {
      if (!have(stepOrder[i])) return false;
    }
    return true;
  };

  const advanceAfterSelection = (overrides: {
    services?: ServiceItemResponse[];
    staff?: StaffPublicResponse | 'any' | null;
    date?: string;
    slot?: SlotResponse | null;
  }) => {
    const nextSvcs = overrides.services !== undefined ? overrides.services : selectedServices;
    const nextStaff = overrides.staff !== undefined ? overrides.staff : selectedStaff;
    const nextDate = overrides.date !== undefined ? overrides.date : selectedDate;
    const nextSlot = overrides.slot !== undefined ? overrides.slot : selectedSlot;

    const isDoneStep = (id: string) => {
      if (id === 'service') return nextSvcs.length > 0;
      if (id === 'master') return nextStaff !== null;
      if (id === 'date') return !!nextDate;
      if (id === 'time') return nextSlot !== null;
      if (id === 'contacts') return contactsValid;
      return false;
    };

    const next = stepOrder.find(id => !isDoneStep(id)) || null;
    setTimeout(() => {
      if (next) {
        setActiveStep(next);
      } else {
        setActiveStep('contacts');
        setIsReview(true);
      }
    }, 220);
  };

  // Branch switcher
  const handleSelectBranch = async (b: BranchResponse) => {
    setSelectedBranch(b);
    setSelectedServices([]);
    setSelectedStaff(null);
    setSelectedSlot(null);
    setSelectedDate('');
    try {
      const svcs = await api.getServices(b.id);
      setServices(svcs || []);
      const stf = await api.getStaff(b.id);
      setStaffList(stf || []);
    } catch {}
  };

  // Mode selection: service is always first in both variants
  const handleChooseMode = (m: 'master' | 'date') => {
    setMode(m);
    setActiveStep('service');
  };

  // Service select (single click selects & advances)
  const handleSelectService = (svc: ServiceItemResponse) => {
    const nextSvcs = [svc];
    setSelectedServices(nextSvcs);
    setSelectedSlot(null);
    advanceAfterSelection({ services: nextSvcs, slot: null });
  };

  // Staff select
  const handleSelectStaff = (st: StaffPublicResponse | 'any') => {
    setSelectedStaff(st);
    setSelectedSlot(null);
    advanceAfterSelection({ staff: st, slot: null });
  };

  // Date select
  const handleSelectDate = (ymd: string) => {
    setSelectedDate(ymd);
    setSelectedSlot(null);
    advanceAfterSelection({ date: ymd, slot: null });
  };

  // Time select
  const handleSelectSlot = (slot: SlotResponse) => {
    setSelectedSlot(slot);
    advanceAfterSelection({ slot });
  };

  // Format total price
  const totalPriceFormatted = useMemo(() => {
    if (selectedSlot && selectedSlot.price_minor > 0) {
      const cur = selectedSlot.currency === 'KZT' ? '₸' : selectedSlot.currency;
      return `${new Intl.NumberFormat('ru-RU').format(selectedSlot.price_minor / 100)} ${cur}`;
    }
    if (selectedServices.length > 0) {
      const totalMinor = selectedServices.reduce((sum, s) => sum + (s.base_price_minor || 0), 0);
      const currency = selectedServices[0]?.currency || 'KZT';
      const formatted = new Intl.NumberFormat('ru-RU').format(totalMinor / 100);
      return `${formatted} ${currency === 'KZT' ? '₸' : currency}`;
    }
    return '0 ₸';
  }, [selectedSlot, selectedServices]);

  // Total duration in minutes
  const totalDuration = useMemo(() => {
    if (selectedSlot?.duration_minutes) return selectedSlot.duration_minutes;
    return selectedServices.reduce((sum, s) => sum + (s.base_duration_minutes || 0), 0);
  }, [selectedSlot, selectedServices]);

  // Submit booking
  const handleSubmitBooking = async () => {
    if (!selectedBranch || !selectedSlot || !contactsValid) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const idempotencyKey = bookingIntentKey || `bk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      if (!bookingIntentKey) setBookingIntentKey(idempotencyKey);

      const staffId = typeof selectedStaff === 'object' && selectedStaff !== null ? selectedStaff.id : selectedSlot.staff_id;
      const serviceIds = selectedServices.length > 0 ? selectedServices.map(s => s.id) : [services[0]?.id].filter(Boolean);

      const res = await api.createBooking(
        {
          branch_id: selectedBranch.id,
          staff_id: staffId,
          service_ids: serviceIds,
          starts_at_utc: selectedSlot.starts_at_utc,
          quote_id: selectedSlot.quote_id,
          expected_price_minor: selectedSlot.price_minor,
          customer_name: clientName.trim(),
          customer_phone: clientPhone.trim(),
          customer_email: clientEmail.trim() || undefined,
          notes: clientNote.trim() || undefined,
        },
        idempotencyKey
      );

      setBookingResult(res);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setError({
          title: 'Слот уже занят',
          message: 'К сожалению, это время только что забронировали. Выберите другое время.',
        });
        setActiveStep('time');
      } else {
        setError({
          title: 'Ошибка оформления',
          message: err.message || 'Не удалось завершить запись. Попробуйте еще раз.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Phone input formatting
  const handlePhoneChange = (val: string) => {
    let clean = val.replace(/\D/g, '');
    if (clean.startsWith('8')) clean = '7' + clean.slice(1);
    if (!clean.startsWith('7')) clean = '7' + clean;
    clean = clean.slice(0, 11);

    const a = clean.slice(1, 4);
    const b = clean.slice(4, 7);
    const c = clean.slice(7, 9);
    const d = clean.slice(9, 11);

    let res = '+7';
    if (a) res += ` (${a}`;
    if (a.length === 3) res += ')';
    if (b) res += ` ${b}`;
    if (c) res += `-${c}`;
    if (d) res += `-${d}`;

    setClientPhone(res);
  };

  // 8 Date chips array
  const dateChips = useMemo(() => {
    const list = [];
    const baseDate = parseYMD(todayYmd);
    for (let i = 0; i < 8; i++) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() + datePageOffset + i);
      const ymd = getLocalDateString(d, selectedBranch?.timezone_iana);
      const diff = datePageOffset + i;
      const wdText = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : WD[d.getDay()];
      list.push({ ymd, date: d, diff, wdText, dayNum: d.getDate() });
    }
    return list;
  }, [todayYmd, datePageOffset, selectedBranch]);

  // Calendar dates generation
  const calDays = useMemo(() => {
    const base = parseYMD(todayYmd);
    const curMonthDate = new Date(base.getFullYear(), base.getMonth() + calMonthOffset, 1);
    const lead = (curMonthDate.getDay() + 6) % 7;
    const daysInMonth = new Date(curMonthDate.getFullYear(), curMonthDate.getMonth() + 1, 0).getDate();

    const items = [];
    for (let i = 0; i < lead; i++) {
      items.push({ empty: true, key: `empty_${i}` });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(curMonthDate.getFullYear(), curMonthDate.getMonth(), day);
      const ymd = getLocalDateString(d, selectedBranch?.timezone_iana);
      const isPast = d.getTime() < parseYMD(todayYmd).getTime();
      items.push({
        empty: false,
        key: ymd,
        ymd,
        dayNum: day,
        isPast,
        isToday: ymd === todayYmd,
        isSelected: ymd === selectedDate,
      });
    }
    return {
      monthTitle: `${MONTHS[curMonthDate.getMonth()]} ${curMonthDate.getFullYear()}`,
      items,
    };
  }, [todayYmd, calMonthOffset, selectedBranch, selectedDate]);

  // Grouped slots (Morning, Afternoon, Evening)
  const groupedSlots = useMemo(() => {
    const morning: SlotResponse[] = [];
    const afternoon: SlotResponse[] = [];
    const evening: SlotResponse[] = [];

    availableSlots.forEach(s => {
      const timeStr = formatTime(s.starts_at_utc, selectedBranch?.timezone_iana);
      const m = toMin(timeStr);
      if (m < 720) morning.push(s);
      else if (m < 1020) afternoon.push(s);
      else evening.push(s);
    });

    return [
      { name: 'Утро', slots: morning },
      { name: 'День', slots: afternoon },
      { name: 'Вечер', slots: evening },
    ].filter(g => g.slots.length > 0);
  }, [availableSlots, selectedBranch]);

  // Summary labels & CTA state
  const isReady = have('master') && have('service') && have('date') && have('time') && contactsValid;
  const isDone = !!bookingResult;

  const ctaText = useMemo(() => {
    if (isSubmitting) return 'Оформление записи...';
    if (!have('master')) return 'Выберите мастера';
    if (!have('service')) return 'Выберите услугу';
    if (!have('date')) return 'Выберите дату';
    if (!have('time')) return 'Выберите время';
    if (!contactsValid) return 'Заполните контакты';
    const timeStr = selectedSlot ? formatTime(selectedSlot.starts_at_utc, selectedBranch?.timezone_iana) : '';
    return `Записаться на ${timeStr}`;
  }, [isSubmitting, selectedStaff, selectedServices, selectedDate, selectedSlot, contactsValid, selectedBranch]);

  // 1. Loading state
  if (isLoading && !site) {
    return (
      <div className="page" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <h2 style={{ color: 'var(--muted)', fontWeight: 500 }}>Загрузка онлайн-записи...</h2>
      </div>
    );
  }

  // 2. Domain not found
  if (domainNotFound) {
    return (
      <div className="page" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <h2>Компания не найдена</h2>
        <p style={{ color: 'var(--muted)' }}>Проверьте адрес сайта или обратитесь к администратору.</p>
      </div>
    );
  }

  // 3. Tenant suspended
  if (tenantSuspended) {
    return (
      <div className="page" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <h2>Онлайн-запись временно недоступна</h2>
        <p style={{ color: 'var(--muted)' }}>Свяжитесь с нами по телефону для уточнения деталей.</p>
      </div>
    );
  }

  // 4. Manage Token mode
  if (manageToken) {
    return (
      <div className="page">
        <header>
          <h1>{site?.display_name || 'Управление записью'}</h1>
        </header>
        <ManageBookingScreen
          token={manageToken}
          api={api}
          onBackToBooking={() => {
            setManageToken(null);
            setBookingResult(null);
            setMode(null);
            window.history.pushState({}, '', '/');
          }}
        />
      </div>
    );
  }

  return (
    <>
      {/* Decorative background shapes */}
      <svg className="deco a" viewBox="0 0 800 760" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="gA" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--shape)', stopOpacity: 0.95 }} />
            <stop offset="1" style={{ stopColor: 'var(--shape)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d="M800 0V760C640 740 520 640 470 500C420 360 330 300 210 270C90 240 20 130 0 0Z" fill="url(#gA)" />
      </svg>
      <svg className="deco b" viewBox="0 0 800 760" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="gB" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--shape)', stopOpacity: 0.95 }} />
            <stop offset="1" style={{ stopColor: 'var(--shape)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d="M0 760V180C90 150 200 190 280 280C380 390 380 520 470 600C540 660 660 690 800 760Z" fill="url(#gB)" />
      </svg>

      <div className="page" data-start={mode === null ? '' : undefined} data-done={isDone ? '' : undefined}>
        {/* Header */}
        <header>
          <div className="header-left">
            <h1>{site?.display_name || 'Онлайн-запись'}</h1>
            {branches.length > 1 ? (
              <select
                className="branch-select"
                value={selectedBranch?.id || ''}
                onChange={e => {
                  const b = branches.find(x => x.id === e.target.value);
                  if (b) handleSelectBranch(b);
                }}
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.address})
                  </option>
                ))}
              </select>
            ) : (
              <div className="addr">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" />
                  <circle cx="12" cy="11" r="2.2" />
                </svg>
                <span>{selectedBranch?.address || 'Алматы'}</span>
              </div>
            )}
          </div>
        </header>

        {/* Main Grid: Left Flow + Right Summary */}
        <main id="main" data-start={mode === null ? '' : undefined} data-done={isDone ? '' : undefined}>
          
          {/* Chooser: Welcome Screen */}
          <section className="chooser" id="chooser" aria-label="С чего начать">
            <div>
              <h2 className="ch-t">Как удобнее записаться?</h2>
              <p className="ch-s">Выберите, с чего начать</p>
            </div>
            <div className="ch-grid">
              <button type="button" className="ch-card tap" onClick={() => handleChooseMode('master')}>
                <span className="ch-ic">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="3.6" />
                    <path d="M5 20c.8-3.8 3.6-5.6 7-5.6s6.2 1.8 7 5.6" />
                  </svg>
                </span>
                <span className="ch-n">Выбрать мастера</span>
                <svg className="ch-go" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>

              <button type="button" className="ch-card tap" onClick={() => handleChooseMode('date')}>
                <span className="ch-ic">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
                    <path d="M3.5 10h17M8 3v4M16 3v4" />
                  </svg>
                </span>
                <span className="ch-n">Выбрать дату</span>
                <svg className="ch-go" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </section>

          {/* Accordion Flow */}
          <div className="flow">
            {/* Mode bar */}
            <div className="modebar" id="modebar">
              <b>{mode === 'date' ? 'Сначала дата' : 'Сначала мастер'}</b>
              <button
                type="button"
                className="lnk"
                onClick={() => {
                  setMode(null);
                  setIsReview(false);
                }}
              >
                Сменить
              </button>
            </div>

            {/* Steps in ordered sequence */}
            {stepOrder.map((stepId, index) => {
              const num = index + 1;
              const isCompleted = have(stepId);
              const isActive = activeStep === stepId;
              const state = isActive ? 'active' : isCompleted ? 'done' : 'todo';
              const canOpen = isUnlocked(stepId);

              // Step Summary Text
              let valText = '';
              if (stepId === 'master') {
                valText = selectedStaff === 'any' ? 'Любой свободный' : (selectedStaff?.display_name || '');
              } else if (stepId === 'service') {
                valText = selectedServices.map(s => s.name).join(', ');
              } else if (stepId === 'date') {
                valText = formatShortDay(selectedDate, todayYmd);
              } else if (stepId === 'time') {
                valText = selectedSlot ? formatTime(selectedSlot.starts_at_utc, selectedBranch?.timezone_iana) : '';
              } else if (stepId === 'contacts') {
                valText = contactsValid ? clientName.trim() : '';
              }

              // Step Titles
              const titles: Record<string, string> = {
                master: 'Мастер',
                service: 'Услуга',
                date: 'Дата',
                time: 'Время',
                contacts: 'Контакты',
              };

              return (
                <section
                  key={stepId}
                  className="step"
                  id={`s-${stepId}`}
                  data-state={state}
                >
                  <button
                    type="button"
                    className="step-h"
                    disabled={!canOpen || isActive}
                    aria-expanded={isActive}
                    onClick={() => {
                      setActiveStep(stepId);
                      setIsReview(false);
                    }}
                  >
                    <span className="num">
                      {isCompleted ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      ) : (
                        num
                      )}
                    </span>
                    <span className="st-t">{titles[stepId]}</span>
                    <span className="st-v">{valText}</span>
                    <span className="chg">Изменить</span>
                  </button>

                  <div className="step-b">
                    <div className="inner">
                      <div className="pad">
                        {/* 1. Master Step Content */}
                        {stepId === 'master' && (
                          <div id="masters">
                            {/* Any master card */}
                            <button
                              type="button"
                              className="mst tap"
                              aria-pressed={selectedStaff === 'any'}
                              onClick={() => handleSelectStaff('any')}
                            >
                              <span className="av">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <circle cx="9" cy="8.5" r="3.2" />
                                  <path d="M3 19c.6-3.4 3-5 6-5s5.4 1.6 6 5" />
                                  <path d="M16.5 5.6a3 3 0 0 1 0 5.8M18 14.3c1.7.5 2.7 2 3 4.7" />
                                </svg>
                              </span>
                              <span style={{ display: 'block', minWidth: 0 }}>
                                <span className="nm">Любой мастер</span>
                                <span className="nx">первый свободный специалист</span>
                              </span>
                            </button>

                            {/* Specific masters */}
                            {staffList.map(st => {
                              const isSelected = typeof selectedStaff === 'object' && selectedStaff !== null && selectedStaff.id === st.id;
                              const ini = (st.display_name || 'М')[0].toUpperCase();
                              return (
                                <button
                                  key={st.id}
                                  type="button"
                                  className="mst tap"
                                  aria-pressed={isSelected}
                                  onClick={() => handleSelectStaff(st)}
                                >
                                  <span className="av">{ini}</span>
                                  <span style={{ display: 'block', minWidth: 0 }}>
                                    <span className="nm">{st.display_name}</span>
                                    <span className="nx">{st.role_title || 'Специалист'}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* 2. Services Step Content */}
                        {stepId === 'service' && (
                          <div id="services">
                            {services.map(svc => {
                              const isSelected = selectedServices.some(s => s.id === svc.id);
                              const priceFmt = svc.price_formatted || `${svc.base_price_minor / 100} ₸`;
                              const isExpanded = expandedSvc.includes(svc.id);
                              const hasMore = (svc.description || '').length > 90;
                              return (
                                <div
                                  key={svc.id}
                                  className="svc-card"
                                  data-selected={isSelected ? 'true' : undefined}
                                >
                                  <button
                                    type="button"
                                    className="svc-main tap"
                                    aria-pressed={isSelected}
                                    onClick={() => handleSelectService(svc)}
                                  >
                                    <span className="svc-name">{svc.name}</span>
                                    <span className="svc-check">
                                      {isSelected && (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                                        </svg>
                                      )}
                                    </span>
                                  </button>
                                  {svc.description && (
                                    <div className="svc-desc" data-open={isExpanded ? 'true' : undefined}>
                                      {svc.description}
                                    </div>
                                  )}
                                  {hasMore && (
                                    <button
                                      type="button"
                                      className="svc-more"
                                      aria-expanded={isExpanded}
                                      onClick={() =>
                                        setExpandedSvc(prev =>
                                          prev.includes(svc.id) ? prev.filter(i => i !== svc.id) : [...prev, svc.id]
                                        )
                                      }
                                    >
                                      {isExpanded ? 'Свернуть' : 'Подробнее'}
                                    </button>
                                  )}
                                  <div className="svc-foot">
                                    <span className="svc-dur">
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <circle cx="12" cy="12" r="8.5" />
                                        <path d="M12 7.5V12l3 2" />
                                      </svg>
                                      {svc.base_duration_minutes} мин
                                    </span>
                                    <span className="svc-price">{priceFmt}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* 3. Date Step Content */}
                        {stepId === 'date' && (
                          <div>
                            <div className="row">
                              <div className="sub-t">
                                {MONTHS[parseYMD(selectedDate || todayYmd).getMonth()]}{' '}
                                {parseYMD(selectedDate || todayYmd).getFullYear()}
                              </div>
                              <div className="tools">
                                <button
                                  type="button"
                                  className="round tap"
                                  disabled={datePageOffset <= 0}
                                  onClick={() => setDatePageOffset(p => Math.max(0, p - 4))}
                                  aria-label="Предыдущие дни"
                                >
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M15 6l-6 6 6 6" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="round tap"
                                  disabled={datePageOffset >= 36}
                                  onClick={() => setDatePageOffset(p => p + 4)}
                                  aria-label="Следующие дни"
                                >
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M9 6l6 6-6 6" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="pill tap"
                                  onClick={() => setIsCalOpen(true)}
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
                                    <path d="M3.5 10h17M8 3v4M16 3v4" />
                                  </svg>
                                  Календарь
                                </button>
                              </div>
                            </div>

                            <div id="dates">
                              {dateChips.map(c => {
                                const isSelected = c.ymd === selectedDate;
                                return (
                                  <button
                                    key={c.ymd}
                                    type="button"
                                    className="chip tap"
                                    aria-pressed={isSelected}
                                    onClick={() => handleSelectDate(c.ymd)}
                                  >
                                    <span className="wd">{c.wdText}</span>
                                    <span className="day">{c.dayNum}</span>
                                    <span className="sb">{isSelected ? 'выбрано' : 'есть места'}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 4. Time Step Content */}
                        {stepId === 'time' && (
                          <div>
                            <div className="row">
                              <div className="sub-t">
                                {isLoadingSlots
                                  ? 'Поиск свободных окон...'
                                  : availableSlots.length > 0
                                  ? `${availableSlots.length} свободных окон`
                                  : 'Нет свободного времени на эту дату'}
                              </div>
                              <div className="live">
                                <i aria-hidden="true" /> обновляется онлайн
                              </div>
                            </div>

                            {groupedSlots.map(group => (
                              <div key={group.name} className="grp">
                                <div className="grp-h">
                                  <span>{group.name}</span>
                                  <span />
                                </div>
                                <div className="slots">
                                  {group.slots.map(s => {
                                    const timeStr = formatTime(s.starts_at_utc, selectedBranch?.timezone_iana);
                                    const isSelected = selectedSlot?.quote_id === s.quote_id;
                                    return (
                                      <button
                                        key={s.quote_id}
                                        type="button"
                                        className="slot tap"
                                        aria-pressed={isSelected}
                                        onClick={() => handleSelectSlot(s)}
                                      >
                                        {timeStr}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 5. Contacts Step Content */}
                        {stepId === 'contacts' && (
                          <div>
                            <form
                              className="fields"
                              onSubmit={e => {
                                e.preventDefault();
                                setTouchedContacts(true);
                                if (contactsValid) {
                                  setIsReview(true);
                                }
                              }}
                            >
                              <div className="fld" data-bad={touchedContacts && clientName.trim().length < 2 ? '' : undefined}>
                                <label htmlFor="f-name">Имя</label>
                                <input
                                  id="f-name"
                                  type="text"
                                  autoComplete="name"
                                  placeholder="Как к вам обращаться"
                                  value={clientName}
                                  onChange={e => setClientName(e.target.value)}
                                  required
                                />
                                {touchedContacts && clientName.trim().length < 2 && (
                                  <span className="err">Введите ваше имя (минимум 2 буквы)</span>
                                )}
                              </div>

                              <div className="fld" data-bad={touchedContacts && clientPhone.replace(/\D/g, '').length < 10 ? '' : undefined}>
                                <label htmlFor="f-phone">Телефон</label>
                                <input
                                  id="f-phone"
                                  type="tel"
                                  autoComplete="tel"
                                  placeholder="+7 (___) ___-__-__"
                                  value={clientPhone}
                                  onChange={e => handlePhoneChange(e.target.value)}
                                  required
                                />
                                {touchedContacts && clientPhone.replace(/\D/g, '').length < 10 && (
                                  <span className="err">Введите корректный номер телефона</span>
                                )}
                              </div>

                              <div className="fld wide">
                                <label htmlFor="f-mail">
                                  Почта <i>по желанию</i>
                                </label>
                                <input
                                  id="f-mail"
                                  type="email"
                                  autoComplete="email"
                                  placeholder="name@mail.com"
                                  value={clientEmail}
                                  onChange={e => setClientEmail(e.target.value)}
                                />
                              </div>

                              <div className="fld wide">
                                <label htmlFor="f-notes">
                                  Пожелания к записи <i>по желанию</i>
                                </label>
                                <textarea
                                  id="f-notes"
                                  placeholder="Комментарий для мастера..."
                                  value={clientNote}
                                  onChange={e => setClientNote(e.target.value)}
                                />
                              </div>

                              <button
                                type="submit"
                                className="next tap"
                                onClick={() => {
                                  setTouchedContacts(true);
                                  if (contactsValid) {
                                    setIsReview(true);
                                  }
                                }}
                              >
                                Продолжить
                              </button>
                            </form>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          {/* Sticky Summary Receipt / Ticket */}
          <aside className="sum" id="sum" data-done={isDone ? '' : undefined} data-review={isReview && !isDone ? '' : undefined}>
            {/* Confirmed State Ticket Header */}
            <div className="ok-badge only-done">
              <span className="ok-ic">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <div>
                <div className="ok-t">Вы записаны!</div>
                <div className="ok-s">Ждём вас, {clientName.split(/\s+/)[0] || 'дорогой клиент'}</div>
              </div>
            </div>

            {/* Editing State Header */}
            <div className="top only-edit">
              <span className="label" id="sumLabel">
                {isReview ? 'Проверьте запись' : 'Ваша запись'}
              </span>
              {selectedSlot && (
                <span className="rel">
                  {formatShortDay(selectedDate, todayYmd)}
                </span>
              )}
            </div>

            {/* Day and Big Time */}
            <div className="sday" id="sday">
              {formatDayTitle(selectedDate, todayYmd)}
            </div>
            <div className={`stime${selectedSlot ? '' : ' empty'}`} id="stime">
              {selectedSlot ? formatTime(selectedSlot.starts_at_utc, selectedBranch?.timezone_iana) : '--:--'}
            </div>
            <div className="send" id="send">
              {selectedSlot && totalDuration > 0
                ? `длительность: ~${totalDuration} мин`
                : ''}
            </div>

            {/* Perforated ticket divider for done state */}
            <div className="perf only-done" />

            {/* Facts Table */}
            <div className="facts">
              <div className="fact block">
                <span>Услуга</span>
                <span>
                  {selectedServices.length > 0
                    ? selectedServices.map(s => s.name).join(', ')
                    : <span className="none">—</span>}
                </span>
              </div>
              <div className="fact block">
                <span>Мастер</span>
                <span id="smaster">
                  {selectedStaff === 'any'
                    ? 'Любой свободный'
                    : selectedStaff
                    ? selectedStaff.display_name
                    : <span className="none">—</span>}
                </span>
              </div>
              <div className="fact block">
                <span>Клиент</span>
                <span id="sClient">
                  {clientName.trim() || <span className="none">—</span>}
                </span>
              </div>
              <div className="fact only-done">
                <span>Телефон</span>
                <span id="sPhone">{clientPhone || '—'}</span>
              </div>
              {totalDuration > 0 && (
                <div className="fact">
                  <span>Длительность</span>
                  <span>{totalDuration} мин</span>
                </div>
              )}
              <div className="fact block only-done">
                <span>Адрес</span>
                <span>{selectedBranch?.address || 'Алматы'}</span>
              </div>
            </div>

            {/* Total Price */}
            <div className="total">
              <span>Итого</span>
              <span>{totalPriceFormatted}</span>
            </div>

            {/* Error banner if any */}
            {error && (
              <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '12px', background: '#FEE2E2', color: '#991B1B', fontSize: '13px' }}>
                <b>{error.title}</b>
                <div>{error.message}</div>
              </div>
            )}

            {/* CTA button */}
            <button
              type="button"
              className="cta tap only-edit"
              id="cta"
              disabled={!isReady || isSubmitting}
              onClick={handleSubmitBooking}
            >
              <span>{ctaText}</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>

            {!isReady && contactsValid && !selectedSlot && (
              <p className="cta-hint only-edit">
                Выберите подходящее время для записи
              </p>
            )}

            {/* Done Action buttons */}
            <div className="acts only-done">
              {bookingResult?.management_token && (
                <button
                  type="button"
                  className="lnk"
                  onClick={() => {
                    setManageToken(bookingResult.management_token);
                    window.history.pushState({}, '', `/manage/${bookingResult.management_token}`);
                  }}
                >
                  Управление записью
                </button>
              )}
              <button
                type="button"
                className="lnk"
                onClick={() => {
                  setBookingResult(null);
                  setSelectedSlot(null);
                  setIsReview(false);
                  setMode(null);
                }}
              >
                Записаться ещё раз
              </button>
            </div>

            {/* Trust perks */}
            <div className="perks only-edit">
              <div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                <span>Подтверждение сразу после записи</span>
              </div>
              <div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                <span>Бесплатная отмена и перенос</span>
              </div>
            </div>
          </aside>
        </main>

        {/* Footer */}
        <footer className="foot">
          <div className="btns">
            <button
              type="button"
              className="btn tap"
              onClick={() => setIsCallOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
              </svg>
              Позвонить
            </button>
            {selectedBranch?.address && (
              <a
                className="btn tap"
                href={`https://2gis.kz/almaty/search/${encodeURIComponent(selectedBranch.address)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 11l16-7-7 16-2-7z" />
                </svg>
                Маршрут
              </a>
            )}
          </div>
        </footer>
      </div>

      {/* Call Bottom Sheet */}
      <div className="sheet-backdrop" hidden={!isCallOpen}>
        <button
          type="button"
          className="scrim"
          onClick={() => setIsCallOpen(false)}
          aria-label="Закрыть окно"
        />
        <div className="sheet-panel" role="dialog" aria-label="Телефон">
          <div className="sheet-head">
            <h3 className="sheet-title">Телефон</h3>
            <button
              type="button"
              className="sheet-close"
              onClick={() => setIsCallOpen(false)}
              aria-label="Закрыть"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="sheet-call-list">
            {getBranchPhones(selectedBranch).map((phone) => (
              <a
                key={phone}
                className="sheet-call-row"
                href={`tel:${phone.replace(/[^+\d]/g, '')}`}
              >
                <span className="sheet-call-left">
                  <span className="sheet-call-ic">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z" />
                    </svg>
                  </span>
                  <span className="sheet-call-num">{phone}</span>
                </span>
                <svg className="sheet-call-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar Modal */}
      {!isDone && (
        <div className="modal" hidden={!isCalOpen}>
          <button
            type="button"
            className="scrim"
            onClick={() => setIsCalOpen(false)}
            aria-label="Закрыть календарь"
          />
          <div className="dlg" role="dialog" aria-label="Календарь">
            <div className="dlg-h">
              <div className="t">{calDays.monthTitle}</div>
              <button
                type="button"
                className="round tap"
                disabled={calMonthOffset <= 0}
                onClick={() => setCalMonthOffset(o => Math.max(0, o - 1))}
                aria-label="Предыдущий месяц"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <button
                type="button"
                className="round tap"
                disabled={calMonthOffset >= 2}
                onClick={() => setCalMonthOffset(o => o + 1)}
                aria-label="Следующий месяц"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              <button
                type="button"
                className="round tap"
                onClick={() => setIsCalOpen(false)}
                aria-label="Закрыть"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="wdh" aria-hidden="true">
              <span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span>
            </div>
            <div className="cal">
              {calDays.items.map(item => {
                if (item.empty) {
                  return <div key={item.key} />;
                }
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`cc${item.isToday ? ' today' : ''}`}
                    disabled={item.isPast}
                    aria-pressed={item.isSelected}
                    onClick={() => {
                      if (item.ymd) {
                        handleSelectDate(item.ymd);
                        setIsCalOpen(false);
                      }
                    }}
                  >
                    <span style={{ display: 'block', lineHeight: 1 }}>{item.dayNum}</span>
                    {!item.isPast && !item.isSelected && <span className="dot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
