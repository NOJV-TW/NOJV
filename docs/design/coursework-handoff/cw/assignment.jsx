// Assignment list + detail views
const { useState: useStateA } = React;

function AssignmentList({ goTo }) {
  const data = window.CW_DATA;
  const [filter, setFilter] = useStateA('all');
  const items = data.assignments.filter(a =>
    filter === 'all' ? true :
    filter === 'active' ? (a.status === 'in_progress' || a.status === 'not_started') :
    a.status === 'graded' || a.status === 'submitted'
  );

  return (
    <div className="space-y-6 fade-up">
      <PageHero
        kind="assignment"
        eyebrow={`${data.course.code} · ${data.course.title}`}
        title="作業"
        titleEn="Assignments"
        description="每週的引導式練習。完成期限後仍可繼續嘗試，但會依規則扣分。"
        meta={[
          { k: '授課教師', v: data.course.instructor || '王老師' },
          { k: '當前週次', v: '第 7 週' },
          { k: '下次截止', v: '3/22 23:59' },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <TabStrip tabs={[
          { value: 'all', label: `全部 (${data.assignments.length})` },
          { value: 'active', label: '進行中' },
          { value: 'done', label: '已完成' },
        ]} active={filter} onChange={setFilter} />
        <div className="ml-auto text-caption text-muted-foreground">依截止日排序</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((a, i) => <AssignmentCard key={a.id} a={a} onClick={() => goTo(`#/assignment/${a.id}`)} delay={i*60} />)}
      </div>
    </div>
  );
}

function AssignmentCard({ a, onClick, delay = 0 }) {
  const pct = Math.round((a.solved / a.problems) * 100);
  const ms = cwFmt.diffMs(a.dueAt);
  const c = cwFmt.fmtCountdown(ms);
  const urgent = !c.past && c.d < 2 && a.status !== 'graded' && a.status !== 'submitted';

  return (
    <a href="#" onClick={(e) => { e.preventDefault(); onClick(); }}
      className="group glass hover-lift rounded-2xl p-5 shadow-rest fade-up block"
      style={{ animationDelay: `${delay}ms`, borderColor: urgent ? 'color-mix(in oklab, var(--primary) 35%, transparent)' : undefined }}>
      <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.18em] text-muted-foreground">
        <TypeIcon kind="assignment" size={12} />
        <span>{window.CW_DATA.course.code} · {window.CW_DATA.course.name}</span>
      </div>
      <div className="mt-3 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-title font-semibold leading-tight">{a.title}</h3>
          <p className="text-caption text-muted-foreground mt-0.5">{a.titleEn}</p>
          <div className="mt-1.5 flex items-center gap-2 text-caption text-muted-foreground">
            <span className="font-mono">{c.past ? '已截止' : '剩餘'}</span>
            <Countdown iso={a.dueAt} compact />
            {urgent && <span className="text-micro font-mono uppercase tracking-wider" style={{ color: 'var(--primary)' }}>· 截止將至</span>}
          </div>
        </div>
        <ProgressRing value={pct} size={48} stroke={5} label={`${a.solved}/${a.problems}`} />
      </div>

      <p className="mt-4 text-body-sm text-muted-foreground line-clamp-2">{a.summary}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {a.tags.map(t => (
          <span key={t} className="rounded-full px-2 py-0.5 text-micro font-medium" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>{t}</span>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-subtle flex items-center justify-between">
        <StatusPill status={a.status} type="assignment" />
        <div className="text-right">
          <div className="text-micro font-mono uppercase tracking-wider text-muted-foreground">得分</div>
          <div className="mt-0.5 font-mono">
            <span className="text-body font-semibold">{a.score}</span>
            <span className="text-muted-foreground"> / {a.maxScore}</span>
          </div>
        </div>
      </div>
    </a>
  );
}

function AssignmentDetail({ id, goTo }) {
  const data = window.CW_DATA;
  const a = data.assignments.find(x => x.id === id);
  if (!a) return <NotFound goTo={goTo} />;
  const probs = data.assignmentProblems[id] || data.assignmentProblems.hw07;
  const pct = Math.round((a.solved / a.problems) * 100);

  return (
    <div className="space-y-6 fade-up">
      <Crumbs items={[{ label: 'assignment', href: '#/assignment' }, { label: a.id }]} onNavigate={goTo} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Hero */}
        <GlassPanel className="relative overflow-hidden p-7 lg:p-9">
          <DotGrid opacity={0.18} />
          <div className="relative">
            <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-wider text-muted-foreground">
              <TypeIcon kind="assignment" size={14} />
              <span>Assignment · {data.course.code}</span>
            </div>
            <div className="mt-3 flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-title text-muted-foreground">HW {a.no}</span>
              <StatusPill status={a.status} type="assignment" />
            </div>
            <h1 className="mt-2 font-display text-headline lg:text-display font-semibold tracking-tight">{a.title}</h1>
            <p className="mt-1 text-body text-muted-foreground">{a.titleEn}</p>
            <p className="mt-5 max-w-2xl text-body text-muted-foreground">{a.summary}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {a.tags.map(t => <span key={t} className="rounded-full px-2.5 py-1 text-caption font-medium bg-muted text-muted-foreground">{t}</span>)}
            </div>
          </div>
        </GlassPanel>

        {/* Sidebar facts */}
        <div className="space-y-4">
          <GlassPanel className="p-5">
            <div className="text-micro font-mono uppercase tracking-wider text-muted-foreground">截止時間</div>
            <div className="mt-1 font-display text-title font-semibold">{cwFmt.fmtDate(a.dueAt)} 週{cwFmt.fmtWeekday(a.dueAt)}</div>
            <div className="mt-3"><Countdown iso={a.dueAt} /></div>
            <div className="mt-3 text-caption text-muted-foreground">{a.latePenalty}</div>
          </GlassPanel>

          <GlassPanel className="p-5">
            <div className="grid grid-cols-2 gap-y-3 text-body-sm">
              <div>
                <div className="text-micro font-mono uppercase tracking-wider text-muted-foreground">進度</div>
                <div className="mt-0.5 font-mono"><span className="font-semibold text-body">{a.solved}</span> / {a.problems} 題</div>
              </div>
              <div>
                <div className="text-micro font-mono uppercase tracking-wider text-muted-foreground">得分</div>
                <div className="mt-0.5 font-mono"><span className="font-semibold text-body">{a.score}</span> / {a.maxScore}</div>
              </div>
              <div>
                <div className="text-micro font-mono uppercase tracking-wider text-muted-foreground">嘗試次數</div>
                <div className="mt-0.5">{a.attemptsAllowed === 'unlimited' ? '不限' : a.attemptsAllowed}</div>
              </div>
              <div>
                <div className="text-micro font-mono uppercase tracking-wider text-muted-foreground">遲交規則</div>
                <div className="mt-0.5 text-caption text-muted-foreground">{a.latePenalty?.split('，')[0] || '依規則扣分'}</div>
              </div>
            </div>
          </GlassPanel>
        </div>
      </div>

      {/* Problem table */}
      <GlassPanel className="overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-subtle">
          <h2 className="font-display text-title font-semibold">題目列表</h2>
          <div className="text-caption text-muted-foreground">{a.solved}/{a.problems} 已通過 · {pct}%</div>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {probs.map((p, i) => (
            <div key={p.id} className="grid grid-cols-[60px_1fr_auto_auto_auto] items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors">
              <div className="font-mono text-body font-semibold text-muted-foreground">{p.id}</div>
              <div>
                <div className="font-medium">{p.title}</div>
                <div className="mt-1 flex items-center gap-3">
                  <DifficultyTick level={p.difficulty} />
                  <span className="text-micro font-mono uppercase tracking-wider text-muted-foreground">嘗試 {p.tries}</span>
                </div>
              </div>
              <div className="hidden sm:block">
                {p.solved
                  ? <span className="inline-flex items-center gap-1.5 text-caption verdict-ac rounded-full px-2.5 py-1 font-mono uppercase tracking-wider"><Check14 /> AC</span>
                  : <span className="text-caption font-mono uppercase tracking-wider text-muted-foreground">—</span>}
              </div>
              <div className="font-mono text-body-sm tabular-nums w-20 text-right">
                <span className={p.solved ? 'font-semibold' : 'text-muted-foreground'}>{p.score}</span>
                <span className="text-muted-foreground"> / {p.max}</span>
              </div>
              <a href="#" onClick={(e) => e.preventDefault()} className="text-caption font-medium px-3 py-1.5 rounded-md border border-subtle hover:border-default transition-colors">
                {p.solved ? '查看' : '解題'} →
              </a>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

function Check14() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>; }
function NotFound({ goTo }) {
  return <div className="text-center py-20">
    <div className="font-display text-headline text-muted-foreground">404</div>
    <a href="#" onClick={(e) => { e.preventDefault(); goTo('#/assignment'); }} className="text-primary">回到列表</a>
  </div>;
}

Object.assign(window, { AssignmentList, AssignmentDetail, Check14 });
