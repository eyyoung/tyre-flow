const DEFAULT_STAGGER_WINDOW_WORKDAYS = 5;

function startOfLocalDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function isWorkDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  return dayOfWeek >= 1 && dayOfWeek <= 6;
}

function isFinalWorkDayOfMonth(date: Date): boolean {
  if (!isWorkDay(date)) {
    return false;
  }

  const month = date.getMonth();
  const currentDate = startOfLocalDay(date);
  currentDate.setDate(currentDate.getDate() + 1);

  while (currentDate.getMonth() === month) {
    if (isWorkDay(currentDate)) {
      return false;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return true;
}

export function getWorkDaysInRange(startDate: Date, endDate: Date): Date[] {
  const workDays: Date[] = [];
  const currentDate = startOfLocalDay(startDate);
  const normalizedEndDate = startOfLocalDay(endDate);

  while (currentDate <= normalizedEndDate) {
    if (isWorkDay(currentDate)) {
      workDays.push(new Date(currentDate));
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return workDays;
}

export function getStaggeredWorkdayEndDate(
  startDate: Date,
  endDate: Date,
  key: string,
  maxStaggerWindowWorkDays: number = DEFAULT_STAGGER_WINDOW_WORKDAYS
): Date {
  const workDays = getWorkDaysInRange(startDate, endDate);
  if (workDays.length <= 1) {
    return workDays[0] ?? startOfLocalDay(endDate);
  }

  const latestWorkDay = workDays[workDays.length - 1];
  if (!isFinalWorkDayOfMonth(latestWorkDay)) {
    return latestWorkDay;
  }

  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return latestWorkDay;
  }

  const rangeBasedMaxOffset = Math.floor((workDays.length - 1) / 4);
  const maxOffset = Math.min(
    maxStaggerWindowWorkDays,
    rangeBasedMaxOffset,
    workDays.length - 1
  );

  if (maxOffset <= 0) {
    return latestWorkDay;
  }

  const offset = stableHash(trimmedKey) % (maxOffset + 1);
  return workDays[workDays.length - 1 - offset];
}
