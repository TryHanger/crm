import React, { useState, useEffect, useCallback } from 'react';
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
import { BookingFlow, BookingStep } from './types';
import { Header } from './components/Header';
import { Stepper } from './components/Stepper';
import { ServicesStep } from './components/ServicesStep';
import { StaffStep } from './components/StaffStep';
import { DateTimeStep } from './components/DateTimeStep';
import { ConfirmationStep } from './components/ConfirmationStep';
import { SummaryCard } from './components/SummaryCard';
import { ConfirmationScreen } from './components/ConfirmationScreen';
import { ManageBookingScreen } from './components/ManageBookingScreen';

function getLocalDateString(timeZone: string = 'Asia/Almaty'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

export const App: React.FC = () => {
  const [api] = useState(() => new PublicApiClient());

  // Global Tenant & Flow state
  const [site, setSite] = useState<PublicSiteResponse | null>(null);
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<BranchResponse | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [services, setServices] = useState<ServiceItemResponse[]>([]);
  const [staffList, setStaffList] = useState<StaffPublicResponse[]>([]);

  // Deep-link initial token extraction
  const [manageToken, setManageToken] = useState<string | null>(() => {
    const pathname = window.location.pathname;
    const match = pathname.match(/^\/manage\/([^/]+)/);
    if (match) return match[1];
    const params = new URLSearchParams(window.location.search);
    return params.get('manage') || null;
  });

  // Booking selections & active flow
  const [flow, setFlow] = useState<BookingFlow>(() => {
    const params = new URLSearchParams(window.location.search);
    const flowParam = params.get('flow');
    if (flowParam === 'master-first' || flowParam === 'time-first') return flowParam;
    if (params.get('master')) return 'master-first';
    return 'service-first';
  });

  const [step, setStep] = useState<BookingStep>(() => {
    if (manageToken) return 'manage';
    const params = new URLSearchParams(window.location.search);
    const flowParam = params.get('flow');
    if (flowParam === 'time-first') return 'datetime';
    if (params.get('master') || flowParam === 'master-first') return 'staff';
    return 'services';
  });

  const [selectedServices, setSelectedServices] = useState<ServiceItemResponse[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffPublicResponse | 'any' | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateString());
  const [preferredTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<SlotResponse[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotResponse | null>(null);

  // Intent-bound Idempotency key
  const [bookingIntentKey, setBookingIntentKey] = useState<string | null>(null);

  // Customer Form
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('+7 ');
  const [clientEmail, setClientEmail] = useState('');
  const [clientNote, setClientNote] = useState('');

  // Result & Manage
  const [bookingResult, setBookingResult] = useState<BookingCreatedResponse | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; code?: string } | null>(null);
  const [tenantSuspended, setTenantSuspended] = useState(false);
  const [domainNotFound, setDomainNotFound] = useState(false);

  // 1. Initial tenant data load
  useEffect(() => {
    const initTenant = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load site info
        const siteData = await api.getSite();
        setSite(siteData);

        if (!siteData.is_published) {
          setTenantSuspended(true);
          return;
        }

        // Load branches
        const branchList = await api.getBranches();
        setBranches(branchList);
        const defaultBranch = branchList[0] || null;
        setSelectedBranch(defaultBranch);

        if (defaultBranch) {
          setSelectedDate(getLocalDateString(defaultBranch.timezone_iana));

          // Load services
          const svcList = await api.getServices(defaultBranch.id);
          setServices(svcList || []);

          // Extract unique categories
          const catsMap = new Map();
          svcList.forEach(s => {
            if (s.category_id && s.category_name) {
              catsMap.set(s.category_id, { id: s.category_id, name: s.category_name });
            }
          });
          setCategories(Array.from(catsMap.values()));

          // Load staff
          const stfRes = await api.getStaff(defaultBranch.id);
          setStaffList(stfRes || []);

          // Handle master deep-link (?master=UUID)
          const params = new URLSearchParams(window.location.search);
          const masterId = params.get('master');
          if (masterId && stfRes) {
            const foundMaster = stfRes.find(s => s.id === masterId);
            if (foundMaster) {
              setSelectedStaff(foundMaster);
              setFlow('master-first');
              setStep('services');
              // Fetch services specific to this master
              try {
                const mSvcs = await api.getStaffServices(foundMaster.id, defaultBranch.id);
                if (mSvcs && mSvcs.length > 0) setServices(mSvcs);
              } catch {}
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
            title: 'Не удалось загрузить данные компании',
            message: err.message || 'Проверьте соединение с сервером',
          });
        }
      } finally {
        setIsLoading(false);
      }
    };

    initTenant();
  }, [api]);

  // 2. Fetch availability slots when on datetime step
  useEffect(() => {
    let isCancelled = false;

    if (!selectedBranch || step !== 'datetime') {
      return;
    }

    if (selectedServices.length === 0) {
      if (flow === 'time-first') {
        const previewTimes = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];
        const previewSlots: SlotResponse[] = previewTimes.map(t => {
          const [h, m] = t.split(':');
          const d = new Date(`${selectedDate}T00:00:00Z`);
          d.setUTCHours(parseInt(h, 10) - 5, parseInt(m, 10), 0, 0);
          const ends = new Date(d.getTime() + 60 * 60 * 1000);
          return {
            quote_id: `pref_${t}`,
            starts_at_utc: d.toISOString(),
            ends_at_utc: ends.toISOString(),
            service_ends_at_utc: ends.toISOString(),
            duration_minutes: 60,
            price_minor: 0,
            price_formatted: 'Выбор услуг на след. шаге',
            currency: 'KZT',
            quote_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            staff_id: '',
            staff_name: 'Любой мастер',
            staff_role: 'Мастер',
          };
        });
        setAvailableSlots(previewSlots);
      }
      return;
    }

    const fetchSlots = async () => {
      try {
        setIsLoadingSlots(true);
        setError(null);

        const staffId =
          typeof selectedStaff === 'object' && selectedStaff !== null ? selectedStaff.id : undefined;

        const res = await api.searchAvailability({
          branch_id: selectedBranch.id,
          service_ids: selectedServices.map(s => s.id),
          from_date: selectedDate,
          to_date: selectedDate,
          staff_id: staffId,
          staff_mode: selectedStaff === 'any' ? 'any' : undefined,
        });

        if (isCancelled) return;

        const returnedSlots = res.slots || [];
        setAvailableSlots(returnedSlots);

        // If user had selected a preferred preview slot, auto-select matching or first real slot
        if (selectedSlot?.quote_id?.startsWith('pref_') && returnedSlots.length > 0) {
          const targetTime = selectedSlot.starts_at_utc;
          const match = returnedSlots.find(s => s.starts_at_utc === targetTime) || returnedSlots[0];
          setSelectedSlot(match);
        } else if (selectedSlot && !returnedSlots.some(s => s.quote_id === selectedSlot.quote_id)) {
          setSelectedSlot(null);
        }
      } catch (err: any) {
        if (isCancelled) return;
        console.error('Failed to load slots', err);
        setAvailableSlots([]);
      } finally {
        if (!isCancelled) {
          setIsLoadingSlots(false);
        }
      }
    };

    fetchSlots();

    return () => {
      isCancelled = true;
    };
  }, [selectedBranch, selectedServices, selectedStaff, selectedDate, step, flow, api]);

  // Handle flow switching from tabs
  const handleChangeFlow = (newFlow: BookingFlow) => {
    setFlow(newFlow);
    setSelectedSlot(null);
    setBookingIntentKey(null);
    if (newFlow === 'master-first') {
      setStep('staff');
    } else if (newFlow === 'time-first') {
      setStep('datetime');
    } else {
      setStep('services');
    }
  };

  // Handle branch change with dependent state reload
  const handleSelectBranch = async (newBranch: BranchResponse) => {
    if (selectedBranch?.id === newBranch.id) return;
    setSelectedBranch(newBranch);
    setSelectedServices([]);
    setSelectedStaff(null);
    setSelectedSlot(null);
    setBookingIntentKey(null);
    setSelectedDate(getLocalDateString(newBranch.timezone_iana));

    if (flow === 'master-first') setStep('staff');
    else if (flow === 'time-first') setStep('datetime');
    else setStep('services');

    try {
      setIsLoading(true);
      const svcList = await api.getServices(newBranch.id);
      setServices(svcList || []);
      const catsMap = new Map();
      svcList.forEach(s => {
        if (s.category_id && s.category_name) {
          catsMap.set(s.category_id, { id: s.category_id, name: s.category_name });
        }
      });
      setCategories(Array.from(catsMap.values()));
      const stfRes = await api.getStaff(newBranch.id);
      setStaffList(stfRes || []);
    } catch (err: any) {
      console.error('Failed to reload branch data', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Handlers
  const handleToggleService = (svc: ServiceItemResponse) => {
    setSelectedServices(prev => {
      const exists = prev.some(s => s.id === svc.id);
      return exists ? prev.filter(s => s.id !== svc.id) : [...prev, svc];
    });
    setSelectedSlot(null);
    setBookingIntentKey(null);
  };

  const handleSelectStaff = async (st: StaffPublicResponse | 'any') => {
    setSelectedStaff(st);
    setSelectedSlot(null);
    setBookingIntentKey(null);

    // In master-first flow, fetch services with master's price and duration overrides
    if (flow === 'master-first' && typeof st === 'object' && st !== null && selectedBranch) {
      try {
        setIsLoading(true);
        const masterSvcs = await api.getStaffServices(st.id, selectedBranch.id);
        if (masterSvcs && masterSvcs.length > 0) {
          setServices(masterSvcs);
          const catsMap = new Map();
          masterSvcs.forEach(s => {
            if (s.category_id && s.category_name) {
              catsMap.set(s.category_id, { id: s.category_id, name: s.category_name });
            }
          });
          setCategories(Array.from(catsMap.values()));
        }
      } catch (err) {
        console.error('Failed to load master services', err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleSelectSlot = (slot: SlotResponse) => {
    setSelectedSlot(slot);
    setBookingIntentKey(null);
  };

  const handleNextStep = () => {
    if (step === 'services') {
      if (flow === 'service-first') {
        setStep(selectedStaff ? 'datetime' : 'staff');
      } else if (flow === 'master-first') {
        setStep('datetime');
      } else if (flow === 'time-first') {
        setStep('staff');
      }
    } else if (step === 'staff') {
      if (flow === 'master-first') {
        setStep('services');
      } else if (flow === 'service-first') {
        setStep('datetime');
      } else if (flow === 'time-first') {
        setStep('datetime'); // return to datetime with real services & staff to confirm actual slot!
      }
    } else if (step === 'datetime') {
      if (flow === 'time-first' && selectedServices.length === 0) {
        setStep('services');
      } else {
        setStep('confirm');
        if (!bookingIntentKey) {
          setBookingIntentKey(`bk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
        }
      }
    }
  };

  const handleBack = () => {
    if (step === 'confirm') {
      setStep('datetime');
    } else if (step === 'datetime') {
      if (flow === 'time-first' && selectedServices.length > 0) {
        setStep('staff');
      } else if (flow === 'master-first') {
        setStep('services');
      } else if (flow === 'service-first') {
        setStep('staff');
      }
    } else if (step === 'staff') {
      if (flow === 'master-first') {
        setStep('staff');
      } else if (flow === 'time-first') {
        setStep('services');
      } else {
        setStep('services');
      }
    } else if (step === 'services') {
      if (flow === 'master-first') {
        setStep('staff');
      } else if (flow === 'time-first') {
        setStep('datetime');
      }
    }
  };

  // Submit booking creation
  const handleSubmitBooking = async () => {
    if (!selectedBranch || !selectedSlot) return;

    try {
      setIsSubmitting(true);
      setError(null);

      // Reuse stable idempotency key per intent to prevent duplicates on network retry
      const idempotencyKey =
        bookingIntentKey || `bk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      if (!bookingIntentKey) setBookingIntentKey(idempotencyKey);

      const staffId =
        typeof selectedStaff === 'object' && selectedStaff !== null
          ? selectedStaff.id
          : selectedSlot.staff_id;

      const res = await api.createBooking(
        {
          branch_id: selectedBranch.id,
          staff_id: staffId,
          service_ids: selectedServices.map(s => s.id),
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
      setStep('result');
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        if (err.code === 'QUOTE_CHANGED') {
          setError({
            title: 'Условия бронирования изменились',
            message: 'Стоимость или длительность слота обновилась. Пожалуйста, проверьте и повторите.',
          });
        } else if (err.code === 'QUOTE_MISMATCH') {
          setError({
            title: 'Несовпадение параметров слота',
            message: 'Выбранный слот относится к другому времени или специалисту. Пожалуйста, выберите слот снова.',
          });
        } else {
          setError({
            title: 'Выбранный слот уже занят',
            message: 'К сожалению, это время только что забронировал другой клиент. Выберите другое свободное время.',
          });
        }
      } else {
        setError({
          title: 'Не удалось оформить запись',
          message: err.message || 'Произошла непредвиденная ошибка, попробуйте снова.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. Render Special States (Loading, 404, 403 Suspended)
  if (isLoading && !site) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{ background: '#FFFFFF', borderBottom: '1px solid #E2E8F0', padding: '16px 24px' }}>
          <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="sk" style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#E2E8F0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '200px' }}>
              <div className="sk" style={{ height: '18px', borderRadius: '6px', background: '#E2E8F0', width: '80%' }} />
              <div className="sk" style={{ height: '14px', borderRadius: '4px', background: '#E2E8F0', width: '50%' }} />
            </div>
          </div>
        </header>
        <main style={{ maxWidth: '1040px', margin: '40px auto', padding: '0 24px', width: '100%' }}>
          <div className="sk" style={{ height: '36px', width: '320px', borderRadius: '8px', background: '#E2E8F0', marginBottom: '24px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="sk" style={{ height: '96px', borderRadius: '16px', background: '#E2E8F0' }} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (domainNotFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '480px', textAlign: 'center', background: '#FFFFFF', padding: '36px', borderRadius: '20px', border: '1px solid #E2E8F0' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 10px' }}>Компания не найдена</h1>
          <p style={{ color: '#64748B', margin: 0 }}>
            Проверьте адрес сайта. Домен не привязан ни к одной компании на платформе.
          </p>
        </div>
      </div>
    );
  }

  if (tenantSuspended) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '520px', textAlign: 'center', background: '#FFFFFF', padding: '36px', borderRadius: '20px', border: '1px solid #FCA5A5' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#FEF2F2', color: '#B91C1C', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 10px', color: '#0F172A' }}>
            Онлайн-запись временно недоступна
          </h1>
          <p style={{ color: '#64748B', margin: 0, fontSize: '15px', lineHeight: 1.5 }}>
            Подписка компании приостановлена. Для записи, пожалуйста, свяжитесь с филиалом напрямую по телефону.
          </p>
        </div>
      </div>
    );
  }

  // 4. Render Manage Booking Mode
  if (manageToken) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
        <Header
          site={site}
          branch={selectedBranch}
          branches={branches}
          onSelectBranch={handleSelectBranch}
          flow={flow}
          step="manage"
        />
        <ManageBookingScreen
          token={manageToken}
          api={api}
          onBackToBooking={() => {
            setManageToken(null);
            setStep('services');
            window.history.pushState({}, '', '/');
          }}
        />
      </div>
    );
  }

  // 5. Render Booking Confirmation Screen
  if (step === 'result' && bookingResult) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
        <Header
          site={site}
          branch={selectedBranch}
          branches={branches}
          onSelectBranch={handleSelectBranch}
          flow={flow}
          step="result"
        />
        <ConfirmationScreen
          booking={bookingResult}
          branch={selectedBranch}
          services={selectedServices}
          staff={selectedStaff}
          clientName={clientName}
          clientPhone={clientPhone}
          onManageClick={(t) => {
            setManageToken(t);
            window.history.pushState({}, '', `/manage/${t}`);
          }}
          cancellationCutoffMinutes={site?.cancellation_cutoff_minutes || 120}
        />
      </div>
    );
  }

  // 6. Main Wizard Flow
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', flexDirection: 'column' }}>
      <Header
        site={site}
        branch={selectedBranch}
        branches={branches}
        onSelectBranch={handleSelectBranch}
        flow={flow}
        onChangeFlow={handleChangeFlow}
        step={step}
      />

      <main
        style={{
          width: '100%',
          maxWidth: '1040px',
          margin: '0 auto',
          padding: '24px 24px 56px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {/* Stepper Bar */}
        <Stepper
          flow={flow}
          currentStep={step}
          onStepClick={s => setStep(s)}
        />

        {/* Two Column Layout: Main Content + Sticky Summary */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', alignItems: 'flex-start' }}>
          {/* Left Column */}
          <section style={{ flex: '999 1 540px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {((flow === 'service-first' && step !== 'services') ||
              (flow === 'master-first' && step !== 'staff') ||
              (flow === 'time-first' && step !== 'datetime')) && (
              <button
                type="button"
                onClick={handleBack}
                style={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  minHeight: '44px',
                  marginTop: '-8px',
                  color: '#475569',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '15px',
                  fontWeight: 500,
                  padding: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Назад
              </button>
            )}

            {/* Step: Services */}
            {step === 'services' && (
              <ServicesStep
                categories={categories}
                services={services}
                selectedServices={selectedServices}
                onToggleService={handleToggleService}
                selectedStaff={selectedStaff}
                onClearStaff={() => setSelectedStaff(null)}
                onSwitchToMasterFirst={() => handleChangeFlow('master-first')}
                preferredTime={preferredTime}
                selectedDate={selectedDate}
              />
            )}

            {/* Step: Staff */}
            {step === 'staff' && (
              <StaffStep
                staffList={staffList}
                selectedStaff={selectedStaff}
                onSelectStaff={handleSelectStaff}
                selectedServices={selectedServices}
              />
            )}

            {/* Step: Date & Time */}
            {step === 'datetime' && (
              <DateTimeStep
                selectedDate={selectedDate}
                onSelectDate={d => setSelectedDate(d)}
                availableSlots={availableSlots}
                selectedSlot={selectedSlot}
                onSelectSlot={handleSelectSlot}
                isLoadingSlots={isLoadingSlots}
              />
            )}

            {/* Step: Confirmation Form */}
            {step === 'confirm' && (
              <ConfirmationStep
                branch={selectedBranch}
                selectedServices={selectedServices}
                selectedStaff={selectedStaff}
                selectedSlot={selectedSlot}
                clientName={clientName}
                clientPhone={clientPhone}
                clientEmail={clientEmail}
                clientNote={clientNote}
                onChangeName={setClientName}
                onChangePhone={setClientPhone}
                onChangeEmail={setClientEmail}
                onChangeNote={setClientNote}
                onSubmit={handleSubmitBooking}
                isSubmitting={isSubmitting}
                error={error}
              />
            )}
          </section>

          {/* Right Column: Sticky Summary Card */}
          <SummaryCard
            branch={selectedBranch}
            selectedServices={selectedServices}
            selectedStaff={selectedStaff}
            selectedSlot={selectedSlot}
            currentStep={step}
            onNext={handleNextStep}
          />
        </div>
      </main>
    </div>
  );
};
