// Shell: header, route container, PageHero used by list views
const { useState: useStateS, useEffect: useEffectS } = React;

// ---------- Role context (student / TA / teacher) ----------
const CWRoleCtx = React.createContext({ role: 'student', setRole: () => {} });
window.CWRoleCtx = CWRoleCtx;
function useRole() { return React.useContext(CWRoleCtx); }
window.useCWRole = useRole;

// ---------- Hash router ----------
function useHashRoute() {
  const [hash, setHash] = useStateS(() => window.location.hash || '#/assignment');
  useEffectS(() => {
    const onChange = () => setHash(window.location.hash || '#/assignment');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const goTo = (h) => { window.location.hash = h.startsWith('#') ? h.slice(1) : h; };
  return { hash, goTo };
}

function parseRoute(hash) {
  // hash like "#/exam/midterm/take"
  const clean = hash.replace(/^#\/?/, '');
  const parts = clean.split('/').filter(Boolean);
  return parts; // e.g. ['exam','midterm','take']
}

// ---------- PageHero used by list views ----------
function PageHero({ kind, eyebrow, title, titleEn, description, meta = [], accentStripe }) {
  return (
    <div className="relative overflow-hidden glass rounded-2xl shadow-rest p-7 lg:p-9">
      {/* Identity texture per kind */}
      {kind === 'assignment' && <DotGrid opacity={0.16} />}
      {kind === 'exam' && (
        <>
          <DotGrid opacity={0.12} />
          <CornerMark pos="tl" /><CornerMark pos="tr" /><CornerMark pos="bl" /><CornerMark pos="br" />
        </>
      )}
      {kind === 'contest' && (
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{
          background: `repeating-linear-gradient(135deg, var(--foreground) 0 1px, transparent 1px 22px)`,
        }}></div>
      )}
      {accentStripe && (
        <div className="pointer-events-none absolute top-0 left-0 h-full w-1.5" style={{ background: 'var(--primary)' }}></div>
      )}

      <div className="relative">
        <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground">
          <TypeIcon kind={kind} size={14} />
          <span>{eyebrow}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 justify-between">
          <div className="min-w-0">
            <h1 className="font-display font-semibold tracking-tight" style={{ fontSize: 'clamp(2.25rem, 4.6vw, 3.5rem)', lineHeight: 1.05 }}>{title}</h1>
            <p className="mt-1 font-mono text-caption uppercase tracking-[0.18em] text-muted-foreground">{titleEn}</p>
          </div>
          {meta.length > 0 && (
            <div className="flex gap-7 lg:gap-10">
              {meta.map((m, i) => (
                <div key={i}>
                  <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">{m.k}</div>
                  <div className="mt-1 font-display text-title font-semibold tabular-nums">{m.v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="mt-4 max-w-2xl text-body text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

// ---------- Header (sticky, matches Dashboard chrome) ----------
function AppHeader({ hash, goTo, theme, setTheme, role, setRole }) {
  const segs = parseRoute(hash);
  const root = segs[0] || 'assignment';
  const isTake = segs[2] === 'take';
  if (isTake) return null; // take view is full-bleed

  return (
    <header className="glass sticky top-6 z-20 rounded-2xl px-5 py-3 shadow-rest fade-up" style={{ borderRadius: '2rem' }}>
      <div className="flex flex-wrap items-center gap-6">
        <a href="Dashboard.html" className="font-display text-title-sm font-bold tracking-tight hover:text-primary transition-colors">NOJV</a>
        <span className="hidden sm:block h-5 w-px" style={{ background: 'var(--border-strong)' }}></span>

        <nav className="flex flex-wrap items-center gap-1 text-body-sm font-medium">
          <a className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors" href="Dashboard.html">Dashboard</a>
          <a className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors" href="#">Problems</a>
          <NavItem label="Assignment" active={root === 'assignment'} kind="assignment" onClick={() => goTo('#/assignment')} />
          <NavItem label="Exam" active={root === 'exam'} kind="exam" onClick={() => goTo('#/exam')} />
          <NavItem label="Contest" active={root === 'contest'} kind="contest" onClick={() => goTo('#/contest')} />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Role switcher */}
          <div className="hidden md:flex items-center gap-0.5 rounded-full p-1 text-caption" style={{ background: 'var(--panel-strong)', border: '1px solid var(--border-subtle)' }} title="切換檢視角色">
            {[
              { v: 'student', label: '學生', icon: '🎓' },
              { v: 'ta',      label: '助教', icon: '📘' },
              { v: 'teacher', label: '老師', icon: '🏫' },
            ].map(opt => (
              <button key={opt.v} type="button" onClick={() => setRole(opt.v)}
                className={`rounded-full px-2.5 py-1 inline-flex items-center gap-1 transition-colors ${role === opt.v ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                style={role === opt.v ? { background: 'var(--primary)' } : {}}>
                <span aria-hidden="true" style={{fontSize:'10px'}}>{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-1 rounded-full p-1 text-caption" style={{ background: 'var(--panel-strong)', border: '1px solid var(--border-subtle)' }}>
            <button type="button" className="rounded-full px-2.5 py-1 bg-primary text-primary-foreground">中</button>
            <button type="button" className="rounded-full px-2.5 py-1 text-muted-foreground hover:text-foreground transition-colors">EN</button>
          </div>
          <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="rounded-full size-9 grid place-items-center text-muted-foreground hover:text-foreground transition-colors" style={{ background: 'var(--panel-strong)', border: '1px solid var(--border-subtle)' }}>
            {theme === 'dark'
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            }
          </button>
          <div className="size-9 rounded-full grid place-items-center font-display font-semibold text-body-sm text-primary-foreground" style={{ background: 'var(--primary)' }}>H</div>
        </div>
      </div>
    </header>
  );
}

function NavItem({ label, active, kind, onClick }) {
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); onClick(); }}
      className={`rounded-md px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      style={active ? { background: 'color-mix(in oklab, var(--accent) 60%, transparent)' } : {}}>
      <TypeIcon kind={kind} size={14} />
      {label}
    </a>
  );
}

// ---------- App ----------
function App() {
  const { hash, goTo } = useHashRoute();
  const [theme, setTheme] = useStateS(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const [role, setRole] = useStateS(() => localStorage.getItem('cw_role') || 'student');
  useEffectS(() => { localStorage.setItem('cw_role', role); }, [role]);
  useEffectS(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const segs = parseRoute(hash);
  const [root, id, sub] = segs;
  const isTake = sub === 'take';

  let view = null;
  if (root === 'assignment' || !root) {
    view = id ? <AssignmentDetail id={id} goTo={goTo} /> : <AssignmentList goTo={goTo} />;
  } else if (root === 'exam') {
    if (sub === 'take' && id) view = <ExamTake id={id} goTo={goTo} />;
    else if (sub === 'review' && id) view = <ExamReview id={id} goTo={goTo} />;
    else if (sub === 'results' && id) view = <ExamClassResults id={id} goTo={goTo} />;
    else if (id) view = <ExamDetail id={id} goTo={goTo} />;
    else view = <ExamList goTo={goTo} />;
  } else if (root === 'contest') {
    if (sub === 'scoreboard' && id) view = <ContestScoreboard id={id} goTo={goTo} />;
    else if (id) view = <ContestDetail id={id} goTo={goTo} />;
    else view = <ContestList goTo={goTo} />;
  } else {
    view = <NotFound goTo={goTo} />;
  }

  if (isTake) {
    return (
      <CWRoleCtx.Provider value={{ role, setRole }}>
        {view}
      </CWRoleCtx.Provider>
    );
  }

  return (
    <CWRoleCtx.Provider value={{ role, setRole }}>
    <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 pt-6 pb-16">
      <AppHeader hash={hash} goTo={goTo} theme={theme} setTheme={setTheme} role={role} setRole={setRole} />
      <main className="mt-8">{view}</main>
    </div>
    </CWRoleCtx.Provider>
  );
}

window.CWApp = App;
