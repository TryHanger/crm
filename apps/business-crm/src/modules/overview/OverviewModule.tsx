/* «Обзор» — главная по макету (bento): расписание на сегодня, следующая запись, загрузка,
   ближайшие записи, записи за неделю, свободные окна. Только реальные данные API:
   календарь филиала (смены, занятость, свободные интервалы), сводка за сегодня и отчёт за 30 дней. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BusinessCrmApiClient } from '@crm/api-client';
import { CrmMembership, CrmNavigationSection } from '../../types';
import { Icon } from '../../ui/Icon';
import { initials } from '../../layouts/CrmLayout';
import { STATUS_LABEL, staffColor } from '../../ui/format';

interface Props {
  api: BusinessCrmApiClient;
  token: string;
  membership: CrmMembership;
  branchId: string | null;
  branchName?: string;
  userName?: string;
  onNavigate: (s: CrmNavigationSection) => void;
  onOpenCustomer?: (id: string) => void;
}

type Iv = { starts_at_utc: string; ends_at_utc: string };
type Staff = { id: string; display_name: string; role_title?: string; working?: Iv[]; busy?: Iv[]; free?: Iv[] };
type Booking = {
  id: string;
  staff_id: string;
  customer_id?: string;
  customer_name?: string;
  status: string;
  starts_at_utc: string;
  service_ends_at_utc: string;
  amount_minor?: number;
  services?: any[];
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** часы (дробные) в часовом поясе филиала */
const localHour = (iso: string, tz: string) => {
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  return (Number(parts.hour) % 24) + Number(parts.minute) / 60;
};
const hm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const svcNames = (b: Booking) =>
  (b.services || []).map(s => (typeof s === 'string' ? s : s.service_name || s.name || s.service_name_snapshot)).filter(Boolean).join(' + ');

export const OverviewModule: React.FC<Props> = ({ api, token, membership, branchId, branchName, userName, onNavigate, onOpenCustomer }) => {
  const [tz, setTz] = useState('Asia/Almaty');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [week, setWeek] = useState<{ day: string; label: string; count: number; today: boolean }[]>([]);
  const [plan, setPlan] = useState<number | null>(null);
  const [newClients, setNewClients] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const tid = membership.tenant_id;
  const today = isoDay(new Date());

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const days = [...Array(7)].map((_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d;
      });
      const [cal, weekCals, dash, rep] = await Promise.all([
        api.getCalendar({ date: today, branch_id: branchId }, token, tid),
        Promise.all(days.map(d => api.getCalendar({ date: isoDay(d), branch_id: branchId }, token, tid).catch(() => null))),
        api.getDashboard(branchId, token, tid).catch(() => null),
        api.getReportsOverview({ branch_id: branchId }, token, tid).catch(() => null),
      ]);
      setTz(cal.timezone || 'Asia/Almaty');
      setStaff(cal.staff || []);
      setBookings(cal.bookings || []);
      setWeek(
        days.map((d, i) => ({
          day: isoDay(d),
          label: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][i],
          count: (weekCals[i]?.bookings || []).filter((b: Booking) => b.status !== 'cancelled').length,
          today: isoDay(d) === today,
        })),
      );
      setPlan(dash?.today_stats?.planned_revenue_minor ?? null);
      setNewClients((rep as any)?.new_customers_count ?? null);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить обзор');
    } finally {
      setLoading(false);
    }
  }, [api, token, tid, branchId, today]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const NOW = localHour(new Date(nowTick).toISOString(), tz);
  const active = bookings.filter(b => b.status !== 'cancelled');
  const upcoming = useMemo(
    () =>
      bookings
        .filter(b => !['cancelled', 'completed', 'no_show'].includes(b.status) && localHour(b.service_ends_at_utc, tz) > NOW)
        .sort((a, b) => a.starts_at_utc.localeCompare(b.starts_at_utc)),
    [bookings, tz, NOW],
  );
  const next = upcoming.find(b => b.status === 'confirmed') || upcoming[0];
  const staffIdx = (id: string) => Math.max(0, staff.findIndex(s => s.id === id));
  const staffName = (id: string) => staff.find(s => s.id === id)?.display_name || '';

  // окно ленты: от ранней смены до поздней (по умолчанию 9–21)
  const working = staff.flatMap(s => s.working || []);
  const H0 = Math.min(9, ...working.map(w => Math.floor(localHour(w.starts_at_utc, tz))));
  const H1 = Math.max(21, ...working.map(w => Math.ceil(localHour(w.ends_at_utc, tz)) || 21));
  const span = Math.max(1, H1 - H0);
  const pc = (h: number) => (((h - H0) / span) * 100).toFixed(2);

  const minutes = (ivs?: Iv[]) =>
    (ivs || []).reduce((a, iv) => a + (new Date(iv.ends_at_utc).getTime() - new Date(iv.starts_at_utc).getTime()) / 60000, 0);
  const workMin = staff.reduce((a, s) => a + minutes(s.working), 0);
  const busyMin = staff.reduce((a, s) => a + minutes(s.busy), 0);
  const load_ = workMin ? Math.round((busyMin / workMin) * 100) : 0;

  const freeSlots = staff
    .flatMap(s =>
      (s.free || [])
        .map(iv => ({ start: Math.ceil(Math.max(localHour(iv.starts_at_utc, tz), NOW) * 4) / 4, end: localHour(iv.ends_at_utc, tz), who: s.display_name }))
        .filter(x => x.end - x.start >= 0.5),
    )
    .sort((a, b) => a.start - b.start)
    .slice(0, 8);

  const weekMax = Math.max(1, ...week.map(w => w.count));
  const firstName = (userName || '').split(' ')[0];
  const dateLabel = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date());

  if (!branchId) {
    return (
      <div className="card pad empty" data-testid="overview-no-branch">
        Создайте первый филиал, чтобы увидеть расписание.{' '}
        <button className="btn sm p" onClick={() => onNavigate('onboarding')}>
          К онбордингу
        </button>
      </div>
    );
  }

  return (
    <div data-testid="overview-page">
      <div className="ph">
        <div>
          <h1>Добрый день{firstName ? `, ${firstName}` : ''}!</h1>
          <div className="sub">
            {dateLabel[0].toUpperCase() + dateLabel.slice(1)}
            {branchName ? ` · ${branchName}` : ''}
          </div>
        </div>
        <div className="acts">
          <div className="tops hide-m">
            <div>
              <b>{active.length}</b>
              <span>
                записей
                <br />
                сегодня
              </span>
            </div>
            {plan !== null && (
              <div>
                <b>{plan >= 100000 ? `${Math.round(plan / 100000)}k` : Math.round(plan / 100)}</b>
                <span>
                  ₸ плановая
                  <br />
                  выручка
                </span>
              </div>
            )}
          </div>
          <button className="btn p" onClick={() => onNavigate('calendar')}>
            <Icon name="plus" size={16} />
            Запись
          </button>
        </div>
      </div>

      {error && (
        <div className="note" style={{ color: 'var(--neg)' }}>
          {error}{' '}
          <button className="btn sm" onClick={load}>
            Повторить
          </button>
        </div>
      )}

      <div className="bento" style={{ opacity: loading ? 0.6 : 1 }}>
        <div className="card pad b8">
          <div className="row between">
            <h3>Расписание на сегодня</h3>
            <button className="rnd" title="Открыть календарь" onClick={() => onNavigate('calendar')}>
              <Icon name="right" size={16} />
            </button>
          </div>
          <div className="gtw">
            <div className="gt">
              <div className="hrs" style={{ gridTemplateColumns: `repeat(${Math.ceil(span / 2)},${(200 / span).toFixed(3)}%)` }}>
                {[...Array(Math.ceil(span / 2))].map((_, i) => (
                  <span key={i}>{H0 + i * 2}:00</span>
                ))}
              </div>
              {staff.length === 0 && <div className="empty">Нет мастеров в этом филиале</div>}
              {staff.map((s, si) => (
                <div className="r" key={s.id}>
                  <div className="who">
                    <span className="av" style={{ background: staffColor(si), width: 26, height: 26, fontSize: 10 }}>
                      {initials(s.display_name)}
                    </span>
                    <span className="ellip">{s.display_name.split(' ')[0]}</span>
                  </div>
                  <div className={`trk ${(s.working || []).length ? '' : 'offd'}`}>
                    {bookings
                      .filter(b => b.staff_id === s.id)
                      .map(b => {
                        const st = localHour(b.starts_at_utc, tz);
                        const en = localHour(b.service_ends_at_utc, tz);
                        return (
                          <button
                            key={b.id}
                            className={`pl ${b.status}`}
                            title={`${hm(st)} ${b.customer_name || ''} · ${svcNames(b)}`}
                            style={{ left: `${pc(st)}%`, width: `calc(${(((en - st) / span) * 100).toFixed(2)}% - 3px)` }}
                            onClick={() => onNavigate('calendar')}
                          >
                            {b.customer_name || 'Клиент'}
                          </button>
                        );
                      })}
                    {NOW >= H0 && NOW <= H1 && <span className="nowl" style={{ left: `${pc(NOW)}%` }} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="legend" style={{ marginTop: 6 }}>
            {['in_progress', 'arrived', 'confirmed', 'completed'].map(s => (
              <span key={s}>
                <i style={{ background: `var(--s-${s})`, borderRadius: '50%' }} />
                {STATUS_LABEL[s]}
              </span>
            ))}
          </div>
        </div>

        <div className="b4 rcol">
          <div className="card pad acc wide" data-testid="overview-next-booking">
            {next ? (
              <>
                <div className="row between">
                  <span className="o6">Следующая запись</span>
                  <button className="rnd" onClick={() => onNavigate('calendar')}>
                    <Icon name="right" size={16} />
                  </button>
                </div>
                <div className="bign" style={{ margin: '14px 0 6px' }}>
                  {hm(localHour(next.starts_at_utc, tz))}
                </div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{next.customer_name || 'Клиент'}</div>
                <div className="o6 sm">
                  {[svcNames(next), staffName(next.staff_id)].filter(Boolean).join(' · ')}
                </div>
                <div className="row" style={{ marginTop: 16, gap: 8 }}>
                  <button className="btn sm" onClick={() => onNavigate('calendar')}>
                    Открыть
                  </button>
                  {next.customer_id && onOpenCustomer && (
                    <button
                      className="btn sm"
                      style={{ background: 'rgba(255,255,255,.16)', color: 'inherit' }}
                      onClick={() => onOpenCustomer(next.customer_id!)}
                    >
                      Клиент
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="o6">Ближайших записей на сегодня нет</div>
            )}
          </div>
          <div className="card pad">
            <div className="row between">
              <span className="mut sm">Загрузка сегодня</span>
              <button className="rnd" style={{ width: 28, height: 28 }} onClick={() => onNavigate('staff')}>
                <Icon name="right" size={14} />
              </button>
            </div>
            <div className="bign" style={{ fontSize: 32, marginTop: 10 }}>
              {load_}%
            </div>
            <div className="sgb">
              {[...Array(20)].map((_, i) => (
                <i key={i} className={i < Math.round(load_ / 5) ? 'on' : ''} />
              ))}
            </div>
          </div>
          <div className="card pad blk">
            <div className="row between">
              <span className="o6 sm">Клиенты</span>
              <button className="rnd" style={{ width: 28, height: 28 }} onClick={() => onNavigate('customers')}>
                <Icon name="right" size={14} />
              </button>
            </div>
            <div className="bign" style={{ fontSize: 32, marginTop: 10 }}>
              {newClients ?? '—'}
            </div>
            <span className="pill-hl" style={{ display: 'inline-block', marginTop: 12, background: 'var(--brand)', color: 'var(--brand-fg)' }}>
              новых за 30 дней
            </span>
          </div>
        </div>

        <div className="card b5">
          <div className="row between" style={{ padding: '18px 18px 8px' }}>
            <h3>Ближайшие записи</h3>
            <button className="btn sm" onClick={() => onNavigate('calendar')}>
              Все
            </button>
          </div>
          <div className="list">
            {upcoming.slice(0, 4).map(b => {
              const st = localHour(b.starts_at_utc, tz);
              return (
                <div className="it" key={b.id} onClick={() => onNavigate('calendar')}>
                  <div style={{ width: 52 }}>
                    <b>{hm(st)}</b>
                    <div className="mut sm">{hm(localHour(b.service_ends_at_utc, tz))}</div>
                  </div>
                  <div className="av" style={{ background: staffColor(staffIdx(b.staff_id)) }}>
                    {initials(b.customer_name)}
                  </div>
                  <div className="grow">
                    <div className="t ellip">{b.customer_name || 'Клиент'}</div>
                    <div className="mut sm ellip">{[svcNames(b), staffName(b.staff_id)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="badge" style={{ color: `var(--s-${b.status})` }}>
                    {STATUS_LABEL[b.status] || b.status}
                  </span>
                </div>
              );
            })}
            {upcoming.length === 0 && <div className="empty">На сегодня записей больше нет</div>}
          </div>
        </div>

        <div className="card pad b4">
          <div className="row between">
            <h3>Записи за неделю</h3>
          </div>
          <div className="wk">
            {week.map(w => (
              <div className={`c ${w.today ? 'on' : ''}`} key={w.day}>
                {w.today && <em>{w.count}</em>}
                <i style={{ height: `${Math.max(4, (w.count / weekMax) * 72)}%` }} title={`${w.count} записей`} />
                <span>{w.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card pad b3">
          <div className="row between">
            <h3>Свободные окна</h3>
            <span className="pill-hl" style={{ background: 'var(--chip)', color: 'var(--fg)' }}>
              {freeSlots.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '14px 0' }}>
            {freeSlots.map((f, i) => (
              <span className="chip" key={i}>
                {hm(f.start)} {f.who.split(' ')[0]}
              </span>
            ))}
            {freeSlots.length === 0 && <span className="mut sm">Сегодня свободных окон больше нет</span>}
          </div>
          <button className="btn p sm" onClick={() => onNavigate('calendar')}>
            <Icon name="plus" size={14} />
            Записать клиента
          </button>
        </div>
      </div>
    </div>
  );
};
