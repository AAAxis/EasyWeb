const DAY_MS = 24 * 60 * 60 * 1000;
export const RENTAL_WARNING_DAYS = 28;
export const RENTAL_TERM_DAYS = 29;

/** Count full 24-hour periods from activation, independent of timezone/DST. */
export function rentalSchedule(activatedAt: string | Date) {
  const start = new Date(activatedAt).getTime();
  if (!Number.isFinite(start)) throw new Error('INVALID_ACTIVATION_DATE');
  return {
    periodStartsAt: new Date(start).toISOString(),
    warningAt: new Date(start + RENTAL_WARNING_DAYS * DAY_MS).toISOString(),
    expiresAt: new Date(start + RENTAL_TERM_DAYS * DAY_MS).toISOString(),
  };
}

export function rentalStage(activatedAt: string | Date, now: string | Date) {
  const schedule = rentalSchedule(activatedAt);
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) throw new Error('INVALID_CURRENT_DATE');
  if (time >= Date.parse(schedule.expiresAt)) return 'expired';
  if (time >= Date.parse(schedule.warningAt)) return 'warning';
  return 'active';
}
