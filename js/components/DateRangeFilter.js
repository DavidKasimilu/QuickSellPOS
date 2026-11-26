// A single, simple date control: a "Today" chip (the default everywhere) plus one calendar button
// that opens a visual month-grid calendar where the person clicks a start day and, optionally, an
// end day for a range (click once for a single day, click a second day to extend it into a range).
//
// Dates are treated as LOCAL calendar days, not UTC, so "Today" always means today where the
// person actually is (the old per-page filters used toISOString(), which rolls over at UTC
// midnight - 3am in Nairobi - and showed the wrong day's figures for part of the day).
//
// The popover is appended to <body> and positioned with "position: fixed" from the toggle button's
// on-screen location, instead of living inside the page's own layout. Several containers in this
// app (.main-content, .top-bar) set "overflow: hidden" to control their own scrolling, which clips
// any ordinary dropdown placed inside them. Rendering the popover at the body level (a "portal")
// avoids that clipping no matter which page the control is used on.
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function startOfDayISO(dateStr) { return new Date(`${dateStr}T00:00:00`).toISOString(); }
export function endOfDayISO(dateStr) { return new Date(`${dateStr}T23:59:59.999`).toISOString(); }

/**
 * @param {HTMLElement} container - element to render the control into
 * @param {{start:string,end:string}} [initial] - defaults to today/today
 * @param {boolean} [allowFuture] - if false (default), dates after today are disabled (greyed, struck through)
 * @param {(range:{start:string,end:string,label:string,startISO:string,endISO:string})=>void} onChange
 */
export function mountDateRangeFilter(container, { initial, allowFuture = false, onChange } = {}) {
  let start = initial?.start || todayStr();
  let end = initial?.end || start;
  let popoverOpen = false;

  // Staged selection inside the open calendar - only becomes the real filter when "Apply" is pressed
  let viewDate = new Date(`${end}T00:00:00`);
  let stageStart = start;
  let stageEnd = end;
  let pickPhase = 'start';   // 'start' = next click begins a new selection; 'end' = next click completes the range

  container.innerHTML = `
    <div class="qs-daterange" style="display:inline-flex; gap:8px; align-items:center;">
      <button type="button" class="date-chip" data-qs-today>Today</button>
      <button type="button" class="date-chip" data-qs-toggle style="display:inline-flex; align-items:center; gap:6px;">
        <i data-lucide="calendar" style="width:14px; height:14px;"></i><span data-qs-label>Today</span>
      </button>
    </div>`;

  // The popover itself lives at the END of <body>, not inside `container` - see note above.
  const pop = document.createElement('div');
  pop.className = 'qs-daterange-pop';
  pop.style.cssText = 'display:none; position:fixed; z-index:9000; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:14px; box-shadow:0 14px 36px rgba(0,0,0,.22); padding:18px; width:320px;';
  document.body.appendChild(pop);

  const todayBtn = container.querySelector('[data-qs-today]');
  const toggleBtn = container.querySelector('[data-qs-toggle]');
  const label = container.querySelector('[data-qs-label]');

  function fire() {
    const range = { start, end, label: start === end ? dayLabel(start) : `${dayLabel(start)} - ${dayLabel(end)}`, startISO: startOfDayISO(start), endISO: endOfDayISO(end) };
    onChange?.(range);
  }

  function renderActiveState() {
    const isToday = start === todayStr() && end === start;
    todayBtn.classList.toggle('active', isToday);
    toggleBtn.classList.toggle('active', !isToday);
    label.textContent = isToday ? 'Today' : (start === end ? dayLabel(start) : `${dayLabel(start)} - ${dayLabel(end)}`);
    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // ---------------------------------------------------------------- calendar grid
  function renderCalendar() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const firstWeekday = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayYmd = todayStr();

    const yearOptions = [];
    const curYear = new Date().getFullYear();
    for (let yy = curYear - 6; yy <= curYear + 1; yy++) yearOptions.push(`<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy}</option>`);
    const monthOptions = MONTH_NAMES.map((name, i) => `<option value="${i}" ${i === m ? 'selected' : ''}>${name}</option>`).join('');

    let cells = '';
    for (let i = 0; i < firstWeekday; i++) cells += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${y}-${pad(m + 1)}-${pad(d)}`;
      const disabled = !allowFuture && dStr > todayYmd;
      const isStart = dStr === stageStart;
      const isEnd = dStr === stageEnd;
      const inRange = !disabled && stageStart && stageEnd && dStr > stageStart && dStr < stageEnd;
      const isToday = dStr === todayYmd;

      let cls = 'qs-cal-day';
      if (disabled) cls += ' qs-cal-day--disabled';
      if (inRange) cls += ' qs-cal-day--inrange';
      if (isStart || isEnd) cls += ' qs-cal-day--selected';
      if (isToday && !isStart && !isEnd) cls += ' qs-cal-day--today';

      cells += `<button type="button" class="${cls}" ${disabled ? 'disabled' : `data-qs-day="${dStr}"`}>${d}</button>`;
    }

    pop.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <button type="button" data-qs-prev style="border:0; background:none; cursor:pointer; color:var(--text-muted); padding:4px;">
          <i data-lucide="chevron-left" style="width:18px; height:18px;"></i>
        </button>
        <div style="display:flex; gap:6px;">
          <select data-qs-month style="border:none; background:none; font-weight:700; font-size:0.95rem; color:var(--text-main); cursor:pointer;">${monthOptions}</select>
          <select data-qs-year style="border:none; background:none; font-weight:700; font-size:0.95rem; color:var(--text-main); cursor:pointer;">${yearOptions.join('')}</select>
        </div>
        <button type="button" data-qs-next style="border:0; background:none; cursor:pointer; color:var(--text-muted); padding:4px;">
          <i data-lucide="chevron-right" style="width:18px; height:18px;"></i>
        </button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; margin-bottom:4px;">
        ${WEEKDAYS.map((w) => `<div style="text-align:center; font-size:0.72rem; color:var(--text-muted); padding:4px 0;">${w}</div>`).join('')}
      </div>
      <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; margin-bottom:14px;">${cells}</div>
      <div style="display:flex; gap:14px; margin-bottom:14px;">
        <div style="flex:1;">
          <label style="display:block; font-size:0.72rem; color:var(--text-muted); margin-bottom:2px;">Start date</label>
          <div style="font-size:0.92rem; color:var(--text-main); border-bottom:1px solid var(--border-subtle); padding-bottom:4px;">${stageStart.replace(/-/g, '/')}</div>
        </div>
        <div style="flex:1;">
          <label style="display:block; font-size:0.72rem; color:var(--text-muted); margin-bottom:2px;">End date</label>
          <div style="font-size:0.92rem; color:var(--text-main); border-bottom:1px solid var(--border-subtle); padding-bottom:4px;">${stageEnd.replace(/-/g, '/')}</div>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button type="button" class="btn btn-outline btn-sm" data-qs-cancel>CANCEL</button>
        <button type="button" class="btn btn-teal-primary btn-sm" data-qs-apply>APPLY</button>
      </div>`;

    if (window.lucide) window.lucide.createIcons({ root: pop });

    pop.querySelector('[data-qs-prev]').onclick = () => { viewDate = new Date(y, m - 1, 1); renderCalendar(); };
    pop.querySelector('[data-qs-next]').onclick = () => { viewDate = new Date(y, m + 1, 1); renderCalendar(); };
    pop.querySelector('[data-qs-month]').onchange = (e) => { viewDate = new Date(y, Number(e.target.value), 1); renderCalendar(); };
    pop.querySelector('[data-qs-year]').onchange = (e) => { viewDate = new Date(Number(e.target.value), m, 1); renderCalendar(); };
    pop.querySelectorAll('[data-qs-day]').forEach((btn) => {
      btn.onclick = () => {
        const clicked = btn.dataset.qsDay;
        if (pickPhase === 'start') {
          stageStart = clicked; stageEnd = clicked; pickPhase = 'end';
        } else if (clicked < stageStart) {
          stageStart = clicked; pickPhase = 'end';   // picked an earlier day: it becomes the new start
        } else {
          stageEnd = clicked; pickPhase = 'start';   // range complete; next click starts a fresh selection
        }
        renderCalendar();
      };
    });
    pop.querySelector('[data-qs-cancel]').onclick = closePopover;
    pop.querySelector('[data-qs-apply]').onclick = () => {
      start = stageStart; end = stageEnd;
      closePopover();
      renderActiveState();
      fire();
    };
  }

  function positionPopover() {
    const r = toggleBtn.getBoundingClientRect();
    const popW = pop.offsetWidth || 320;
    let left = r.left;
    if (left + popW > window.innerWidth - 12) left = Math.max(12, window.innerWidth - popW - 12);
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.left = `${left}px`;
  }

  function closePopover() {
    pop.style.display = 'none';
    popoverOpen = false;
    window.removeEventListener('scroll', closeOnScroll, true);
    window.removeEventListener('resize', positionPopover);
  }
  function closeOnScroll(e) {
    if (pop.contains(e.target)) return;   // scrolling inside the popover itself is fine
    closePopover();
  }
  function openPopover() {
    stageStart = start; stageEnd = end; pickPhase = 'start';
    viewDate = new Date(`${end}T00:00:00`);
    renderCalendar();
    pop.style.display = 'block';
    popoverOpen = true;
    positionPopover();
    // any scroll elsewhere on the page would leave the popover detached from the button, so close it
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', positionPopover);
  }

  todayBtn.onclick = () => { start = todayStr(); end = start; renderActiveState(); fire(); };
  toggleBtn.onclick = () => (popoverOpen ? closePopover() : openPopover());

  const onDocClick = (e) => {
    if (popoverOpen && !pop.contains(e.target) && !container.contains(e.target)) closePopover();
  };
  document.addEventListener('click', onDocClick);

  renderActiveState();

  return {
    getRange: () => ({ start, end, label: start === end ? dayLabel(start) : `${dayLabel(start)} - ${dayLabel(end)}`, startISO: startOfDayISO(start), endISO: endOfDayISO(end) }),
    setRange(s, e = s) { start = s; end = e; renderActiveState(); },
    destroy: () => {
      document.removeEventListener('click', onDocClick);
      closePopover();
      pop.remove();
    },
  };
}
