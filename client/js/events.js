/**
 * File: /workspaces/elorm-borborbor-website.org/client/js/events.js
 *
 * Responsibilities:
 * - Calendar rendering and management (month/week/day views, responsive)
 * - Event data fetching from backend (expects /api/events?start=ISO&end=ISO)
 * - Booking form handling (validation + POST to /api/bookings)
 * - Date validation and formatting helpers
 * - Event filtering by date/category
 * - Modal displays for event details and contact/booking
 * - Integration with contact system (POST to /api/contact)
 *
 * Usage:
 * - Include this script on any page with a container with id="calendar"
 * - Optional containers: #filters, #modal-root
 *
 * Notes:
 * - Backend endpoints assumed: /api/events, /api/bookings, /api/contact
 * - Styles and markup are minimal; adapt CSS classes as needed in your app.
 */

/* ===========================
    Utilities: Date helpers
    =========================== */

const DateUtils = {
  iso(date) {
     // Return ISO yyyy-mm-dd
     if (!date || !(date instanceof Date)) return null;
     return date.toISOString().slice(0, 10);
  },

  isValidISO(str) {
     if (!str) return false;
     const d = new Date(str);
     return !Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(str);
  },

  parseISO(str) {
     if (!this.isValidISO(str)) return null;
     // Keep as local midnight
     const parts = str.split('-').map(Number);
     return new Date(parts[0], parts[1] - 1, parts[2]);
  },

  formatHuman(date, options = {}) {
     if (!date) return '';
     const formatter = new Intl.DateTimeFormat(undefined, Object.assign({
        year: 'numeric', month: 'short', day: 'numeric'
     }, options));
     return formatter.format(date);
  },

  startOfMonth(date) {
     return new Date(date.getFullYear(), date.getMonth(), 1);
  },

  endOfMonth(date) {
     return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  },

  addDays(date, n) {
     const d = new Date(date);
     d.setDate(d.getDate() + n);
     return d;
  },

  startOfWeek(date, weekStartsOn = 1) { // 0=Sun,1=Mon
     const d = new Date(date);
     const diff = (d.getDay() + 7 - weekStartsOn) % 7;
     return this.addDays(d, -diff);
  },

  addMonths(date, n) {
     return new Date(date.getFullYear(), date.getMonth() + n, 1);
  },

  sameDay(a, b) {
     return a.getFullYear() === b.getFullYear() &&
              a.getMonth() === b.getMonth() &&
              a.getDate() === b.getDate();
  },

  withinRange(date, start, end) {
     return date >= start && date <= end;
  }
};

/* ===========================
    Simple Modal System
    =========================== */

const Modal = {
  root: null,
  init() {
     this.root = document.getElementById('modal-root') || this.createRoot();
  },

  createRoot() {
     const div = document.createElement('div');
     div.id = 'modal-root';
     div.style.position = 'fixed';
     div.style.top = 0;
     div.style.left = 0;
     div.style.right = 0;
     div.style.bottom = 0;
     div.style.zIndex = 9999;
     div.style.pointerEvents = 'none';
     document.body.appendChild(div);
     return div;
  },

  open(contentHtml, options = {}) {
     this.init();
     this.clear();
     const overlay = document.createElement('div');
     overlay.className = 'modal-overlay';
     overlay.style.position = 'absolute';
     overlay.style.inset = 0;
     overlay.style.background = options.transparent ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.5)';
     overlay.style.display = 'flex';
     overlay.style.alignItems = 'center';
     overlay.style.justifyContent = 'center';
     overlay.style.pointerEvents = 'auto';

     const dialog = document.createElement('div');
     dialog.className = 'modal-dialog';
     dialog.style.background = '#fff';
     dialog.style.maxWidth = '960px';
     dialog.style.width = 'min(95%,800px)';
     dialog.style.maxHeight = '90vh';
     dialog.style.overflow = 'auto';
     dialog.style.borderRadius = '8px';
     dialog.style.boxShadow = '0 8px 32px rgba(0,0,0,.25)';
     dialog.style.padding = '16px';
     dialog.innerHTML = contentHtml;

     // close on overlay click (if enabled)
     overlay.addEventListener('click', (e) => {
        if (e.target === overlay && options.closeOnBackdrop !== false) this.close();
     });

     // ESC to close
     const escHandler = (e) => { if (e.key === 'Escape') this.close(); };
     document.addEventListener('keydown', escHandler, { once: true });

     overlay.appendChild(dialog);
     this.root.appendChild(overlay);
     return () => this.close();
  },

  close() {
     if (!this.root) return;
     this.root.innerHTML = '';
  },

  clear() {
     if (this.root) this.root.innerHTML = '';
  }
};

/* ===========================
    Fetching: Events + Helpers
    =========================== */

const API = {
  async fetchEvents(startISO, endISO) {
     // Accepts ISO yyyy-mm-dd strings
     try {
        const res = await fetch(`/api/events?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error(`Failed to fetch events (${res.status})`);
        const data = await res.json();
        // Expect array of events with: id, title, start (ISO), end (ISO optional), category, description, contact
        return Array.isArray(data) ? data : [];
     } catch (err) {
        console.warn('Events fetch failed, using fallback empty array', err);
        return [];
     }
  },

  async submitBooking(payload) {
     try {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || `Booking failed (${res.status})`);
        }
        return await res.json();
     } catch (err) {
        throw err;
     }
  },

  async sendContact(payload) {
     try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || `Contact failed (${res.status})`);
        }
        return await res.json();
     } catch (err) {
        throw err;
     }
  }
};

/* ===========================
    Calendar Core
    =========================== */

const Calendar = {
  state: {
     viewDate: new Date(),
     view: 'month', // 'month' | 'week' | 'day'
     events: [],
     filters: {
        categories: new Set(), // if empty = show all
        startDate: null,
        endDate: null
     }
  },

  init() {
     this.root = document.getElementById('calendar') || this.createPlaceholder();
     this.controls = null;
     this.grid = null;
     this.setupControls();
     this.fetchAndRender();
     window.addEventListener('resize', () => this.onResize());
  },

  createPlaceholder() {
     const container = document.createElement('div');
     container.id = 'calendar';
     document.body.appendChild(container);
     return container;
  },

  setupControls() {
     // Build basic controls UI above calendar
     const controlsMarkup = `
        <div class="cal-controls" style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
          <button id="cal-prev" aria-label="Previous">◀</button>
          <button id="cal-today" aria-label="Today">Today</button>
          <button id="cal-next" aria-label="Next">▶</button>
          <div style="flex:1;text-align:center;font-weight:600;">
             <span id="cal-title"></span>
          </div>
          <div>
             <select id="cal-view">
                <option value="month">Month</option>
                <option value="week">Week</option>
                <option value="day">Day</option>
             </select>
          </div>
        </div>
        <div id="cal-grid" class="cal-grid"></div>
     `;
     this.root.innerHTML = controlsMarkup;
     this.controls = {
        prev: this.root.querySelector('#cal-prev'),
        today: this.root.querySelector('#cal-today'),
        next: this.root.querySelector('#cal-next'),
        title: this.root.querySelector('#cal-title'),
        viewSelect: this.root.querySelector('#cal-view')
     };
     this.grid = this.root.querySelector('#cal-grid');

     this.controls.prev.addEventListener('click', () => this.changePeriod(-1));
     this.controls.next.addEventListener('click', () => this.changePeriod(1));
     this.controls.today.addEventListener('click', () => this.goToday());
     this.controls.viewSelect.value = this.state.view;
     this.controls.viewSelect.addEventListener('change', (e) => {
        this.state.view = e.target.value;
        this.fetchAndRender();
     });

     // Optional filters container wiring
     const filtersRoot = document.getElementById('filters');
     if (filtersRoot) this.initFilters(filtersRoot);
  },

  initFilters(root) {
     // Simple category checkboxes and date range
     if (!root) return;
     root.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <label>Categories: <span id="cat-list"></span></label>
          <label>From: <input type="date" id="filter-start"></label>
          <label>To: <input type="date" id="filter-end"></label>
          <button id="filter-apply">Apply</button>
          <button id="filter-clear">Clear</button>
        </div>
     `;
     const catList = root.querySelector('#cat-list');
     const start = root.querySelector('#filter-start');
     const end = root.querySelector('#filter-end');
     const apply = root.querySelector('#filter-apply');
     const clear = root.querySelector('#filter-clear');

     // populate categories once events are loaded
     this.onCategoriesRendered = (categories) => {
        catList.innerHTML = '';
        categories.forEach(cat => {
          const id = `cat-${cat.replace(/\s+/g,'-')}`;
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.id = id;
          cb.value = cat;
          cb.addEventListener('change', () => {
             if (cb.checked) this.state.filters.categories.add(cat);
             else this.state.filters.categories.delete(cat);
          });
          const lbl = document.createElement('label');
          lbl.style.marginRight = '8px';
          lbl.appendChild(cb);
          lbl.append(' ' + cat);
          catList.appendChild(lbl);
        });
     };

     apply.addEventListener('click', () => {
        this.state.filters.startDate = start.value || null;
        this.state.filters.endDate = end.value || null;
        this.render();
     });
     clear.addEventListener('click', () => {
        start.value = '';
        end.value = '';
        this.state.filters.categories.clear();
        // uncheck checkboxes if present
        catList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        this.state.filters.startDate = null;
        this.state.filters.endDate = null;
        this.render();
     });
  },

  async fetchAndRender() {
     // determine a range to fetch based on view
     const vd = this.state.viewDate;
     let start, end;
     if (this.state.view === 'month') {
        const s = DateUtils.startOfMonth(vd);
        // fetch slightly extended range to cover weeks starting before the month begins
        start = DateUtils.startOfWeek(s);
        end = DateUtils.endOfMonth(vd);
        // extend to end of week
        end = DateUtils.addDays(end, 6);
     } else if (this.state.view === 'week') {
        start = DateUtils.startOfWeek(vd);
        end = DateUtils.addDays(start, 6);
     } else { // day
        start = new Date(vd.getFullYear(), vd.getMonth(), vd.getDate());
        end = new Date(start);
     }

     const startISO = DateUtils.iso(start);
     const endISO = DateUtils.iso(end);
     const events = await API.fetchEvents(startISO, endISO);
     // normalize event dates into Date objects
     this.state.events = (events || []).map(e => Object.assign({}, e, {
        _startDate: DateUtils.isValidISO(e.start) ? DateUtils.parseISO(e.start) : null,
        _endDate: DateUtils.isValidISO(e.end) ? DateUtils.parseISO(e.end) : (DateUtils.isValidISO(e.start) ? DateUtils.parseISO(e.start) : null)
     }));
     // notify filters about categories
     this.provideCategoriesToFilters();
     this.render();
  },

  provideCategoriesToFilters() {
     const cats = new Set();
     this.state.events.forEach(ev => {
        if (ev.category) cats.add(ev.category);
     });
     if (this.onCategoriesRendered) this.onCategoriesRendered(Array.from(cats));
  },

  changePeriod(delta) {
     if (this.state.view === 'month') {
        this.state.viewDate = DateUtils.addMonths(this.state.viewDate, delta);
     } else if (this.state.view === 'week') {
        this.state.viewDate = DateUtils.addDays(this.state.viewDate, delta * 7);
     } else {
        this.state.viewDate = DateUtils.addDays(this.state.viewDate, delta);
     }
     this.fetchAndRender();
  },

  goToday() {
     this.state.viewDate = new Date();
     this.fetchAndRender();
  },

  onResize() {
     // basic responsive: auto-switch to day/week on narrow viewports
     const w = window.innerWidth;
     if (w < 480 && this.state.view !== 'day') {
        this.controls.viewSelect.value = 'day';
        this.state.view = 'day';
        this.render();
     } else if (w >= 480 && w < 900 && this.state.view === 'month') {
        // keep month but maybe show compressed layout - handled by CSS
     } else if (w >= 900 && this.state.view === 'day') {
        // do not force change back; user controls view
     }
  },

  render() {
     // Render header title
     const vd = this.state.viewDate;
     if (this.state.view === 'month') {
        this.controls.title.textContent = `${vd.toLocaleString(undefined, { month: 'long' })} ${vd.getFullYear()}`;
        this.renderMonth();
     } else if (this.state.view === 'week') {
        const start = DateUtils.startOfWeek(vd);
        const end = DateUtils.addDays(start, 6);
        this.controls.title.textContent = `${DateUtils.formatHuman(start)} — ${DateUtils.formatHuman(end)}`;
        this.renderWeek();
     } else {
        this.controls.title.textContent = `${DateUtils.formatHuman(vd)}`;
        this.renderDay();
     }
  },

  filterEvents(events) {
     // Apply category filter and date range filter
     let out = events.slice();
     const categories = this.state.filters.categories;
     if (categories && categories.size > 0) {
        out = out.filter(ev => categories.has(ev.category));
     }

     if (this.state.filters.startDate && DateUtils.isValidISO(this.state.filters.startDate)) {
        const s = DateUtils.parseISO(this.state.filters.startDate);
        out = out.filter(ev => ev._endDate >= s);
     }
     if (this.state.filters.endDate && DateUtils.isValidISO(this.state.filters.endDate)) {
        const e = DateUtils.parseISO(this.state.filters.endDate);
        out = out.filter(ev => ev._startDate <= e);
     }
     return out;
  },

  renderMonth() {
     // Render a grid of weeks for the month
     const start = DateUtils.startOfWeek(DateUtils.startOfMonth(this.state.viewDate));
     const end = DateUtils.addDays(DateUtils.endOfMonth(this.state.viewDate), 6);
     const days = [];
     for (let d = new Date(start); d <= end; d = DateUtils.addDays(d, 1)) {
        days.push(new Date(d));
     }

     const events = this.filterEvents(this.state.events);

     // build grid markup
     const cols = 7;
     let html = '<div class="cal-weekdays" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">';
     const weekdayNames = [];
     for (let i = 0; i < 7; i++) {
        const dt = DateUtils.addDays(DateUtils.startOfWeek(new Date()), i);
        weekdayNames.push(dt.toLocaleString(undefined, { weekday: 'short' }));
     }
     weekdayNames.forEach((wd) => {
        html += `<div class="cal-weekday" style="font-size:0.85em;text-align:center;font-weight:600;">${wd}</div>`;
     });
     html += '</div>';

     html += `<div class="cal-days" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;margin-top:8px;">`;
     days.forEach(day => {
        const classes = ['cal-day-card'];
        if (day.getMonth() !== this.state.viewDate.getMonth()) classes.push('muted');
        if (DateUtils.sameDay(day, new Date())) classes.push('today');
        const dayEvents = events.filter(ev => DateUtils.withinRange(ev._startDate, day, day) || DateUtils.withinRange(ev._endDate, day, day) || DateUtils.sameDay(ev._startDate, day));
        const evHtml = dayEvents.slice(0, 3).map(ev => `<div class="evt" data-id="${ev.id}" title="${escapeHtml(ev.title)}" style="background:${escapeHtml(colorForCategory(ev.category))};color:#fff;padding:2px 6px;margin:2px 0;border-radius:4px;cursor:pointer;font-size:0.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.title)}</div>`).join('') +
                            (dayEvents.length > 3 ? `<div class="more" style="font-size:0.8em;color:#666;">+${dayEvents.length - 3} more</div>` : '');
        html += `<div class="${classes.join(' ')}" style="min-height:72px;border:1px solid #e6e6e6;padding:6px;border-radius:6px;background:#fff;" data-date="${DateUtils.iso(day)}">
                      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                         <div style="font-weight:600;">${day.getDate()}</div>
                      </div>
                      <div class="events-list" style="margin-top:6px;">${evHtml}</div>
                    </div>`;
     });
     html += '</div>';
     this.grid.innerHTML = html;

     // attach event listeners for event clicks and day clicks
     this.grid.querySelectorAll('.evt').forEach(node => {
        node.addEventListener('click', (e) => {
          const id = node.dataset.id;
          const ev = this.state.events.find(x => String(x.id) === String(id));
          if (ev) UI.openEventModal(ev);
          e.stopPropagation();
        });
     });
     this.grid.querySelectorAll('.cal-day-card').forEach(node => {
        node.addEventListener('click', () => {
          const dateIso = node.dataset.date;
          UI.openDayModal(dateIso, this.getEventsForDate(dateIso));
        });
     });
  },

  renderWeek() {
     const start = DateUtils.startOfWeek(this.state.viewDate);
     const days = [];
     for (let i = 0; i < 7; i++) days.push(DateUtils.addDays(start, i));
     const events = this.filterEvents(this.state.events);

     let html = `<div class="cal-week" style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;">`;
     days.forEach(day => {
        const dayEvents = events.filter(ev => DateUtils.withinRange(ev._startDate, day, day) || DateUtils.withinRange(ev._endDate, day, day) || DateUtils.sameDay(ev._startDate, day));
        html += `<div class="cal-day-col" data-date="${DateUtils.iso(day)}" style="border:1px solid #eee;padding:8px;border-radius:6px;background:#fff;">
          <div style="font-weight:700;margin-bottom:8px;">${day.toLocaleString(undefined,{weekday:'short'})} ${day.getDate()}</div>
          <div class="events-list">` +
             dayEvents.map(ev => `<div class="wk-evt" data-id="${ev.id}" style="margin-bottom:6px;padding:6px;border-radius:6px;background:${escapeHtml(colorForCategory(ev.category))};color:#fff;cursor:pointer;">${escapeHtml(ev.title)} <div style="font-size:0.8em;opacity:0.9">${DateUtils.formatHuman(ev._startDate,{hour:'2-digit',minute:'2-digit'})}</div></div>`).join('') +
          `</div></div>`;
     });
     html += `</div>`;
     this.grid.innerHTML = html;

     this.grid.querySelectorAll('.wk-evt').forEach(node => {
        node.addEventListener('click', (e) => {
          const id = node.dataset.id;
          const ev = this.state.events.find(x => String(x.id) === String(id));
          if (ev) UI.openEventModal(ev);
          e.stopPropagation();
        });
     });
  },

  renderDay() {
     const day = new Date(this.state.viewDate.getFullYear(), this.state.viewDate.getMonth(), this.state.viewDate.getDate());
     const events = this.filterEvents(this.state.events).filter(ev => DateUtils.sameDay(ev._startDate, day) || DateUtils.withinRange(day, ev._startDate, ev._endDate));
     let html = `<div class="cal-day-view" style="display:flex;flex-direction:column;gap:8px;">`;
     html += `<div style="font-weight:700;margin-bottom:8px;">${DateUtils.formatHuman(day, {weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>`;
     if (events.length === 0) html += `<div style="color:#666">No events</div>`;
     events.forEach(ev => {
        html += `<div class="day-evt" data-id="${ev.id}" style="padding:12px;border-radius:8px;border:1px solid #e6e6e6;background:${escapeHtml(colorForCategory(ev.category,'light'))};cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
             <div style="font-weight:700">${escapeHtml(ev.title)}</div>
             <div style="font-size:0.9em;color:#444">${DateUtils.formatHuman(ev._startDate)}${ev._endDate && !DateUtils.sameDay(ev._startDate, ev._endDate) ? ' — ' + DateUtils.formatHuman(ev._endDate) : ''}</div>
          </div>
          <div style="margin-top:8px;color:#333">${escapeHtml(ev.description || '')}</div>
        </div>`;
     });
     html += `</div>`;
     this.grid.innerHTML = html;

     this.grid.querySelectorAll('.day-evt').forEach(node => {
        node.addEventListener('click', (e) => {
          const id = node.dataset.id;
          const ev = this.state.events.find(x => String(x.id) === String(id));
          if (ev) UI.openEventModal(ev);
          e.stopPropagation();
        });
     });
  },

  getEventsForDate(dateIso) {
     if (!DateUtils.isValidISO(dateIso)) return [];
     const d = DateUtils.parseISO(dateIso);
     return this.state.events.filter(ev => DateUtils.sameDay(ev._startDate, d) || DateUtils.withinRange(d, ev._startDate, ev._endDate));
  }
};

/* ===========================
    UI: Modals + Forms
    =========================== */

const UI = {
  openEventModal(event) {
     const starts = event._startDate ? DateUtils.formatHuman(event._startDate, {weekday:'short',month:'short',day:'numeric',year:'numeric'}) : '';
     const ends = event._endDate ? DateUtils.formatHuman(event._endDate, {weekday:'short',month:'short',day:'numeric',year:'numeric'}) : '';
     const contactInfo = event.contact ? `<div style="margin-top:8px;"><strong>Contact:</strong> ${escapeHtml(event.contact.name || '')} ${event.contact.email ? `(<a href="mailto:${escapeHtml(event.contact.email)}">${escapeHtml(event.contact.email)}</a>)` : ''}</div>` : '';
     const html = `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
             <h2 style="margin:0">${escapeHtml(event.title)}</h2>
             <div><button id="modal-close">✕</button></div>
          </div>
          <div style="color:#666;margin-top:6px;">${escapeHtml(event.category || 'Event')} • ${starts}${ends ? ' — ' + ends : ''}</div>
          <hr>
          <div style="margin-top:12px;">${escapeHtml(event.description || 'No description')}</div>
          ${contactInfo}
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
             <button id="open-contact">Contact</button>
             <button id="book-event">Book</button>
          </div>
        </div>
     `;
     Modal.open(html);
     document.getElementById('modal-close').addEventListener('click', () => Modal.close());
     document.getElementById('book-event').addEventListener('click', () => {
        Modal.close();
        UI.openBookingModal(event);
     });
     document.getElementById('open-contact').addEventListener('click', () => {
        Modal.close();
        UI.openContactModal({ subject: `Inquiry: ${event.title}`, eventId: event.id, contact: event.contact });
     });
  },

  openDayModal(dateIso, events) {
     const date = DateUtils.parseISO(dateIso);
     const html = `<div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0">Events on ${DateUtils.formatHuman(date)}</h3>
          <button id="modal-close">✕</button>
        </div>
        <div style="margin-top:8px;">
          ${events.length === 0 ? '<div>No events</div>' : events.map(ev => `<div style="padding:8px;border-bottom:1px solid #eee;cursor:pointer;" data-id="${ev.id}"><strong>${escapeHtml(ev.title)}</strong><div style="font-size:0.9em;color:#666">${escapeHtml(ev.category || '')}</div></div>`).join('')}
        </div>
     </div>`;
     Modal.open(html);
     document.getElementById('modal-close').addEventListener('click', () => Modal.close());
     Modal.root.querySelectorAll('[data-id]').forEach(node => {
        node.addEventListener('click', () => {
          const id = node.dataset.id;
          const ev = Calendar.state.events.find(x => String(x.id) === String(id));
          if (ev) {
             Modal.close();
             UI.openEventModal(ev);
          }
        });
     });
  },

  openBookingModal(event = {}) {
     // Pre-fill date if provided
     const defaultDate = event._startDate ? DateUtils.iso(event._startDate) : '';
     const html = `
        <div>
          <h3 style="margin:0">Book: ${escapeHtml(event.title || '')}</h3>
          <button id="modal-close" style="float:right">✕</button>
          <form id="booking-form" style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
             <input name="eventId" type="hidden" value="${escapeHtml(String(event.id || ''))}">
             <label>Name <input name="name" type="text" required></label>
             <label>Email <input name="email" type="email" required></label>
             <label>Date <input name="date" type="date" required value="${escapeHtml(defaultDate)}"></label>
             <label>Guests <input name="guests" type="number" min="1" value="1"></label>
             <label>Notes <textarea name="notes"></textarea></label>
             <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button type="button" id="booking-cancel">Cancel</button>
                <button type="submit">Submit Booking</button>
             </div>
          </form>
        </div>
     `;
     Modal.open(html);
     document.getElementById('modal-close').addEventListener('click', () => Modal.close());
     document.getElementById('booking-cancel').addEventListener('click', () => Modal.close());
     document.getElementById('booking-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const payload = {
          eventId: form.eventId.value || null,
          name: form.name.value.trim(),
          email: form.email.value.trim(),
          date: form.date.value,
          guests: Number(form.guests.value) || 1,
          notes: form.notes.value.trim()
        };
        // Validation
        if (!payload.name || !payload.email || !DateUtils.isValidISO(payload.date)) {
          alert('Please fill required fields with a valid date.');
          return;
        }
        try {
          await API.submitBooking(payload);
          Modal.close();
          alert('Booking submitted successfully.');
        } catch (err) {
          alert('Booking failed: ' + (err.message || err));
        }
     });
  },

  openContactModal({ subject = '', eventId = null, contact = null } = {}) {
     const contactEmail = contact && contact.email ? contact.email : '';
     const html = `
        <div>
          <h3 style="margin:0">Contact</h3>
          <button id="modal-close" style="float:right">✕</button>
          <form id="contact-form" style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
             <input name="eventId" type="hidden" value="${escapeHtml(String(eventId || ''))}">
             <label>Name <input name="name" type="text" required></label>
             <label>Email <input name="email" type="email" required></label>
             <label>To <input name="to" type="email" value="${escapeHtml(contactEmail)}"></label>
             <label>Subject <input name="subject" type="text" value="${escapeHtml(subject)}"></label>
             <label>Message <textarea name="message" required></textarea></label>
             <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button type="button" id="contact-cancel">Cancel</button>
                <button type="submit">Send</button>
             </div>
          </form>
        </div>
     `;
     Modal.open(html);
     document.getElementById('modal-close').addEventListener('click', () => Modal.close());
     document.getElementById('contact-cancel').addEventListener('click', () => Modal.close());
     document.getElementById('contact-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const payload = {
          eventId: form.eventId.value || null,
          name: form.name.value.trim(),
          fromEmail: form.email.value.trim(),
          toEmail: form.to.value.trim(),
          subject: form.subject.value.trim(),
          message: form.message.value.trim()
        };
        if (!payload.name || !payload.fromEmail || !payload.message) {
          alert('Please fill required fields.');
          return;
        }
        try {
          await API.sendContact(payload);
          Modal.close();
          alert('Message sent.');
        } catch (err) {
          alert('Contact failed: ' + (err.message || err));
        }
     });
  }
};

/* ===========================
    Helpers
    =========================== */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function colorForCategory(category = '', mode = 'normal') {
  // Basic deterministic color generator for categories
  const colors = [
     '#1abc9c', '#3498db', '#9b59b6', '#e67e22', '#e74c3c',
     '#2ecc71', '#f1c40f', '#7f8c8d'
  ];
  if (!category) return mode === 'light' ? '#f8f8f8' : '#3498db';
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = category.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % colors.length;
  if (mode === 'light') {
     // lighten color
     return lightenColor(colors[idx], 0.85);
  }
  return colors[idx];
}

function lightenColor(hex, ratio) {
  // hex '#rrggbb', ratio 0..1 closer to 1 = lighter
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * ratio);
  const lg = Math.round(g + (255 - g) * ratio);
  const lb = Math.round(b + (255 - b) * ratio);
  return `rgb(${lr},${lg},${lb})`;
}

/* ===========================
    Boot
    =========================== */

document.addEventListener('DOMContentLoaded', () => {
  Modal.init();
  Calendar.init();
  UI; // no-op reference
});