import React from 'react';
import { SlotResponse } from '@crm/api-client';

interface DateTimeStepProps {
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (date: string) => void;
  availableSlots: SlotResponse[];
  selectedSlot: SlotResponse | null;
  onSelectSlot: (slot: SlotResponse) => void;
  isLoadingSlots: boolean;
  accentColor?: string;
}

export const DateTimeStep: React.FC<DateTimeStepProps> = ({
  selectedDate,
  onSelectDate,
  availableSlots,
  selectedSlot,
  onSelectSlot,
  isLoadingSlots,
  accentColor = 'var(--accent, #242424)',
}) => {
  // Generate next 14 days starting from today
  const formatLocalDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return [year, month, day].join('-');
  };

  const days: { dateStr: string; dayName: string; dayNum: number; monthName: string }[] = [];
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = formatLocalDate(d);
    const dayName = i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : d.toLocaleDateString('ru-RU', { weekday: 'short' });
    const dayNum = d.getDate();
    const monthName = d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
    days.push({ dateStr, dayName, dayNum, monthName });
  }

  // Format slot time in local display (HH:MM)
  const formatSlotTime = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
  };

  interface GroupedTimeSlot {
    timeKey: string;
    startsAtUtc: string;
    minPriceMinor: number;
    maxPriceMinor: number;
    bestSlot: SlotResponse;
    allSlots: SlotResponse[];
  }

  // Deduplicate slots by local time (HH:MM)
  const timeMap = new Map<string, SlotResponse[]>();
  availableSlots.forEach(s => {
    const timeKey = formatSlotTime(s.starts_at_utc);
    if (!timeMap.has(timeKey)) {
      timeMap.set(timeKey, []);
    }
    timeMap.get(timeKey)!.push(s);
  });

  const groupedAll: GroupedTimeSlot[] = [];
  timeMap.forEach((list, timeKey) => {
    list.sort((a, b) => a.price_minor - b.price_minor);
    groupedAll.push({
      timeKey,
      startsAtUtc: list[0].starts_at_utc,
      minPriceMinor: list[0].price_minor,
      maxPriceMinor: list[list.length - 1].price_minor,
      bestSlot: list[0],
      allSlots: list,
    });
  });

  groupedAll.sort((a, b) => new Date(a.startsAtUtc).getTime() - new Date(b.startsAtUtc).getTime());

  const morningSlots = groupedAll.filter(g => {
    const hour = parseInt(g.timeKey.split(':')[0], 10);
    return hour < 12;
  });
  const afternoonSlots = groupedAll.filter(g => {
    const hour = parseInt(g.timeKey.split(':')[0], 10);
    return hour >= 12 && hour < 17;
  });
  const eveningSlots = groupedAll.filter(g => {
    const hour = parseInt(g.timeKey.split(':')[0], 10);
    return hour >= 17;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '30px', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink, #202124)' }}>
          Выберите дату и время
        </h1>
        <p style={{ margin: 0, color: 'var(--muted, #646464)', fontSize: '15px' }}>
          Доступные интервалы рассчитаны на основе длительности выбранных услуг
        </p>
      </div>

      {/* Date Carousel / Horizontal List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--muted, #646464)' }}>Дата визита</div>
        <div
          style={{
            display: 'flex',
            gap: '10px',
            overflowX: 'auto',
            paddingBottom: '8px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {days.map(d => {
            const isSelected = selectedDate === d.dateStr;
            return (
              <button
                key={d.dateStr}
                data-date={d.dateStr}
                type="button"
                onClick={() => onSelectDate(d.dateStr)}
                style={{
                  flex: '0 0 78px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '12px 8px',
                  borderRadius: 'var(--r, 14px)',
                  border: `1px solid ${isSelected ? accentColor : 'var(--hair, #D9D9D5)'}`,
                  background: isSelected ? accentColor : 'var(--card, #FFFFFF)',
                  boxShadow: isSelected ? 'var(--sh-acc)' : 'var(--sh1)',
                  color: isSelected ? 'var(--on-accent, #FFFFFF)' : 'var(--ink, #202124)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: isSelected ? 'var(--on-accent, #FFFFFF)' : 'var(--muted, #646464)',
                    textTransform: 'capitalize',
                  }}
                >
                  {d.dayName}
                </span>
                <span style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1 }}>{d.dayNum}</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: isSelected ? 'var(--on-accent, #FFFFFF)' : 'var(--muted, #646464)',
                    textTransform: 'capitalize',
                  }}
                >
                  {d.monthName}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Slots Container */}
      <div
        style={{
          background: 'var(--card, #FFFFFF)',
          borderRadius: 'var(--r, 20px)',
          border: '1px solid var(--hair, #D9D9D5)',
          boxShadow: 'var(--sh1)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Свободные слоты</h2>
          {isLoadingSlots && (
            <span style={{ fontSize: '14px', color: '#64748B' }}>Ищем свободные слоты…</span>
          )}
        </div>

        {isLoadingSlots ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '10px' }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <div
                key={i}
                className="sk"
                style={{
                  height: '46px',
                  borderRadius: '10px',
                  background: '#E2E8F0',
                }}
              />
            ))}
          </div>
        ) : availableSlots.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: '#F1F5F9',
                color: '#64748B',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 14 14" />
              </svg>
            </span>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>Нет свободных мест на выбранную дату</div>
            <div style={{ fontSize: '14px', color: '#64748B', maxWidth: '360px' }}>
              Попробуйте выбрать другой день или выберите вариант «Любой свободный мастер».
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Slot Groups: Morning, Afternoon, Evening */}
            {[
              { title: 'Утро (до 12:00)', slots: morningSlots },
              { title: 'День (12:00 - 17:00)', slots: afternoonSlots },
              { title: 'Вечер (после 17:00)', slots: eveningSlots },
            ].map(sec => {
              if (sec.slots.length === 0) return null;
              return (
                <div key={sec.title} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                    {sec.title}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px' }}>
                    {sec.slots.map(g => {
                      const isSelected = selectedSlot && formatSlotTime(selectedSlot.starts_at_utc) === g.timeKey;
                      const hasMultiple = g.allSlots.length > 1;
                      const priceLabel = hasMultiple && g.minPriceMinor !== g.maxPriceMinor
                        ? `от ${(g.minPriceMinor / 100).toLocaleString('ru-RU')} ₸`
                        : `${(g.minPriceMinor / 100).toLocaleString('ru-RU')} ₸`;

                      return (
                        <button
                          key={g.timeKey}
                          type="button"
                          onClick={() => {
                            // If currently selected slot is one of the masters for this time, retain it; otherwise pick bestSlot
                            const activeInGroup = g.allSlots.find(s => s.quote_id === selectedSlot?.quote_id);
                            onSelectSlot(activeInGroup || g.bestSlot);
                          }}
                          style={{
                            minHeight: '48px',
                            padding: '6px 8px',
                            borderRadius: '12px',
                            border: `1px solid ${isSelected ? accentColor : 'var(--hair, #D9D9D5)'}`,
                            background: isSelected ? accentColor : 'var(--tile, #F0F0EE)',
                            boxShadow: isSelected ? 'var(--sh-acc)' : 'none',
                            color: isSelected ? 'var(--on-accent, #FFFFFF)' : 'var(--ink, #202124)',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '2px',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <span style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1 }}>{g.timeKey}</span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 500,
                              color: isSelected ? 'var(--on-accent, #FFFFFF)' : 'var(--muted, #646464)',
                              lineHeight: 1,
                            }}
                          >
                            {priceLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Selected slot master confirmation badge */}
            {selectedSlot && (
              <div
                style={{
                  marginTop: '8px',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  color: '#166534',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  Выбран слот на <strong>{formatSlotTime(selectedSlot.starts_at_utc)}</strong>
                  {selectedSlot.staff_name && (
                    <span> · Мастер: <strong>{selectedSlot.staff_name}</strong></span>
                  )}
                </div>
                <div style={{ fontWeight: 700 }}>
                  Итоговая стоимость: {(selectedSlot.price_minor / 100).toLocaleString('ru-RU')} ₸
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
