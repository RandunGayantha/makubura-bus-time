/* Makumbura Live Board */
(() => {
    'use strict';

    const DATA = window.MAKUMBURA;
    if (!DATA) { console.error('schedule.js did not load'); return; }

    const $ = (id) => document.getElementById(id);
    const DAY = 1440;

    /* ---------- helpers ---------- */
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // "05.40am" / "13.05pm" -> minutes since midnight
    function parseTime(str) {
        const m = /^\s*(\d{1,2})[.:](\d{2})\s*(am|pm)\s*$/i.exec(str);
        if (!m) throw new Error('Bad time: ' + str);
        let h = +m[1];
        const min = +m[2], pm = m[3].toLowerCase() === 'pm';
        if (pm && h < 12) h += 12;
        if (!pm && h === 12) h = 0;
        return h * 60 + min;
    }

    const pad = (n) => String(n).padStart(2, '0');

    function fmt(mins) {
        const m = ((mins % DAY) + DAY) % DAY;
        const h24 = Math.floor(m / 60), mm = m % 60;
        const h12 = h24 % 12 || 12;
        return `${pad(h12)}:${pad(mm)}<small>${h24 < 12 ? 'AM' : 'PM'}</small>`;
    }
    const fmtPlain = (mins) => fmt(mins).replace('<small>', ' ').replace('</small>', '');

    function plural(h, m, suffix) {
        if (h && m) return `පැය ${h} විනාඩි ${m}${suffix}`;
        if (h) return `පැය ${h}${suffix}`;
        return `විනාඩි ${m}${suffix}`;
    }
    const relIn = (d) => d <= 0 ? 'දැන්' : plural(Math.floor(d / 60), d % 60, 'කින්');
    const relAgo = (d) => d <= 0 ? 'මේ දැන්' : d >= 60 ? `පැය ${Math.floor(d / 60)}කට පෙර` : `විනාඩි ${d}කට පෙර`;

    function countdown(totalSecs) {
        const s = Math.max(0, totalSecs);
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
    }

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    };

    /* ---------- Sri Lanka clock ---------- */
    const clockFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    const dateParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Colombo', weekday: 'short', day: 'numeric', month: 'numeric'
    });
    const WEEKDAYS = { Sun: 'ඉරිදා', Mon: 'සඳුදා', Tue: 'අඟහරුවාදා', Wed: 'බදාදා', Thu: 'බ්‍රහස්පතින්දා', Fri: 'සිකුරාදා', Sat: 'සෙනසුරාදා' };
    const MONTHS = ['ජනවාරි', 'පෙබරවාරි', 'මාර්තු', 'අප්‍රේල්', 'මැයි', 'ජූනි', 'ජූලි', 'අගෝස්තු', 'සැප්තැම්බර්', 'ඔක්තෝබර්', 'නොවැම්බර්', 'දෙසැම්බර්'];
    const sinhalaDate = (d) => {
        const p = {};
        dateParts.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
        return `${WEEKDAYS[p.weekday] || ''} · ${MONTHS[+p.month - 1]} ${p.day}`;
    };

    function colomboNow() {
        const d = new Date();
        const p = {};
        clockFmt.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
        const secs = (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second);
        return { d, secs, min: Math.floor(secs / 60), h: +p.hour, m: +p.minute, s: +p.second };
    }

    /* ---------- data ---------- */
    const colomboSet = new Set(DATA.colomboOrigin || []);
    const catById = Object.fromEntries(DATA.categories.map((c) => [c.id, c]));

    function clean(str) {
        let s = str.replace(/[​‌ ]/g, ' ').replace(/\s+/g, ' ').trim();
        (DATA.normalize || []).forEach(([from, to]) => { s = s.split(from).join(to); });
        return s;
    }

    const allBuses = [];
    DATA.categories.forEach((cat) => {
        cat.raw.split('\n').forEach((line, i) => {
            line = line.trim();
            if (!line) return;
            const parts = line.split(/\s+-\s+/);
            try {
                if (parts.length < 3) throw new Error('expected "time - destination - interchange"');
                allBuses.push({
                    cat: cat.id,
                    mins: parseTime(parts[0]),
                    destination: clean(parts[1]),
                    interchange: clean(parts.slice(2).join(' - ')),
                    colombo: colomboSet.has(clean(parts[1]))
                });
            } catch (err) {
                console.warn(`schedule.js [${cat.id}] line ${i}: ${err.message} →`, line);
            }
        });
    });
    allBuses.sort((a, b) => a.mins - b.mins || a.cat.localeCompare(b.cat));

    const frequent = DATA.frequent.map((f) => {
        const start = parseTime(f.start), end = parseTime(f.end);
        return { ...f, startM: start, endM: end, lastDep: start + Math.floor((end - start) / f.interval) * f.interval };
    });

    /* ---------- scope (category filter) + slots ---------- */
    let scope = store.get('mk-scope');
    if (scope !== 'all' && !catById[scope]) scope = 'all';

    const scoped = () => scope === 'all' ? allBuses : allBuses.filter((b) => b.cat === scope);

    function makeSlots(list) {
        const slots = [];
        list.forEach((b) => {
            const last = slots[slots.length - 1];
            if (last && last.mins === b.mins) last.buses.push(b);
            else slots.push({ mins: b.mins, buses: [b] });
        });
        return slots;
    }

    /* ---------- icons ---------- */
    const ICON_PIN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>';

    /* ---------- shared fragments ---------- */
    function tags(b) {
        let t = '';
        if (scope === 'all') t += `<span class="tag tag-${b.cat}">${esc(catById[b.cat].si)}</span>`;
        if (b.colombo) t += '<span class="tag tag-col" title="කොළඹින් ආරම්භ වන බස් රථය — ආසන සම්පූර්ණ වූ විට මාකුඹුරට නොපැමිණේ">කොළඹින්</span>';
        return t;
    }

    function busRow(b, rel, opts = {}) {
        return `
            <li class="row ${opts.cls || ''}">
                <div class="row-time">${fmt(b.mins)}</div>
                <div class="row-body">
                    <div class="row-dest">${esc(b.destination)}${tags(b)}</div>
                    <div class="row-sub">${ICON_PIN}${esc(b.interchange)}</div>
                </div>
                ${rel ? `<span class="pill ${opts.pill || ''}">${esc(rel)}</span>` : ''}
            </li>`;
    }

    /* ---------- render: live ---------- */
    let lastKey = '';
    let heroTomorrow = false;
    let heroSlotMins = 0;

    function renderLive(now) {
        const list = scoped();
        const slots = makeSlots(list);
        if (!slots.length) return;

        let idx = slots.findIndex((s) => s.mins >= now.min);
        const tomorrow = idx === -1;
        if (tomorrow) idx = 0;
        const slot = slots[idx];

        heroTomorrow = tomorrow;
        heroSlotMins = slot.mins;
        const diffMins = slot.mins + (tomorrow ? DAY : 0) - now.min;
        const departingNow = !tomorrow && diffMins === 0;

        const status = departingNow
            ? '<span class="status status-now"><i></i>දැන් පිටත් වේ · Departing now</span>'
            : tomorrow
                ? '<span class="status status-info">අද කාලසටහන අවසන් · හෙට පළමු බස් රථය</span>'
                : diffMins <= 10
                    ? '<span class="status status-soon"><i></i>ඉක්මනින් පිටත් වේ · Boarding soon</span>'
                    : '<span class="status status-next">ඊළඟ පිටත්වීම · Next departure</span>';

        const dense = slot.buses.length > 3;
        const heroBuses = slot.buses.map((b) => `
            <li class="hero-bus">
                <div class="hero-dest">${esc(b.destination)}${tags(b)}</div>
                <div class="hero-sub">${ICON_PIN}${esc(b.interchange)}</div>
            </li>`).join('');

        const hero = $('hero');
        hero.classList.remove('skeleton');
        hero.classList.toggle('is-now', departingNow);
        hero.innerHTML = `
            <div class="hero-main">
                ${status}
                <div class="hero-time">${fmt(slot.mins)}${tomorrow ? '<span class="tomorrow">හෙට</span>' : ''}</div>
                <div class="hero-count">
                    <span class="hero-count-label">${departingNow ? '' : 'පිටත් වීමට ඇති කාලය'}</span>
                    <strong id="hero-count">--:--</strong>
                </div>
                <div class="meter" aria-hidden="true"><div class="meter-fill" id="meter"></div></div>
            </div>
            <div class="hero-side">
                <div class="hero-side-title">${slot.buses.length > 1 ? `මෙම වේලාවේ බස් රථ ${slot.buses.length}ක්` : 'ගමනාන්තය'}</div>
                <ul class="hero-buses ${dense ? 'dense' : ''}">${heroBuses}</ul>
            </div>`;

        // upcoming: next 7 buses after this slot (wraps into tomorrow)
        const up = [];
        let si = idx, tom = tomorrow, guard = 0;
        while (up.length < 7 && guard++ < slots.length * 2) {
            si++;
            if (si >= slots.length) { si = 0; tom = true; }
            slots[si].buses.forEach((b) => up.push({ b, tom }));
        }
        $('upcoming').innerHTML = up.slice(0, 7).map(({ b, tom: t }) =>
            busRow(b, t ? 'හෙට' : relIn(b.mins - now.min), { pill: t ? 'pill-muted' : '' })).join('');

        // departed: most recent first, today only
        const gone = list.filter((b) => b.mins < now.min).slice(-5).reverse();
        $('departed').innerHTML = gone.length
            ? gone.map((b) => busRow(b, relAgo(now.min - b.mins), { pill: 'pill-muted' })).join('')
            : '<li class="empty">අද තවමත් බස් රථ පිටත් වී නැත<br><small>No departures yet today</small></li>';

        renderFrequent(now);
    }

    function tickCountdown(now) {
        const el = $('hero-count');
        if (!el) return;
        const target = heroSlotMins * 60 + (heroTomorrow ? DAY * 60 : 0) - now.secs;
        const inWindow = !heroTomorrow && now.min === heroSlotMins;
        el.textContent = inWindow ? 'දැන්' : countdown(target);
        const frac = inWindow ? 1 : 1 - Math.min(Math.max(target, 0), 3600) / 3600;
        $('meter').style.transform = `scaleX(${frac.toFixed(4)})`;
    }

    /* ---------- render: frequent ---------- */
    function renderFrequent(now) {
        $('frequent').innerHTML = frequent.map((f) => {
            const inService = now.min >= f.startM && now.min <= f.lastDep;
            let body;

            if (inService) {
                const next = f.startM + Math.ceil((now.min - f.startM) / f.interval) * f.interval;
                const d = next - now.min;
                const frac = d === 0 ? 1 : 1 - (next * 60 - now.secs) / (f.interval * 60);
                body = `
                    <div class="freq-next">
                        <span class="freq-next-label">ඊළඟ බස් රථය</span>
                        <span class="freq-next-time">${fmt(next)}</span>
                        <span class="pill ${d <= 5 ? 'pill-hot' : ''}">${relIn(d)}</span>
                    </div>
                    <div class="meter meter-sm" aria-hidden="true"><div class="meter-fill" style="transform:scaleX(${Math.min(Math.max(frac, 0), 1).toFixed(3)})"></div></div>`;
            } else {
                const tomorrow = now.min > f.lastDep;
                const d = f.startM + (tomorrow ? DAY : 0) - now.min;
                body = `
                    <div class="freq-next">
                        <span class="freq-next-label">${tomorrow ? 'හෙට ආරම්භය' : 'ආරම්භය'}</span>
                        <span class="freq-next-time">${fmt(f.startM)}</span>
                        <span class="pill pill-muted">${tomorrow ? 'හෙට' : relIn(d)}</span>
                    </div>`;
            }

            return `
                <article class="freq ${inService ? 'is-running' : ''}">
                    <header>
                        <div><h3>${esc(f.si)}</h3><p>${esc(f.en)}</p></div>
                        <span class="badge ${inService ? 'badge-on' : ''}">${inService ? 'ධාවනය වේ' : 'සේවයෙන් පිට'}</span>
                    </header>
                    ${body}
                    <footer>
                        <span>සෑම විනාඩි ${f.interval}කට වරක්</span>
                        <span>${fmtPlain(f.startM)} – ${fmtPlain(f.endM)}</span>
                        ${f.note ? `<span class="freq-note">${esc(f.note)}</span>` : ''}
                    </footer>
                </article>`;
        }).join('');
    }

    function renderNotices() {
        $('notices').innerHTML = (DATA.notices || []).map((n) => `
            <article class="notice">
                <span class="notice-icon" aria-hidden="true">${esc(n.icon || 'i')}</span>
                <div><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p></div>
            </article>`).join('');
    }

    /* ---------- render: timetable ---------- */
    let selected = 'all';
    let query = '';

    function renderScope() {
        const make = (id, si, en, count) => `
            <button type="button" role="radio" aria-checked="${scope === id}" class="seg ${scope === id ? 'active' : ''}" data-scope="${id}">
                <b>${esc(si)}</b><span>${esc(en)} · ${count}</span>
            </button>`;
        $('scope').innerHTML = make('all', 'සියල්ල', 'All', allBuses.length) +
            DATA.categories.map((c) => make(c.id, c.si, c.en, allBuses.filter((b) => b.cat === c.id).length)).join('');
    }

    function destinationsOf(list) {
        return [...new Set(list.map((b) => b.destination))].sort((a, b) => a.localeCompare(b, 'si'));
    }

    function renderChips() {
        const list = scoped();
        const dests = destinationsOf(list);
        if (selected !== 'all' && !dests.includes(selected)) selected = 'all';
        const make = (value, label, count) => `
            <button type="button" role="radio" aria-checked="${selected === value}" class="chip ${selected === value ? 'active' : ''}" data-dest="${esc(value)}">
                ${esc(label)}<span>${count}</span>
            </button>`;
        $('chips').innerHTML = make('all', 'සියල්ල · All', list.length) +
            dests.map((d) => make(d, d, list.filter((b) => b.destination === d).length)).join('');
    }

    function renderTimetable(now) {
        const base = scoped();
        const nextSlot = makeSlots(base).find((s) => s.mins >= now.min);
        const nextMins = nextSlot ? nextSlot.mins : -1;
        const q = query.trim();

        let list = base;
        if (selected !== 'all') list = list.filter((b) => b.destination === selected);
        if (q) list = list.filter((b) => b.destination.includes(q) || b.interchange.includes(q));

        if (!list.length) {
            $('tt').innerHTML = '<div class="card empty">ගැළපෙන බස් රථ නැත<br><small>No matching departures</small></div>';
            return;
        }

        // Single destination -> time tiles
        if (selected !== 'all' && !q) {
            const nxt = list.find((b) => b.mins >= now.min);
            const interchanges = [...new Set(list.map((b) => b.interchange))];
            $('tt').innerHTML = `
                <section class="card">
                    <header class="route-head">
                        <div>
                            <h2 class="route-name">${esc(selected)}${tags(list[0])}</h2>
                            <p class="route-sub">${ICON_PIN}${esc(interchanges.join(' · '))} · බස් රථ ${list.length}ක්</p>
                        </div>
                        <div class="route-next">
                            ${nxt
                                ? `<span>ඊළඟ බස් රථය</span><strong>${fmt(nxt.mins)}</strong><em>${relIn(nxt.mins - now.min)}</em>`
                                : `<span>අද බස් රථ අවසන්</span><strong>${fmt(list[0].mins)}</strong><em>හෙට පළමු බස්</em>`}
                        </div>
                    </header>
                    <div class="time-grid">
                        ${list.map((b) => {
                            const cls = b.mins < now.min ? 'is-past' : b === nxt ? 'is-next' : '';
                            return `<div class="time-tile ${cls}">${fmt(b.mins)}</div>`;
                        }).join('')}
                    </div>
                </section>`;
            return;
        }

        // Otherwise grouped by hour
        const groups = new Map();
        list.forEach((b) => {
            const h = Math.floor(b.mins / 60);
            if (!groups.has(h)) groups.set(h, []);
            groups.get(h).push(b);
        });
        $('tt').innerHTML = [...groups].map(([h, items]) => {
            const label = `${pad(h % 12 || 12)}:00 ${h < 12 ? 'AM' : 'PM'}`;
            return `
                <section class="card tt-group">
                    <header class="card-head"><h2>${label}<em>බස් රථ ${items.length}</em></h2></header>
                    <ol class="rows">
                        ${items.map((b) => {
                            const isNext = b.mins === nextMins;
                            return busRow(b, isNext ? 'ඊළඟ' : '', {
                                cls: b.mins < now.min ? 'is-past' : isNext ? 'is-next' : '', pill: 'pill-hot'
                            });
                        }).join('')}
                    </ol>
                </section>`;
        }).join('');
    }

    /* ---------- tick ---------- */
    let ttDirty = true;
    function tick() {
        const now = colomboNow();

        $('clock').textContent = `${pad(now.h % 12 || 12)}:${pad(now.m)}:${pad(now.s)}`;
        $('clock-ampm').textContent = now.h < 12 ? 'AM' : 'PM';
        const dateEl = $('clock-date');
        if (now.s === 0 || dateEl.dataset.set !== '1') {
            dateEl.textContent = sinhalaDate(now.d);
            dateEl.dataset.set = '1';
        }

        const key = now.min + '|' + scope;
        if (key !== lastKey) {
            lastKey = key;
            renderLive(now);
            ttDirty = true;
        }
        if (ttDirty && !$('panel-timetable').hidden) {
            renderTimetable(now);
            ttDirty = false;
        }
        tickCountdown(now);
    }

    /* ---------- interactions ---------- */
    function showTab(name, focus) {
        document.querySelectorAll('.tab').forEach((t) => {
            const on = t.dataset.tab === name;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on);
            t.tabIndex = on ? 0 : -1;
            if (on && focus) t.focus();
        });
        document.querySelectorAll('.panel').forEach((p) => {
            const on = p.id === 'panel-' + name;
            p.hidden = !on;
            p.classList.toggle('active', on);
        });
        ttDirty = true;
        tick();
        try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
        window.scrollTo({ top: 0 });
    }

    document.querySelector('.tabs').addEventListener('click', (e) => {
        const t = e.target.closest('.tab');
        if (t) showTab(t.dataset.tab);
    });
    document.querySelector('.tabs').addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const tabs = [...document.querySelectorAll('.tab')];
        const i = tabs.findIndex((t) => t.classList.contains('active'));
        const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        showTab(tabs[n].dataset.tab, true);
    });

    $('scope').addEventListener('click', (e) => {
        const s = e.target.closest('.seg');
        if (!s) return;
        scope = s.dataset.scope;
        store.set('mk-scope', scope);
        selected = 'all';
        renderScope();
        renderChips();
        lastKey = '';
        tick();
    });

    $('chips').addEventListener('click', (e) => {
        const c = e.target.closest('.chip');
        if (!c) return;
        selected = c.dataset.dest;
        query = ''; $('q').value = '';
        renderChips();
        ttDirty = true;
        tick();
    });

    $('q').addEventListener('input', (e) => {
        query = e.target.value;
        if (query.trim()) { selected = 'all'; renderChips(); }
        ttDirty = true;
        tick();
    });

    $('jump').addEventListener('click', () => {
        const el = document.querySelector('#tt .is-next');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    $('theme-toggle').addEventListener('click', () => {
        const root = document.documentElement;
        const dark = root.dataset.theme
            ? root.dataset.theme === 'dark'
            : matchMedia('(prefers-color-scheme: dark)').matches;
        const next = dark ? 'light' : 'dark';
        root.dataset.theme = next;
        store.set('mk-theme', next);
        document.querySelector('meta[name="theme-color"]').content = next === 'dark' ? '#06120d' : '#0b3d2e';
    });

    /* ---------- boot ---------- */
    renderScope();
    renderChips();
    renderNotices();
    tick();
    if (location.hash === '#timetable') showTab('timetable');
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
})();
