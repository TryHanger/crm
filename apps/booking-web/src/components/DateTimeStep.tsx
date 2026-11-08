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
  accentColor = '#2563EB',
}) => {
  // Generate next 14 days starting from today
  const days: { dateStr: string; dayName: string; dayNum: number; monthName: string }[] = [];
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
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

  // Group slots into Morning, Afternoon, Evening based on local hour
  const morningSlots: SlotResponse[] = [];
  const afternoonSlots: SlotResponse[] = [];
  const eveningSlots: SlotResponse[] = [];

  availableSlots.forEach(s => {
    const d = new Date(s.starts_at_utc);
    // Almaty is UTC+5 (or use local getHours if converted)
    const hour = (d.getUTCHours() + 5) % 24;
    if (hour < 12) {
      morningSlots.push(s);
    } else if (hour < 17) {
      afternoonSlots.push(s);
    } else {
      eveningSlots.push(s);
    }
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '32px', lineHeight: 1.2, fontWeight: 700 }}>
          Выберите дату и время
        </h1>
        <p style={{ margin: 0, color: '#475569', fontSize: '16px' }}>
          Доступные интервалы рассчитаны на основе длительности выбранных услуг
        </p>
      </div>

      {/* Date Carousel / Horizontal List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Дата визита</div>
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
                type="button"
                onClick={() => onSelectDate(d.dateStr)}
                style={{
                  flex: '0 0 80px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '12px 8px',
                  borderRadius: '14px',
                  border: `1px solid ${isSelected ? accentColor : '#CBD5E1'}`,
                  background: isSelected ? accentColor : '#FFFFFF',
                  color: isSelected ? '#FFFFFF' : '#0F172A',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: isSelected ? '#FFFFFF' : '#64748B',
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
                    color: isSelected ? '#FFFFFF' : '#64748B',
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
          background: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
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
            {/* Morning */}
            {morningSlots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                  Утро (до 12:00)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '10px' }}>
                  {morningSlots.map(s => {
                    const isSelected = selectedSlot?.quote_id === s.quote_id;
                    const timeLabel = formatSlotTime(s.starts_at_utc);
                    return (
                      <button
                        key={s.quote_id}
                        type="button"
                        onClick={() => onSelectSlot(s)}
                        style={{
                          height: '46px',
                          borderRadius: '10px',
                          border: `1px solid ${isSelected ? accentColor : '#CBD5E1'}`,
                          background: isSelected ? accentColor : '#FFFFFF',
                          color: isSelected ? '#FFFFFF' : '#0F172A',
                          fontSize: '16px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {timeLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Afternoon */}
            {afternoonSlots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                  День (12:00 - 17:00)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '10px' }}>
                  {afternoonSlots.map(s => {
                    const isSelected = selectedSlot?.quote_id === s.quote_id;
                    const timeLabel = formatSlotTime(s.starts_at_utc);
                    return (
                      <button
                        key={s.quote_id}
                        type="button"
                        onClick={() => onSelectSlot(s)}
                        style={{
                          height: '46px',
                          borderRadius: '10px',
                          border: `1px solid ${isSelected ? accentColor : '#CBD5E1'}`,
                          background: isSelected ? accentColor : '#FFFFFF',
                          color: isSelected ? '#FFFFFF' : '#0F172A',
                          fontSize: '16px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {timeLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Evening */}
            {eveningSlots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                  Вечер (после 17:00)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '10px' }}>
                  {eveningSlots.map(s => {
                    const isSelected = selectedSlot?.quote_id === s.quote_id;
                    const timeLabel = formatSlotTime(s.starts_at_utc);
                    return (
                      <button
                        key={s.quote_id}
                        type="button"
                        onClick={() => onSelectSlot(s)}
                        style={{
                          height: '46px',
                          borderRadius: '10px',
                          border: `1px solid ${isSelected ? accentColor : '#CBD5E1'}`,
                          background: isSelected ? accentColor : '#FFFFFF',
                          color: isSelected ? '#FFFFFF' : '#0F172A',
                          fontSize: '16px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {timeLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
