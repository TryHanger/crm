import React from 'react';
import { BookingFlow, BookingStep } from '../types';

interface StepperProps {
  flow: BookingFlow;
  currentStep: BookingStep;
  onStepClick: (step: BookingStep) => void;
  accentColor?: string;
}

interface StepItem {
  key: BookingStep;
  label: string;
}

export const Stepper: React.FC<StepperProps> = ({
  flow,
  currentStep,
  onStepClick,
  accentColor = '#2563EB',
}) => {
  let steps: StepItem[] = [];

  if (flow === 'master-first') {
    steps = [
      { key: 'staff', label: 'Специалист' },
      { key: 'services', label: 'Услуги' },
      { key: 'datetime', label: 'Дата и время' },
      { key: 'confirm', label: 'Подтверждение' },
    ];
  } else if (flow === 'time-first') {
    steps = [
      { key: 'datetime', label: 'Время' },
      { key: 'services', label: 'Услуги' },
      { key: 'staff', label: 'Специалист' },
      { key: 'confirm', label: 'Подтверждение' },
    ];
  } else {
    // Default: service-first
    steps = [
      { key: 'services', label: 'Услуги' },
      { key: 'staff', label: 'Специалист' },
      { key: 'datetime', label: 'Дата и время' },
      { key: 'confirm', label: 'Подтверждение' },
    ];
  }

  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <nav aria-label="Шаги записи" style={{ width: '100%' }}>
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px 12px',
          fontSize: '16px',
        }}
      >
        {steps.map((st, idx) => {
          const isDone = currentIndex > idx;
          const isCurrent = st.key === currentStep;
          const isPrefTime = flow === 'time-first' && idx === 0 && !isDone;
          const isClickable = isDone;

          const bg = isCurrent ? accentColor : isDone ? '#0F172A' : '#E2E8F0';
          const fg = isCurrent || isDone ? '#FFFFFF' : '#64748B';
          const labelColor = isCurrent ? '#0F172A' : isDone ? '#334155' : '#64748B';
          const weight = isCurrent ? 700 : isDone ? 600 : 400;

          return (
            <li
              key={st.key}
              aria-current={isCurrent ? 'step' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                color: labelColor,
                cursor: isClickable ? 'pointer' : 'default',
              }}
              onClick={() => isClickable && onStepClick(st.key)}
            >
              <span
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: bg,
                  color: fg,
                  fontSize: '15px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                {isDone ? (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : isPrefTime ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15 14" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </span>
              <span style={{ fontWeight: weight }}>{st.label}</span>
              {idx < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: '28px',
                    height: '2px',
                    marginLeft: '2px',
                    background: '#E2E8F0',
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
