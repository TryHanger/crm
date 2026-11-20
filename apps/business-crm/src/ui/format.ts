/* Общие форматтеры и справочники интерфейса (по макету). */

export const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Подтверждена',
  arrived: 'Пришёл',
  in_progress: 'В работе',
  completed: 'Завершена',
  no_show: 'Неявка',
  cancelled: 'Отменена',
};

/** цвета аватаров мастеров — из макета */
export const STAFF_COLORS = ['#16161A', '#8E7CF8', '#F0A35E', '#5DB7A0', '#7FA6F2', '#C9A0DC'];
export const staffColor = (i: number) => STAFF_COLORS[((i % STAFF_COLORS.length) + STAFF_COLORS.length) % STAFF_COLORS.length];

/** сумма в тиынах → «8 000 ₸» */
export const money = (minor: number) => `${Math.round(minor / 100).toLocaleString('ru-RU').replace(/,/g, ' ')} ₸`;
