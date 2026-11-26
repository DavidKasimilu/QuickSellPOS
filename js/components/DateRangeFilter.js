// A single, simple date control: a "Today" chip (the default everywhere) plus one calendar button
// that opens a small popover where the person picks a start date and, optionally, an end date for
// a range. Picking only a start date (or the same date twice) is a single-day filter.
//
// Dates are treated as LOCAL calendar days, not UTC, so "Today" always means today where the
// person actually is (the old per-page filters used toISOString(), which rolls over at UTC
// midnight - 3am in Nairobi - and showed the wrong day's figures for part of the day).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function startOfDayISO(dateStr) { return new Date(`${dateStr}T00:00:00`).toISOString(); }
export function endOfDayISO(dateStr) { return new Date(`${dateStr}T23:59:59.999`).toISOString(); }

/**
 * @param {HTMLElement} container - element to render the control into
 * @param {{start:string,end:string}} [initial] - defaults to today/today
 * @param {(range:{start:string,end:string,label:string,startISO:string,endISO:string})=>void} onChange
 */
export function mountDateRangeFilter(container, { initial, onChange } = {}) {
  let start = initial?.start || todayStr();
  let end = initial?.end || start;
  let popoverOpen = false;

  container.innerHTML = `
    <div class="qs-daterange" style="position:relative; display:inline-flex; gap:8px; align-items:center;">
      <button type="button" class="date-chip" data-qs-today>Today</button>
      <button type="button" class="date-chip" data-qs-toggle style="display:inline-flex; align-items:center; gap:6px;">
        <i data-lucide="calendar" style="width:14px; height:14px;"></i><span data-qs-label>Today</span>
      </button>
      <div data-qs-pop style="display:none; position:absolute; top:calc(100% + 8px); left:0; z-index:40; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.18); padding:14px; min-width:260px;">
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="display:block; font-size:0.72rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">FROM</label>
            <input type="date" data-qs-start class="input-field" style="width:100%; padding:6px 8px; font-size:0.8125rem;" />
          </div>
          <div style="flex:1;">
            <label style="display:block; font-size:0.72rem; font-weight:600; color:var(--text-muted); margin-bottom:4px;">TO</label>
            <input type="date" data-qs-end class="input-field" style="width:100%; padding:6px 8px; font-size:0.8125rem;" />
          </div>
        </div>
        <p style="font-size:0.72rem; color:var(--text-muted); margin:0 0 10px;">Leave "To" the same as "From" for a single day.</p>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button type="button" class="btn btn-outline btn-sm" data-qs-cancel>Cancel</button>
          <button type="button" class="btn btn-teal-primary btn-sm" data-qs-apply>Apply</button>
        </div>
      </div>
    </div>`;

  const todayBtn = container.querySelector('[data-qs-today]');
  const toggleBtn = container.querySelector('[data-qs-toggle]');
  const label = container.querySelector('[data-qs-label]');
  const pop = container.querySelector('[data-qs-pop]');
  const startInput = container.querySelector('[data-qs-start]');
  const endInput = container.querySelector('[data-qs-end]');

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

  function closePopover() { pop.style.display = 'none'; popoverOpen = false; }
  function openPopover() {
    startInput.value = start;
    endInput.value = end;
    pop.style.display = 'block';
    popoverOpen = true;
  }

  todayBtn.onclick = () => { start = todayStr(); end = start; renderActiveState(); fire(); };
  toggleBtn.onclick = () => (popoverOpen ? closePopover() : openPopover());
  container.querySelector('[data-qs-cancel]').onclick = closePopover;
  container.querySelector('[data-qs-apply]').onclick = () => {
    const s = startInput.value || todayStr();
    const e = endInput.value || s;
    if (s > e) { start = e; end = s; } else { start = s; end = e; }
    closePopover();
    renderActiveState();
    fire();
  };

  const onDocClick = (e) => { if (popoverOpen && !container.contains(e.target)) closePopover(); };
  document.addEventListener('click', onDocClick);

  renderActiveState();

  return {
    getRange: () => ({ start, end, label: start === end ? dayLabel(start) : `${dayLabel(start)} - ${dayLabel(end)}`, startISO: startOfDayISO(start), endISO: endOfDayISO(end) }),
    setRange(s, e = s) { start = s; end = e; renderActiveState(); },
    destroy: () => document.removeEventListener('click', onDocClick),
  };
}
