// Shared UI atoms for Coursework
const { useState, useEffect, useMemo, useRef } = React;

// ---------- helpers ----------
function fmtDate(iso, opts = {}) {
  const d = new Date(iso);
  const m = d.getMonth() + 1, day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  if (opts.dateOnly) return `${m}/${day}`;
  return `${m}/${day} ${h}:${min}`;
}
function fmtWeekday(iso) {
  return ['日','一','二','三','四','五','六'][new Date(iso).getDay()];
}
function diffMs(iso) { return new Date(iso) - new Date(); }
function fmtCountdown(ms) {
  if (ms <= 0) return { label: '已截止', d: 0, h: 0, m: 0, s: 0, past: true };
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { label: '剩餘', d, h, m, s, past: false };
}
function useTick(intervalMs = 1000) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(x => x + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
window.cwFmt = { fmtDate, fmtWeekday, diffMs, fmtCountdown };
window.cwUseTick = useTick;

// ---------- UI atoms ----------
function StatusPill({ status, type = 'assignment' }) {
  const map = {
    assignment: {
      not_started: { label: '未開始', cls: 'bg-muted text-muted-foreground' },
      in_progress: { label: '進行中', cls: 'border', style: { background: 'color-mix(in oklab, var(--primary) 12%, transparent)', color: 'var(--primary)', borderColor: 'color-mix(in oklab, var(--primary) 28%, transparent)' } },
      submitted:   { label: '已交卷', cls: 'verdict-pending' },
      graded:      { label: '已批改', cls: 'verdict-ac' },
    },
    exam: {
      scheduled:   { label: '尚未開始', cls: 'bg-muted text-muted-foreground' },
      open:        { label: '已開放', cls: '', style: { background: 'color-mix(in oklab, var(--primary) 14%, transparent)', color: 'var(--primary)' } },
      in_progress: { label: '應試中', cls: '', style: { background: 'color-mix(in oklab, var(--destructive) 14%, transparent)', color: 'oklch(0.55 0.2 27)' } },
      submitted:   { label: '已交卷', cls: 'verdict-pending' },
      graded:      { label: '已批改', cls: 'verdict-ac' },
    },
    contest: {
      upcoming: { label: '即將開始', cls: 'bg-muted text-muted-foreground' },
      live:     { label: 'LIVE', cls: '', style: { background: 'color-mix(in oklab, var(--destructive) 14%, transparent)', color: 'oklch(0.55 0.2 27)' } },
      ended:    { label: '已結束', cls: 'bg-muted text-muted-foreground' },
    },
  };
  const def = map[type][status] || { label: status, cls: 'bg-muted text-muted-foreground' };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-mono uppercase tracking-wider ${def.cls}`}
      style={def.style}
    >
      {status === 'live' && <span className="size-1.5 rounded-full live-dot"></span>}
      {def.label}
    </span>
  );
}

function ProgressRing({ value, size = 56, stroke = 6, label }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const off = C - (value / 100) * C;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--primary)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${C} ${C}`} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset 480ms var(--ease-out-soft)' }} />
      </svg>
      <span className="absolute font-mono text-caption font-semibold">{label ?? `${Math.round(value)}%`}</span>
    </div>
  );
}

function Countdown({ iso, compact = false }) {
  useTick(1000);
  const ms = diffMs(iso);
  const c = fmtCountdown(ms);
  if (compact) {
    return (
      <span className="font-mono tabular-nums">
        {c.past ? '已截止' : (c.d > 0 ? `${c.d}d ${String(c.h).padStart(2,'0')}h` : `${String(c.h).padStart(2,'0')}:${String(c.m).padStart(2,'0')}:${String(c.s).padStart(2,'0')}`)}
      </span>
    );
  }
  return (
    <div className="inline-flex items-baseline gap-1 font-mono tabular-nums">
      {c.past ? <span className="text-muted-foreground">已截止</span> : (
        <>
          {c.d > 0 && <><span className="text-title font-bold">{c.d}</span><span className="text-caption text-muted-foreground mr-1">d</span></>}
          <span className="text-title font-bold">{String(c.h).padStart(2,'0')}</span>
          <span className="text-caption text-muted-foreground">h</span>
          <span className="text-title font-bold">{String(c.m).padStart(2,'0')}</span>
          <span className="text-caption text-muted-foreground">m</span>
          {c.d === 0 && <>
            <span className="text-title font-bold">{String(c.s).padStart(2,'0')}</span>
            <span className="text-caption text-muted-foreground">s</span>
          </>}
        </>
      )}
    </div>
  );
}

function DifficultyTick({ level }) {
  const map = { Easy: 1, Medium: 2, Hard: 3 };
  const n = map[level] || 1;
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1,2,3].map(i => (
        <span key={i} className="block w-1 rounded-sm" style={{
          height: i === 1 ? 6 : i === 2 ? 9 : 12,
          background: i <= n ? (n === 1 ? 'var(--chart-5)' : n === 2 ? 'var(--chart-4)' : 'var(--destructive)') : 'var(--border-strong)',
          opacity: i <= n ? 1 : 0.35,
        }}></span>
      ))}
      <span className="ml-1.5 text-micro font-mono uppercase tracking-wider text-muted-foreground">{level}</span>
    </span>
  );
}

// Subtle dotted-grid backdrop used by various heroes
function DotGrid({ className = '', opacity = 0.25 }) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`} style={{
      backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
      backgroundSize: '14px 14px',
      color: 'var(--border-strong)',
      opacity,
      maskImage: 'radial-gradient(120% 60% at 50% 0%, black 30%, transparent 80%)',
      WebkitMaskImage: 'radial-gradient(120% 60% at 50% 0%, black 30%, transparent 80%)',
    }}></div>
  );
}

// Page-type identity icon — same family, distinct silhouettes
function TypeIcon({ kind, size = 18, strokeWidth = 1.6 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'assignment') return (
    <svg {...common}><path d="M7 4h8l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M15 4v4h4"/><path d="M9 13l2 2 4-4"/></svg>
  );
  if (kind === 'exam') return (
    <svg {...common}><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 8h2M18 8h2M4 16h2M18 16h2"/><path d="M8 12h8"/><path d="M12 9v6"/></svg>
  );
  if (kind === 'contest') return (
    <svg {...common}><path d="M8 4h8v3a4 4 0 0 1-8 0V4z"/><path d="M16 5h3v2a3 3 0 0 1-3 3M8 5H5v2a3 3 0 0 0 3 3"/><path d="M10 11v4M14 11v4"/><path d="M8 20h8M9 20l1-3h4l1 3"/></svg>
  );
  return null;
}

function GlassPanel({ children, className = '', style }) {
  return <div className={`glass rounded-2xl shadow-rest ${className}`} style={style}>{children}</div>;
}

// Tab strip used in detail headers
function TabStrip({ tabs, active, onChange }) {
  return (
    <div className="inline-flex rounded-full p-1 text-caption font-medium" style={{ background: 'var(--panel-strong)', border: '1px solid var(--border-subtle)' }}>
      {tabs.map(t => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)}
          className={`rounded-full px-3 py-1.5 transition-colors ${active === t.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// "Breadcrumb" – also routes
function Crumbs({ items, onNavigate }) {
  return (
    <nav className="flex items-center gap-1.5 text-caption text-muted-foreground font-mono">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="opacity-60">/</span>}
          {it.href ? (
            <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(it.href); }}
              className="hover:text-foreground transition-colors">{it.label}</a>
          ) : <span className="text-foreground">{it.label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

Object.assign(window, { StatusPill, ProgressRing, Countdown, DifficultyTick, DotGrid, TypeIcon, GlassPanel, TabStrip, Crumbs });
