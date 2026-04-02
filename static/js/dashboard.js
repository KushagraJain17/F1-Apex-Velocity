/**
 * APEX VELOCITY — Dashboard Calendar Widget
 * Interactive race calendar with month navigation, race weekend markers, and event tooltips.
 */

(function () {
  'use strict';

  /* ── Parse schedule data ──────────────────────────────────── */
  const dataEl = document.getElementById('calendar-events-data');
  const events = dataEl ? JSON.parse(dataEl.textContent) : [];

  /* Build a lookup: "YYYY-MM-DD" → event info
     Each event has EventDateTimeIso (race day) and Sessions (which span multiple days).
     We mark the full weekend range. */
  const raceDayMap = {};   // dateStr → { event, isRaceDay }
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const MONTH_ABBR = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
  };

  events.forEach(ev => {
    if (!ev.EventDateTimeIso) return;

    const raceDate = new Date(ev.EventDateTimeIso);
    if (isNaN(raceDate.getTime())) return;
    const raceYear = raceDate.getFullYear();

    // Parse session dates to find the full weekend range
    const sessionDates = [];
    if (ev.Sessions && ev.Sessions.length > 0) {
      ev.Sessions.forEach(s => {
        // Session time format from backend: "Fri 14 Mar 16:00" (no year)
        // We infer year from the race date's ISO timestamp
        const parsed = parseDateFromSession(s.time, raceYear);
        if (parsed) sessionDates.push(parsed);
      });
    }

    // If we have session dates, use those; otherwise fall back to race date ±2 days
    let startDate, endDate;
    if (sessionDates.length > 0) {
      sessionDates.sort((a, b) => a - b);
      startDate = sessionDates[0];
      endDate = sessionDates[sessionDates.length - 1];
    } else {
      endDate = new Date(raceDate);
      startDate = new Date(raceDate);
      startDate.setDate(startDate.getDate() - 2);
    }

    // Mark each day in range
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = dateKey(cursor);
      const isRace = key === dateKey(raceDate) || key === dateKey(endDate);
      raceDayMap[key] = {
        event: ev,
        isRaceDay: isRace,
        isSprint: ev.Format === 'sprint',
        isPast: raceDate.getTime() < Date.now()
      };
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  /**
   * Parse session time string.
   * Format from backend: "Fri 14 Mar 16:00" (no year) or sometimes "Fri 14 Mar 2026 16:00"
   * @param {string} timeStr
   * @param {number} fallbackYear - year from the event's ISO date
   */
  function parseDateFromSession(timeStr, fallbackYear) {
    if (!timeStr) return null;
    const parts = timeStr.trim().split(' ');
    // Expect at least: dayName dayNum monthAbbr time
    // e.g. ["Fri", "14", "Mar", "16:00"] or ["Fri", "14", "Mar", "2026", "16:00"]
    if (parts.length < 4) return null;

    const dayNum = parseInt(parts[1]);
    const monthStr = parts[2];
    const month = MONTH_ABBR[monthStr];
    if (month === undefined || isNaN(dayNum)) return null;

    // Check if parts[3] is a year (4 digits) or a time (contains ':')
    let year = fallbackYear;
    if (parts.length >= 5 && /^\d{4}$/.test(parts[3])) {
      year = parseInt(parts[3]);
    }

    return new Date(year, month, dayNum);
  }

  function dateKey(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ── Calendar state ───────────────────────────────────────── */
  const today = new Date();
  let currentYear = today.getFullYear();
  let currentMonth = today.getMonth();

  // If there are events, start on the month of the first upcoming race or current month
  if (events.length > 0) {
    const now = Date.now();
    const upcoming = events.find(e => {
      const d = new Date(e.EventDateTimeIso);
      return !isNaN(d.getTime()) && d.getTime() >= now;
    });
    if (upcoming) {
      const ud = new Date(upcoming.EventDateTimeIso);
      currentYear = ud.getFullYear();
      currentMonth = ud.getMonth();
    }
  }

  const grid = document.getElementById('cal-grid');
  const titleEl = document.getElementById('cal-month-title');
  const prevBtn = document.getElementById('cal-prev');
  const nextBtn = document.getElementById('cal-next');
  const tooltip = document.getElementById('cal-tooltip');

  if (!grid) return; // safety bail-out

  prevBtn.addEventListener('click', () => { navigateMonth(-1); });
  nextBtn.addEventListener('click', () => { navigateMonth(1); });

  // Close tooltip when clicking outside (kept for safety, but primary hide is hover/scroll)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.calendar-day--race') && !e.target.closest('.calendar-tooltip')) {
      hideTooltip();
    }
  });

  /* ── Render ───────────────────────────────────────────────── */
  function navigateMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
    render();
  }

  function render() {
    titleEl.textContent = MONTHS[currentMonth] + ' ' + currentYear;
    grid.innerHTML = '';
    hideTooltip();

    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const totalDays = lastDay.getDate();

    // Monday=0 ... Sunday=6  (JS getDay: 0=Sun 1=Mon ... 6=Sat)
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    // Empty cells before month starts
    for (let i = 0; i < startDow; i++) {
      const empty = document.createElement('div');
      empty.className = 'calendar-day calendar-day--empty';
      grid.appendChild(empty);
    }

    // Day cells
    for (let d = 1; d <= totalDays; d++) {
      const cell = document.createElement('div');
      cell.className = 'calendar-day';

      const dateStr = currentYear + '-' +
        String(currentMonth + 1).padStart(2, '0') + '-' +
        String(d).padStart(2, '0');

      const isToday = (d === today.getDate() &&
                       currentMonth === today.getMonth() &&
                       currentYear === today.getFullYear());

      const raceInfo = raceDayMap[dateStr];

      if (isToday) cell.classList.add('calendar-day--today');

      if (raceInfo) {
        cell.classList.add('calendar-day--race');
        if (raceInfo.isSprint)  cell.classList.add('calendar-day--sprint');
        if (raceInfo.isPast)    cell.classList.add('calendar-day--past');
        if (raceInfo.isRaceDay) cell.classList.add('calendar-day--raceday');

        cell.addEventListener('mouseenter', () => {
          showTooltip(raceInfo.event, cell);
        });

        cell.addEventListener('mouseleave', () => {
          // Store timeout to clear if entering another cell or tooltip
          hideTimeout = setTimeout(() => {
            if (!tooltip.matches(':hover') && !cell.matches(':hover')) {
              hideTooltip();
            }
          }, 150);
        });
      }

      const num = document.createElement('span');
      num.className = 'calendar-day__num';
      num.textContent = d;
      cell.appendChild(num);

      if (raceInfo) {
        const dot = document.createElement('span');
        dot.className = 'calendar-day__dot';
        cell.appendChild(dot);
      }

      grid.appendChild(cell);
    }
  }

  // Hide tooltip on scroll
  window.addEventListener('scroll', hideTooltip, { passive: true });

  // Keep tooltip open while mouse is inside it
  tooltip.addEventListener('mouseenter', () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  });

  // Also hide tooltip when mouse leaves the tooltip itself
  tooltip.addEventListener('mouseleave', () => {
    hideTooltip();
  });

  /* ── Tooltip ──────────────────────────────────────────────── */
  let activeCell = null;
  let hideTimeout = null;

  function showTooltip(ev, cell) {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    activeCell = cell;

    document.getElementById('cal-tip-round').textContent = 'ROUND ' + String(ev.RoundNumber || '').toString().padStart(2, '0');
    document.getElementById('cal-tip-name').textContent = ev.EventName;
    document.getElementById('cal-tip-location').textContent = ev.Location + ', ' + ev.Country;
    document.getElementById('cal-tip-date').textContent = ev.EventDate;

    const badges = document.getElementById('cal-tip-badges');
    badges.innerHTML = '';

    const raceDate = new Date(ev.EventDateTimeIso);
    const isPast = raceDate.getTime() < Date.now();

    if (isPast) {
      const b = document.createElement('span');
      b.className = 'calendar-tooltip__badge calendar-tooltip__badge--done';
      b.textContent = 'COMPLETED';
      badges.appendChild(b);
    }
    if (ev.Format === 'sprint') {
      const b = document.createElement('span');
      b.className = 'calendar-tooltip__badge calendar-tooltip__badge--sprint';
      b.textContent = 'SPRINT';
      badges.appendChild(b);
    }

    tooltip.classList.add('visible');

    // Position using viewport coords (tooltip is position:fixed)
    const cellRect = cell.getBoundingClientRect();
    const tipWidth = 260;
    const tipHeight = tooltip.offsetHeight || 200;

    let left = cellRect.left + cellRect.width / 2 - tipWidth / 2;
    // Clamp to viewport edges
    if (left < 12) left = 12;
    if (left + tipWidth > window.innerWidth - 12) left = window.innerWidth - tipWidth - 12;

    // Show below the cell, or flip above if near bottom
    let top = cellRect.bottom + 8;
    if (top + tipHeight > window.innerHeight - 12) {
      top = cellRect.top - tipHeight - 8;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
    activeCell = null;
  }

  /* ── Initial render ───────────────────────────────────────── */
  render();

  /* ── Debug: log to verify data ────────────────────────────── */
  console.log('[Calendar] Events loaded:', events.length);
  console.log('[Calendar] Race days mapped:', Object.keys(raceDayMap).length, 'days');
  if (events.length > 0) {
    console.log('[Calendar] First event sessions sample:', events[0].Sessions);
  }
})();
