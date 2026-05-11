// Contest list + detail + scoreboard views
const { useState: useStateC, useEffect: useEffectC, useMemo: useMemoC } = React;

function ContestList({ goTo }) {
  const data = window.CW_DATA;
  const live = data.contests.filter(c => c.status === 'live');
  const upcoming = data.contests.filter(c => c.status === 'upcoming');
  const past = data.contests.filter(c => c.status === 'ended');

  return (
    <div className="space-y-8 fade-up">
      <PageHero
        kind="contest"
        eyebrow="Programming Contests"
        title="競賽"
        titleEn="Contests"
        description="與全校同學一較高下。ICPC、Codeforces 等多種賽制，每週皆有新比賽。"
        meta={[
          { k: '本月場次', v: '5' },
          { k: '個人積分', v: '1,420' },
          { k: '全校排名', v: '#34' },
        ]}
        accentStripe
      />

      {live.length > 0 && (
        <Section title="LIVE" subtitle="比賽進行中" badge="正在直播">
          <div className="grid gap-4">
            {live.map((c, i) => <ContestPoster key={c.id} c={c} onClick={() => goTo(`#/contest/${c.id}`)} delay={i*80} variant="live" />)}
          </div>
        </Section>
      )}

      <Section title="UPCOMING" subtitle="即將舉行">
        <div className="grid gap-4">
          {upcoming.map((c, i) => <ContestPoster key={c.id} c={c} onClick={() => goTo(`#/contest/${c.id}`)} delay={i*80} />)}
        </div>
      </Section>

      <Section title="HISTORY" subtitle="過去比賽">
        <div className="grid gap-3">
          {past.map((c, i) => <ContestRowPast key={c.id} c={c} onClick={() => goTo(`#/contest/${c.id}`)} delay={i*60} />)}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, badge, children }) {
  return (
    <section>
      <div className="flex items-end gap-3 mb-4">
        <h2 className="font-mono text-micro uppercase tracking-[0.2em] text-muted-foreground">{title}</h2>
        <span className="font-display text-body font-semibold">{subtitle}</span>
        {badge && (
          <span className="inline-flex items-center gap-1.5 ml-2 rounded-full px-2.5 py-0.5 text-micro font-mono uppercase tracking-wider"
            style={{ background: 'color-mix(in oklab, var(--destructive) 14%, transparent)', color: 'oklch(0.55 0.2 27)' }}>
            <span className="size-1.5 rounded-full live-dot" style={{ background: 'oklch(0.55 0.2 27)' }}></span>
            {badge}
          </span>
        )}
        <div className="flex-1 ml-2 border-t border-subtle"></div>
      </div>
      {children}
    </section>
  );
}

function ContestPoster({ c, onClick, delay = 0, variant }) {
  const isLive = variant === 'live';
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); onClick(); }}
      className="group relative glass hover-lift rounded-2xl shadow-rest overflow-hidden fade-up block"
      style={{ animationDelay: `${delay}ms`, borderColor: isLive ? 'color-mix(in oklab, var(--destructive) 30%, transparent)' : undefined, borderWidth: isLive ? 2 : 1 }}>
      {/* Diagonal stripe accent */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{
        background: `repeating-linear-gradient(135deg, var(--foreground) 0 1px, transparent 1px 24px)`,
      }}></div>

      <div className="relative grid items-center gap-4" style={{ gridTemplateColumns: '1fr auto', minHeight: 156 }}>
        <div className="p-6 lg:p-7 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-micro uppercase tracking-[0.18em]" style={{ color: isLive ? 'oklch(0.55 0.2 27)' : 'var(--muted-foreground)' }}>
              {c.code}
            </span>
            <span className="opacity-40 text-micro">·</span>
            <span className="font-mono text-micro uppercase tracking-wider text-muted-foreground">{c.format}</span>
            <StatusPill status={c.status} type="contest" />
            {c.tags.slice(0, 2).map(t => (
              <span key={t} className="rounded-full px-2 py-0.5 text-micro font-medium" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>{t}</span>
            ))}
          </div>

          <h3 className="mt-2 font-display text-title-lg lg:text-headline font-semibold tracking-tight">{c.title}</h3>
          <p className="text-caption text-muted-foreground">{c.subtitle}</p>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-caption">
            <Stat k="開始" v={cwFmt.fmtDate(c.startAt)} />
            <Stat k="時長" v={`${c.durationMin} 分鐘`} />
            <Stat k="參賽" v={`${c.participants} 人`} />
          </div>
        </div>

        {/* Right CTA panel */}
        <div className="self-stretch flex flex-col items-end justify-between p-6 pl-2 lg:pl-6 lg:pr-7 min-w-[260px] border-l border-subtle"
          style={isLive ? { background: 'color-mix(in oklab, var(--destructive) 5%, transparent)' } : { background: 'color-mix(in oklab, var(--primary) 4%, transparent)' }}>
          <div className="w-full text-right">
            <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground">
              {isLive ? '剩餘時間' : '距離開始'}
            </div>
            <div className="mt-1 flex justify-end">
              <Countdown iso={isLive ? c.endAt : c.startAt} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-caption">
            {c.registered ? (
              <span className="font-mono uppercase tracking-wider text-muted-foreground">已報名</span>
            ) : (
              <span className="font-mono uppercase tracking-wider">未報名</span>
            )}
            <span className="font-semibold" style={{ color: 'var(--primary)' }}>進入 →</span>
          </div>
        </div>
      </div>
    </a>
  );
}

function ContestRowPast({ c, onClick, delay = 0 }) {
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); onClick(); }}
      className="group glass hover-lift rounded-xl shadow-rest fade-up block px-5 py-4"
      style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-4">
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground border border-subtle rounded px-1.5 py-0.5">{c.code}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="font-display text-body-lg font-semibold truncate">{c.title}</h3>
            <span className="text-caption text-muted-foreground">{c.format}</span>
          </div>
          <div className="text-caption text-muted-foreground">{cwFmt.fmtDate(c.startAt)} · {c.participants} 人參賽</div>
        </div>
        <div className="hidden sm:flex items-center gap-6 text-caption">
          <div className="text-right"><div className="text-muted-foreground font-mono uppercase text-micro tracking-wider">解題</div><div className="font-mono mt-0.5"><span className="font-semibold">{c.mySolved}</span>/{c.problems}</div></div>
          <div className="text-right"><div className="text-muted-foreground font-mono uppercase text-micro tracking-wider">排名</div><div className="font-mono mt-0.5"><span className="font-semibold">#{c.myRank}</span></div></div>
        </div>
        <span className="text-caption font-medium text-muted-foreground group-hover:text-foreground transition-colors">→</span>
      </div>
    </a>
  );
}

// ============ DETAIL ============
function ContestDetail({ id, goTo }) {
  const data = window.CW_DATA;
  const c = data.contests.find(x => x.id === id);
  if (!c) return <NotFound goTo={goTo} />;
  const probs = data.contestProblems[c.id] || [];
  const isLive = c.status === 'live';
  const past = c.status === 'ended';

  return (
    <div className="space-y-6 fade-up">
      <Crumbs items={[{ label: 'contest', href: '#/contest' }, { label: c.id }]} onNavigate={goTo} />

      {/* Hero — full-bleed banner with marquee */}
      <div className="relative overflow-hidden rounded-2xl shadow-rest" style={{
        background: isLive
          ? 'linear-gradient(135deg, color-mix(in oklab, var(--destructive) 12%, var(--panel-strong)) 0%, var(--panel-strong) 60%)'
          : 'linear-gradient(135deg, color-mix(in oklab, var(--primary) 14%, var(--panel-strong)) 0%, var(--panel-strong) 60%)',
        border: '1px solid var(--border)',
      }}>
        <Marquee text={`${c.code} · ${c.title.toUpperCase()} · ${c.format} · ${c.participants} PARTICIPANTS`} />

        <div className="relative px-7 py-9 lg:p-10">
          <div className="flex flex-wrap items-start gap-6 justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground">
                <TypeIcon kind="contest" size={14} />
                <span>Contest · {c.format}</span>
              </div>
              <div className="mt-3"><StatusPill status={c.status} type="contest" /></div>
              <h1 className="mt-3 font-display font-semibold tracking-tight" style={{ fontSize: 'clamp(2rem, 4.2vw, 3.5rem)', lineHeight: 1.05 }}>{c.title}</h1>
              <p className="text-body text-muted-foreground">{c.subtitle}</p>
              <p className="mt-4 max-w-2xl text-body text-muted-foreground">{c.summary}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {c.tags.map(t => <span key={t} className="rounded-full px-2.5 py-1 text-caption font-medium" style={{ background: 'var(--panel)', border: '1px solid var(--border-subtle)' }}>{t}</span>)}
              </div>
            </div>

            {/* Big clock */}
            <div className="rounded-xl border p-5 min-w-[280px]" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
              <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.18em] text-muted-foreground">
                {isLive && <span className="size-1.5 rounded-full live-dot" style={{ background: 'oklch(0.55 0.2 27)' }}></span>}
                <span>{isLive ? '比賽進行中 · 剩餘' : past ? '已結束' : '距離開始'}</span>
              </div>
              <div className="mt-2">
                {past
                  ? <div className="font-mono text-title">{cwFmt.fmtDate(c.startAt)}</div>
                  : <Countdown iso={isLive ? c.endAt : c.startAt} />
                }
              </div>
              <div className="mt-3 pt-3 border-t border-subtle space-y-1 text-caption font-mono">
                <div className="flex justify-between"><span className="text-muted-foreground">開始</span><span>{cwFmt.fmtDate(c.startAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">結束</span><span>{cwFmt.fmtDate(c.endAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">時長</span><span>{c.durationMin} 分鐘</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">參賽</span><span>{c.participants} 人</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <TabStrip tabs={[
          { value: 'overview', label: '概覽' },
          { value: 'rules', label: '規則' },
          { value: 'discuss', label: '討論' },
        ]} active="overview" onChange={() => {}} />
        <div className="ml-auto flex gap-3">
          <a href="#" onClick={(e) => { e.preventDefault(); goTo(`#/contest/${c.id}/scoreboard`); }}
            className="rounded-lg px-4 py-2 text-body-sm font-medium border border-default hover:bg-muted transition-colors flex items-center gap-2">
            <TrophyIcon /> 排行榜
          </a>
          {isLive ? (
            <button type="button" className="rounded-lg px-5 py-2 text-body-sm font-semibold text-primary-foreground bg-primary hover:opacity-95 transition-opacity flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-white"></span> 進入比賽
            </button>
          ) : past ? (
            <button type="button" className="rounded-lg px-5 py-2 text-body-sm font-semibold text-primary-foreground bg-primary hover:opacity-95 transition-opacity">查看詳解</button>
          ) : (
            <button type="button" className="rounded-lg px-5 py-2 text-body-sm font-semibold text-primary-foreground bg-primary hover:opacity-95 transition-opacity">已報名 · 等待開始</button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Problem list */}
        <GlassPanel className="overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-subtle">
            <h2 className="font-display text-title font-semibold">題目</h2>
            <div className="text-caption text-muted-foreground">{probs.length} 題 · {past ? '依難度排序' : '比賽開始後解鎖'}</div>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {probs.map((p, i) => {
              const locked = c.status === 'upcoming';
              return (
                <div key={p.id} className="grid grid-cols-[60px_1fr_auto_auto] items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors">
                  <div className="font-mono text-title font-semibold" style={{ color: locked ? 'var(--muted-foreground)' : 'var(--primary)' }}>{p.id}</div>
                  <div>
                    <div className="font-medium" style={locked ? { color: 'var(--muted-foreground)' } : {}}>
                      {locked ? '———————' : p.title}
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <DifficultyTick level={p.difficulty} />
                      {!locked && c.status !== 'upcoming' && (
                        <span className="text-micro font-mono uppercase tracking-wider text-muted-foreground">{p.solvedBy} 人通過</span>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:block w-32">
                    {!locked && c.status !== 'upcoming' && (
                      <div className="space-y-0.5">
                        <div className="text-micro font-mono uppercase tracking-wider text-muted-foreground">通過率</div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--muted)' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (p.solvedBy / c.participants) * 100)}%`, background: 'var(--primary)' }}></div>
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-caption font-medium px-3 py-1.5 rounded-md border border-subtle text-muted-foreground" style={locked ? { opacity: 0.5 } : {}}>
                    {locked ? '🔒' : '解題 →'}
                  </span>
                </div>
              );
            })}
          </div>
        </GlassPanel>

        {/* Sidebar: live mini-leaderboard or info */}
        <div className="space-y-4">
          {(isLive || past) && (
            <GlassPanel className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">即時排名 TOP 5</div>
                <a href="#" onClick={(e) => { e.preventDefault(); goTo(`#/contest/${c.id}/scoreboard`); }} className="text-caption font-medium text-primary">完整 →</a>
              </div>
              <ul className="space-y-2">
                {(data.scoreboard['weekly-12']?.rows.slice(0, 5) || []).map(r => (
                  <li key={r.rank} className="flex items-center gap-3 text-body-sm">
                    <span className={`font-mono text-caption font-bold w-6 ${r.rank <= 3 ? '' : 'text-muted-foreground'}`} style={r.rank === 1 ? { color: '#d4a054' } : r.rank === 2 ? { color: '#a0a0a0' } : r.rank === 3 ? { color: '#cd7f32' } : {}}>
                      {r.rank}
                    </span>
                    <span className={`flex-1 truncate ${r.me ? 'font-semibold' : ''}`} style={r.me ? { color: 'var(--primary)' } : {}}>{r.user}{r.me && ' (你)'}</span>
                    <span className="font-mono tabular-nums">{r.score}</span>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          )}

          <GlassPanel className="p-5">
            <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-3">賽制資訊</div>
            <dl className="space-y-2.5 text-body-sm">
              <Pair label="賽制" v={c.format} />
              <Pair label="報名人數" v={`${c.registeredCount} 人`} />
              <Pair label="實際參賽" v={`${c.participants} 人`} />
              <Pair label="您的狀態" v={c.registered ? '已報名' : '未報名'} />
            </dl>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}

function Pair({ label, v }) {
  return <div className="flex justify-between"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono">{v}</dd></div>;
}
function TrophyIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h8v3a4 4 0 0 1-8 0V4z"/><path d="M16 5h3v2a3 3 0 0 1-3 3M8 5H5v2a3 3 0 0 0 3 3"/><path d="M10 11v4M14 11v4"/><path d="M8 20h8M9 20l1-3h4l1 3"/></svg>; }

function Marquee({ text }) {
  const item = (
    <span className="inline-flex items-center gap-6 px-6 font-mono text-micro uppercase tracking-[0.3em] text-muted-foreground">
      {text}<span style={{ color: 'var(--primary)' }}>◆</span>{text}<span style={{ color: 'var(--primary)' }}>◆</span>
    </span>
  );
  return (
    <div className="overflow-hidden whitespace-nowrap py-2 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'color-mix(in oklab, var(--panel-strong) 90%, transparent)' }}>
      <div className="inline-block" style={{ animation: 'marquee 45s linear infinite' }}>{item}{item}{item}</div>
    </div>
  );
}

// ============ SCOREBOARD ============
function ContestScoreboard({ id, goTo }) {
  const data = window.CW_DATA;
  const c = data.contests.find(x => x.id === id);
  if (!c) return <NotFound goTo={goTo} />;
  // Pick scoreboard fixture by format
  const sbKey = c.format === 'ICPC' ? 'spring-cup' : 'weekly-12';
  const sb = data.scoreboard[sbKey] || data.scoreboard['weekly-12'];
  const isICPC = (sb.format || c.format) === 'ICPC';
  const isLive = c.status === 'live';
  const probCount = isICPC ? sb.problems.length : sb.problems.length;
  const myRow = sb.rows.find(r => r.me);

  return (
    <div className="space-y-6 fade-up">
      <Crumbs items={[
        { label: 'contest', href: '#/contest' },
        { label: c.id, href: `#/contest/${c.id}` },
        { label: 'scoreboard' },
      ]} onNavigate={goTo} />

      {/* Compact header */}
      <div className="glass rounded-2xl shadow-rest p-6 flex flex-wrap items-center gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <TrophyIcon />
            <span>Scoreboard · {c.format}</span>
          </div>
          <h1 className="mt-2 font-display text-headline font-semibold tracking-tight">{c.title}</h1>
          <p className="text-caption text-muted-foreground">{c.subtitle}</p>
        </div>

        {isLive && (
          <div className="rounded-xl border border-dashed p-4 min-w-[200px]" style={{ borderColor: 'color-mix(in oklab, var(--destructive) 35%, transparent)' }}>
            <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-wider text-muted-foreground">
              <span className="size-1.5 rounded-full live-dot" style={{ background: 'oklch(0.55 0.2 27)' }}></span>
              <span>LIVE · 剩餘</span>
            </div>
            <div className="mt-1"><Countdown iso={c.endAt} /></div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-5 text-center">
          <ScoreboardKpi k="參賽" v={c.participants} />
          <ScoreboardKpi k="題目" v={probCount} />
          <ScoreboardKpi k="您的名次" v={`#${myRow?.rank ?? '—'}`} accent />
        </div>
      </div>

      {/* Scoreboard table */}
      <GlassPanel className="overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-subtle gap-4 flex-wrap">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-title font-semibold">即時排名</h2>
            <span className="font-mono text-micro uppercase tracking-wider px-2 py-0.5 rounded-sm" style={{ background: isICPC ? 'color-mix(in oklab,#c4682d 14%,transparent)' : 'color-mix(in oklab,var(--chart-3) 18%,transparent)', color: isICPC ? '#c4682d' : 'oklch(0.45 0.13 245)' }}>{isICPC ? 'ICPC 賽制' : 'Codeforces 賽制'}</span>
            <span className="text-caption text-muted-foreground hidden sm:inline">{isICPC ? '排序：解題數 ↓ → 罰時 ↑' : '排序：總分 ↓ → 最後 AC 時間 ↑'}</span>
          </div>
          <div className="flex items-center gap-3">
            {isLive && <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground"><span className="size-1.5 rounded-full live-dot"></span>每 30 秒更新</span>}
            <TabStrip tabs={[
              { value: 'all', label: '所有人' },
              { value: 'friends', label: '好友' },
              { value: 'around', label: '我附近' },
            ]} active="all" onChange={() => {}} />
          </div>
        </div>

        {isICPC ? (
          <IcpcTable sb={sb} />
        ) : (
          <CfTable sb={sb} />
        )}

        {/* Legend */}
        <div className="px-6 py-3 border-t border-subtle flex flex-wrap items-center gap-x-5 gap-y-2 text-micro font-mono uppercase tracking-wider text-muted-foreground">
          {isICPC ? (
            <React.Fragment>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded" style={{ background: 'color-mix(in oklab, var(--success) 30%, transparent)' }}></span>AC · 時間 / 嘗試次數</span>
              <span className="flex items-center gap-1.5"><span className="inline-grid place-items-center size-3.5 rounded-[2px] text-[8px]" style={{ background: '#d4a054', color: 'white' }}>★</span>FIRST BLOOD · 首殺</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded" style={{ background: 'color-mix(in oklab, var(--destructive) 25%, transparent)' }}></span>WA · 嘗試中</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-muted"></span>未提交</span>
              <span className="ml-auto opacity-70">罰時 = AC 時間 + 20 × 錯誤次數 (min)</span>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded" style={{ background: 'color-mix(in oklab, var(--success) 30%, transparent)' }}></span>AC · 分數 + AC 時間</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded" style={{ background: 'color-mix(in oklab, var(--destructive) 25%, transparent)' }}></span>嘗試中 · 顯示嘗試次數</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-muted"></span>未提交</span>
              <span className="ml-auto opacity-70">分數隨時間遞減，錯誤提交亦扣分</span>
            </React.Fragment>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

// ============ ICPC TABLE ============
function IcpcTable({ sb }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="text-micro font-mono uppercase tracking-wider text-muted-foreground" style={{ background: 'color-mix(in oklab, var(--muted) 60%, transparent)' }}>
            <th className="text-left px-6 py-3 w-16">#</th>
            <th className="text-left px-4 py-3">參賽者</th>
            <th className="text-center px-3 py-3 w-20">解題</th>
            <th className="text-center px-3 py-3 w-24">罰時</th>
            {sb.problems.map(p => (
              <th key={p.id} className="text-center px-2 py-3 w-[72px]">
                <div className="font-bold text-foreground">{p.id}</div>
                <div className="opacity-50 normal-case text-[10px] mt-0.5 truncate" title={p.title}>{p.title}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {sb.rows.map(r => (
            <tr key={r.rank} className={`transition-colors ${r.me ? '' : 'hover:bg-muted/40'}`}
              style={r.me ? { background: 'color-mix(in oklab, var(--primary) 8%, transparent)', outline: '1px solid color-mix(in oklab, var(--primary) 25%, transparent)' } : {}}>
              <td className="px-6 py-3 align-middle">
                <RankBadge rank={r.rank} />
              </td>
              <td className="px-4 py-3 align-middle">
                <div className="flex items-center gap-2.5">
                  <div className="size-7 rounded-full" style={{ background: `hsl(${r.user.charCodeAt(0)*7 % 360} 30% 65%)` }}></div>
                  <span className={r.me ? 'font-semibold' : ''} style={r.me ? { color: 'var(--primary)' } : {}}>{r.user}</span>
                  {r.me && <span className="text-micro font-mono uppercase tracking-wider text-primary">YOU</span>}
                </div>
              </td>
              <td className="px-3 py-3 text-center font-mono tabular-nums font-semibold text-title-sm">{r.solved}</td>
              <td className="px-3 py-3 text-center font-mono tabular-nums text-muted-foreground">{r.penalty}</td>
              {r.cells.map((s, i) => (
                <td key={i} className="px-2 py-3 text-center">
                  <IcpcCell s={s} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IcpcCell({ s }) {
  if (s.ok) {
    return (
      <div className="relative inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1 min-w-[60px]" style={{ background: 'color-mix(in oklab, var(--success) 18%, transparent)' }}>
        {s.fb && <span className="absolute -top-1 -right-1 inline-grid place-items-center size-3.5 rounded-full text-[8px] font-bold" style={{ background: '#d4a054', color: 'white' }} title="First Blood">★</span>}
        <span className="font-mono text-caption font-semibold tabular-nums" style={{ color: 'oklch(0.4 0.13 160)' }}>{s.t}</span>
        {s.tries > 1 && <span className="font-mono text-[10px] tabular-nums opacity-70" style={{ color: 'oklch(0.45 0.13 160)' }}>+{s.tries - 1}</span>}
      </div>
    );
  }
  if (!s.tries) {
    return <span className="text-muted-foreground font-mono opacity-40">·</span>;
  }
  return (
    <div className="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1 min-w-[60px]" style={{ background: 'color-mix(in oklab, var(--destructive) 14%, transparent)' }}>
      <span className="font-mono text-caption font-semibold" style={{ color: 'oklch(0.5 0.18 27)' }}>−{s.tries}</span>
      <span className="font-mono text-[10px]" style={{ color: 'oklch(0.55 0.18 27)' }}>WA</span>
    </div>
  );
}

// ============ CODEFORCES TABLE ============
function CfTable({ sb }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="text-micro font-mono uppercase tracking-wider text-muted-foreground" style={{ background: 'color-mix(in oklab, var(--muted) 60%, transparent)' }}>
            <th className="text-left px-6 py-3 w-16">#</th>
            <th className="text-left px-4 py-3">參賽者</th>
            <th className="text-right px-4 py-3 w-24">總分</th>
            {sb.problems.map(p => <th key={p} className="text-center px-3 py-3 w-24">{p}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {sb.rows.map(r => (
            <tr key={r.rank} className={`transition-colors ${r.me ? '' : 'hover:bg-muted/40'}`}
              style={r.me ? { background: 'color-mix(in oklab, var(--primary) 8%, transparent)', outline: '1px solid color-mix(in oklab, var(--primary) 25%, transparent)' } : {}}>
              <td className="px-6 py-3 align-middle">
                <RankBadge rank={r.rank} />
              </td>
              <td className="px-4 py-3 align-middle">
                <div className="flex items-center gap-2.5">
                  <div className="size-7 rounded-full" style={{ background: `hsl(${r.user.charCodeAt(0)*7 % 360} 30% 65%)` }}></div>
                  <span className={r.me ? 'font-semibold' : ''} style={r.me ? { color: 'var(--primary)' } : {}}>{r.user}</span>
                  {r.me && <span className="text-micro font-mono uppercase tracking-wider text-primary">YOU</span>}
                </div>
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-title-sm">{r.score}</td>
              {r.solved.map((s, i) => (
                <td key={i} className="px-3 py-3 text-center"><CfCell s={s} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CfCell({ s }) {
  if (s.ok) {
    return (
      <div className="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 min-w-[64px]" style={{ background: 'color-mix(in oklab, var(--success) 18%, transparent)' }}>
        <span className="font-mono text-caption font-semibold tabular-nums" style={{ color: 'oklch(0.4 0.13 160)' }}>+{s.points}</span>
        <span className="font-mono text-micro tabular-nums" style={{ color: 'oklch(0.45 0.13 160)' }}>{s.t}</span>
      </div>
    );
  }
  if (!s.tries) {
    return <span className="text-muted-foreground font-mono opacity-40">·</span>;
  }
  return (
    <div className="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 min-w-[64px]" style={{ background: 'color-mix(in oklab, var(--destructive) 14%, transparent)' }}>
      <span className="font-mono text-caption font-semibold" style={{ color: 'oklch(0.5 0.18 27)' }}>−{s.tries}</span>
      <span className="font-mono text-micro" style={{ color: 'oklch(0.55 0.18 27)' }}>try</span>
    </div>
  );
}

function RankBadge({ rank }) {
  return (
    <span className={`inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-md font-mono font-bold tabular-nums ${rank <= 3 ? 'text-primary-foreground' : 'text-muted-foreground'}`}
      style={rank === 1 ? { background: '#d4a054' } : rank === 2 ? { background: '#9a9a9a' } : rank === 3 ? { background: '#cd7f32' } : { background: 'var(--muted)' }}>
      {rank}
    </span>
  );
}

function ScoreboardKpi({ k, v, accent }) {
  return (
    <div>
      <div className="font-mono text-micro uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className={`mt-1 font-display text-title font-semibold tabular-nums`} style={accent ? { color: 'var(--primary)' } : {}}>{v}</div>
    </div>
  );
}

Object.assign(window, { ContestList, ContestDetail, ContestScoreboard });
