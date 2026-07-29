(() => {
  "use strict";

  const SNAPSHOT = structuredClone(window.PTR4_DATA || {});
  const STORE = {
    visits: "ptr4_os_visits_v2",
    actions: "ptr4_os_actions_v2",
    csvUrl: "ptr4_os_csv_v2",
  };
  const ROUTES = {
    today: "Daily Briefing",
    clubs: "Club Intelligence",
    visits: "Visit System",
    performance: "Performance",
    tools: "Tools",
    settings: "Settings",
  };

  const $ = (id) => document.getElementById(id);
  const load = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const clone = (value) => structuredClone(value);
  const money = (value, decimals = 0) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(value || 0));
  const number = (value) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
  const percent = (value) => `${Number(value || 0).toFixed(1)}%`;
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const areaNames = () =>
    Object.keys(state.data.clubsByArea || {}).filter(
      (name) => (state.data.clubsByArea[name] || []).length,
    );
  const operatingAreas = () =>
    areaNames()
      .map((name) => state.data.areas.find((area) => area.name === name))
      .filter(Boolean);
  const allClubs = () =>
    areaNames().flatMap((area) =>
      (state.data.clubsByArea[area] || []).map((club) => ({ ...club, area })),
    );

  const urlParams = new URLSearchParams(location.search);
  const initialArea = urlParams.get("area") || "All";
  const state = {
    data: clone(SNAPSHOT),
    selectedArea: initialArea,
    source: "Snapshot",
    lastSync: null,
    visits: load(STORE.visits, []),
    actions: load(STORE.actions, []),
  };

  function scopeMetric() {
    if (state.selectedArea === "All") return state.data.region || {};
    return (
      state.data.areas.find((area) => area.name === state.selectedArea) ||
      state.data.region ||
      {}
    );
  }

  function scopedClubs() {
    if (state.selectedArea === "All") return allClubs();
    return (state.data.clubsByArea[state.selectedArea] || []).map((club) => ({
      ...club,
      area: state.selectedArea,
    }));
  }

  function gap(actual, goal) {
    return Number(actual || 0) - Number(goal || 0);
  }

  function riskScore(club) {
    const eftPenalty = Math.max(0, -gap(club.eft, club.goal));
    const revenuePenalty = Math.max(0, -gap(club.revActual, club.revGoal)) * 0.55;
    const showPenalty = Math.max(0, 60 - Number(club.showRate || 0)) * 80;
    const closePenalty = Math.max(0, 30 - Number(club.closeRate || 0)) * 115;
    const bookingPenalty = Math.max(0, 50 - Number(club.posBooking || 0)) * 35;
    return eftPenalty + revenuePenalty + showPenalty + closePenalty + bookingPenalty;
  }

  function riskFor(club) {
    const score = riskScore(club);
    if (
      score >= 5500 ||
      (Number(club.showRate || 0) < 40 && Number(club.sets || 0) >= 5) ||
      (Number(club.closeRate || 0) < 15 && Number(club.shows || 0) >= 4)
    ) {
      return { key: "red", label: "Action required" };
    }
    if (
      score >= 1800 ||
      Number(club.showRate || 0) < 55 ||
      Number(club.closeRate || 0) < 25
    ) {
      return { key: "yellow", label: "Watch" };
    }
    return { key: "green", label: "On pace" };
  }

  function nextMove(club) {
    const items = [
      {
        score: Math.max(0, 60 - Number(club.showRate || 0)) * 100,
        label: "Repair confirmations",
      },
      {
        score: Math.max(0, 30 - Number(club.closeRate || 0)) * 120,
        label: "Coach the close",
      },
      {
        score: Math.max(0, 50 - Number(club.posBooking || 0)) * 70,
        label: "Fix POS booking",
      },
      {
        score: Math.max(0, -gap(club.eft, club.goal)),
        label: "Build EFT recovery",
      },
      {
        score: Math.max(0, -gap(club.revActual, club.revGoal)) * 0.7,
        label: "Close revenue gap",
      },
    ].sort((a, b) => b.score - a.score);
    return items[0].score > 0 ? items[0].label : "Protect current pace";
  }

  function directionFor(area) {
    const misses = [
      gap(area.eft, area.goal) < 0,
      gap(area.revActual, area.revGoal) < 0,
      Number(area.showRate || 0) < 60,
      Number(area.closeRate || 0) < 30,
    ].filter(Boolean).length;
    if (misses >= 3) return { key: "red", label: "Intervene" };
    if (misses >= 1) return { key: "yellow", label: "Watch" };
    return { key: "green", label: "On pace" };
  }

  function statusMarkup(tone, label) {
    return `<span class="status ${tone}">${escapeHtml(label)}</span>`;
  }

  function setRoute(route, updateHash = true) {
    const next = ROUTES[route] ? route : "today";
    document.querySelectorAll("[data-page]").forEach((page) => {
      page.classList.toggle("active", page.dataset.page === next);
    });
    document.querySelectorAll("[data-route]").forEach((control) => {
      const active = control.dataset.route === next;
      control.classList.toggle("active", active);
      if (active) control.setAttribute("aria-current", "page");
      else control.removeAttribute("aria-current");
    });
    $("topPageName").textContent = ROUTES[next];
    if (updateHash && location.hash !== `#${next}`) history.pushState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function updateAreaUrl() {
    const url = new URL(location.href);
    if (state.selectedArea === "All") url.searchParams.delete("area");
    else url.searchParams.set("area", state.selectedArea);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function populateAreaControls() {
    const names = areaNames();
    if (state.selectedArea !== "All" && !names.includes(state.selectedArea)) {
      state.selectedArea = "All";
    }
    const options = ["All", ...names]
      .map(
        (name) =>
          `<option value="${escapeHtml(name)}">${name === "All" ? "Entire region" : escapeHtml(name)}</option>`,
      )
      .join("");
    $("globalArea").innerHTML = options;
    $("globalArea").value = state.selectedArea;
    $("clubAreaFilter").innerHTML = options;
    $("clubAreaFilter").value = state.selectedArea;
    $("visitArea").innerHTML = names
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join("");
    renderVisitClubOptions();
  }

  function renderTodayKpis() {
    const metric = scopeMetric();
    const cards = [
      {
        label: "Projected EFT",
        value: money(metric.eft),
        delta: gap(metric.eft, metric.goal),
        target: metric.goal,
        current: metric.eft,
        targetText: `Goal ${money(metric.goal)}`,
      },
      {
        label: "Projected revenue",
        value: money(metric.revActual),
        delta: gap(metric.revActual, metric.revGoal),
        target: metric.revGoal,
        current: metric.revActual,
        targetText: `Goal ${money(metric.revGoal)}`,
      },
      {
        label: "Show rate",
        value: percent(metric.showRate),
        delta: Number(metric.showRate || 0) - 60,
        target: 60,
        current: metric.showRate,
        targetText: "Target 60%",
        points: true,
      },
      {
        label: "Close rate",
        value: percent(metric.closeRate),
        delta: Number(metric.closeRate || 0) - 30,
        target: 30,
        current: metric.closeRate,
        targetText: "Target 30%",
        points: true,
      },
    ];
    $("todayKpis").innerHTML = cards
      .map((card) => {
        const positive = card.delta >= 0;
        const deltaText = card.points
          ? `${positive ? "+" : ""}${card.delta.toFixed(1)} pts`
          : `${positive ? "+" : "−"}${money(Math.abs(card.delta))}`;
        const progress = card.target
          ? Math.max(0, Math.min(100, (Number(card.current || 0) / Number(card.target)) * 100))
          : 0;
        return `
          <article class="kpi-card">
            <div class="kpi-label">${card.label}</div>
            <div class="kpi-value">${card.value}</div>
            <div class="kpi-foot">
              <span class="delta ${positive ? "up" : "down"}">${deltaText}</span>
              <span>${card.targetText}</span>
            </div>
            <div class="progress"><span style="--progress:${progress}%;--progress-color:${positive ? "var(--green)" : "var(--purple)"}"></span></div>
          </article>`;
      })
      .join("");
  }

  function renderAttention() {
    const clubs = scopedClubs()
      .sort((a, b) => riskScore(b) - riskScore(a))
      .slice(0, 6);
    $("attentionList").innerHTML = clubs.length
      ? clubs
          .map((club, index) => {
            const risk = riskFor(club);
            const why = [
              gap(club.eft, club.goal) < 0 ? `EFT ${money(gap(club.eft, club.goal))}` : "",
              Number(club.showRate || 0) < 60 ? `Show ${percent(club.showRate)}` : "",
              Number(club.closeRate || 0) < 30 ? `Close ${percent(club.closeRate)}` : "",
            ]
              .filter(Boolean)
              .join(" • ");
            return `
              <div class="attention-row">
                <span class="rank">${index + 1}</span>
                <div>
                  <button class="table-action" type="button" data-open-club="${escapeHtml(`${club.area}::${club.name}`)}">${escapeHtml(club.name)}</button>
                  <div class="row-sub">${escapeHtml(club.area)}</div>
                </div>
                <div class="attention-why">
                  <div class="row-title">${escapeHtml(nextMove(club))}</div>
                  <div class="row-sub">${escapeHtml(why || "Protect current performance")}</div>
                </div>
                ${statusMarkup(risk.key, risk.label)}
              </div>`;
          })
          .join("")
      : '<div class="empty">No clubs in this scope.</div>';
  }

  function renderCadence() {
    const upcoming = state.visits
      .filter((visit) => !visit.complete)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 4);
    const defaults = [
      { time: "9:00", title: "Regional pulse", sub: "Review exceptions and assign owners." },
      { time: "11:30", title: "Confirmation rescue", sub: "Attack show-rate risk for the next 48 hours." },
      { time: "3:00", title: "Club follow-through", sub: "Close open visit and coaching actions." },
      { time: "EOD", title: "Pace check", sub: "Confirm EFT and revenue movement." },
    ];
    const items = upcoming.length
      ? upcoming.map((visit) => ({
          time: new Date(`${visit.date}T12:00:00`).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          }),
          title: `${visit.club} visit`,
          sub: `${visit.owner} • ${visit.priority} priority`,
        }))
      : defaults;
    $("cadenceList").innerHTML = items
      .map(
        (item) => `
          <div class="cadence-row">
            <span class="time-chip">${escapeHtml(item.time)}</span>
            <div><div class="row-title">${escapeHtml(item.title)}</div><div class="row-sub">${escapeHtml(item.sub)}</div></div>
          </div>`,
      )
      .join("");
  }

  function renderActionHealth() {
    const open = state.actions.filter((action) => !action.complete);
    const overdue = open.filter((action) => action.due && action.due < today()).length;
    const completed = state.actions.filter((action) => action.complete).length;
    const total = state.actions.length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    $("actionHealth").innerHTML = `
      <div class="inline" style="justify-content:space-between">
        <div><div class="kpi-value" style="margin-top:0">${open.length}</div><div class="row-sub">open actions</div></div>
        <div style="text-align:right"><div class="delta ${overdue ? "down" : "up"}">${overdue} overdue</div><div class="row-sub">${completed} completed</div></div>
      </div>
      <div class="progress"><span style="--progress:${pct}%;--progress-color:var(--green)"></span></div>
      <div class="row-sub" style="margin-top:9px">${total ? `${pct}% of recorded actions complete` : "Actions appear here after visits and club reviews."}</div>`;
  }

  function renderAreaScorecard() {
    $("areaScorecard").innerHTML = operatingAreas()
      .map((area) => {
        const direction = directionFor(area);
        return `
          <tr>
            <td><button class="table-action" type="button" data-select-area="${escapeHtml(area.name)}">${escapeHtml(area.name)}</button></td>
            <td class="numeric">${money(area.eft)}</td>
            <td class="numeric ${gap(area.eft, area.goal) < 0 ? "tone-red" : "tone-green"}">${money(gap(area.eft, area.goal))}</td>
            <td class="numeric ${gap(area.revActual, area.revGoal) < 0 ? "tone-red" : "tone-green"}">${money(gap(area.revActual, area.revGoal))}</td>
            <td class="numeric">${percent(area.showRate)}</td>
            <td class="numeric">${percent(area.closeRate)}</td>
            <td>${statusMarkup(direction.key, direction.label)}</td>
          </tr>`;
      })
      .join("");
  }

  function renderRecentActivity() {
    const areas = operatingAreas()
      .map((area) => ({
        area,
        combined: gap(area.eft, area.goal) + gap(area.revActual, area.revGoal),
      }))
      .sort((a, b) => a.combined - b.combined)
      .slice(0, 4);
    $("recentActivity").innerHTML = areas
      .map(({ area }) => {
        const eftGap = gap(area.eft, area.goal);
        const revGap = gap(area.revActual, area.revGoal);
        const positive = eftGap >= 0 && revGap >= 0;
        return `
          <div class="activity-row" style="grid-template-columns:minmax(130px,.7fr) minmax(0,1.6fr) auto">
            <div><div class="row-title">${escapeHtml(area.name)}</div><div class="row-sub">${(state.data.clubsByArea[area.name] || []).length} clubs</div></div>
            <div><div class="row-title">${positive ? "Protect positive pace" : "Recovery plan required"}</div><div class="row-sub">EFT ${money(eftGap)} • Revenue ${money(revGap)}</div></div>
            ${statusMarkup(positive ? "green" : "yellow", positive ? "Tracking" : "Review")}
          </div>`;
      })
      .join("");
  }

  function filteredClubs() {
    const search = $("clubSearch").value.trim().toLowerCase();
    const area = $("clubAreaFilter").value;
    const risk = $("clubRiskFilter").value;
    const sort = $("clubSort").value;
    let clubs = allClubs().filter((club) => {
      const matchesSearch =
        !search ||
        club.name.toLowerCase().includes(search) ||
        club.area.toLowerCase().includes(search);
      const matchesArea = area === "All" || club.area === area;
      const matchesRisk = risk === "all" || riskFor(club).key === risk;
      return matchesSearch && matchesArea && matchesRisk;
    });
    clubs.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "eftGap") return gap(a.eft, a.goal) - gap(b.eft, b.goal);
      if (sort === "revGap") return gap(a.revActual, a.revGoal) - gap(b.revActual, b.revGoal);
      if (sort === "showRate") return Number(a.showRate || 0) - Number(b.showRate || 0);
      if (sort === "closeRate") return Number(a.closeRate || 0) - Number(b.closeRate || 0);
      return riskScore(b) - riskScore(a);
    });
    return clubs;
  }

  function renderClubs() {
    const clubs = filteredClubs();
    $("clubCount").textContent = `${clubs.length} club${clubs.length === 1 ? "" : "s"}`;
    $("clubTableBody").innerHTML = clubs.length
      ? clubs
          .map((club) => {
            const risk = riskFor(club);
            return `
              <tr>
                <td><button class="table-action" type="button" data-open-club="${escapeHtml(`${club.area}::${club.name}`)}">${escapeHtml(club.name)}</button></td>
                <td>${escapeHtml(club.area)}</td>
                <td>${statusMarkup(risk.key, risk.label)}</td>
                <td class="numeric ${gap(club.eft, club.goal) < 0 ? "tone-red" : "tone-green"}">${money(gap(club.eft, club.goal))}</td>
                <td class="numeric ${gap(club.revActual, club.revGoal) < 0 ? "tone-red" : "tone-green"}">${money(gap(club.revActual, club.revGoal))}</td>
                <td class="numeric">${percent(club.showRate)}</td>
                <td class="numeric">${percent(club.closeRate)}</td>
                <td class="numeric">${percent(club.posBooking)}</td>
                <td>${escapeHtml(nextMove(club))}</td>
              </tr>`;
          })
          .join("")
      : '<tr><td colspan="9"><div class="empty">No clubs match this view.</div></td></tr>';
  }

  function openClubDrawer(key) {
    const [area, ...nameParts] = String(key).split("::");
    const name = nameParts.join("::");
    const club = (state.data.clubsByArea[area] || []).find((item) => item.name === name);
    if (!club) return;
    const risk = riskFor(club);
    $("drawerClubName").textContent = club.name;
    $("drawerClubArea").textContent = `${area} • ${risk.label}`;
    $("clubDrawerBody").innerHTML = `
      <div class="drawer-kpis">
        <div class="mini-kpi"><span>Projected EFT</span><strong>${money(club.eft)}</strong><div class="row-sub">Gap ${money(gap(club.eft, club.goal))}</div></div>
        <div class="mini-kpi"><span>Projected revenue</span><strong>${money(club.revActual)}</strong><div class="row-sub">Gap ${money(gap(club.revActual, club.revGoal))}</div></div>
        <div class="mini-kpi"><span>Show rate</span><strong>${percent(club.showRate)}</strong><div class="row-sub">${number(club.shows)} of ${number(club.sets)} sets</div></div>
        <div class="mini-kpi"><span>Close rate</span><strong>${percent(club.closeRate)}</strong><div class="row-sub">${number(club.closes)} closes</div></div>
        <div class="mini-kpi"><span>POS booking</span><strong>${percent(club.posBooking)}</strong><div class="row-sub">Target 50%+</div></div>
        <div class="mini-kpi"><span>Risk score</span><strong>${number(riskScore(club))}</strong><div class="row-sub">${risk.label}</div></div>
      </div>
      <div class="section-title">Recommended move</div>
      <div class="notice"><strong>${escapeHtml(nextMove(club))}</strong><br>Assign an owner and due date before leaving this review.</div>
      <div class="form-actions">
        <button class="button" type="button" data-create-club-action="${escapeHtml(`${area}::${club.name}`)}">Create follow-up</button>
        <button class="button secondary" type="button" data-plan-club-visit="${escapeHtml(`${area}::${club.name}`)}">Plan visit</button>
      </div>`;
    $("clubDrawer").showModal();
  }

  function renderVisitClubOptions() {
    const area = $("visitArea").value || areaNames()[0] || "";
    $("visitClub").innerHTML = (state.data.clubsByArea[area] || [])
      .map((club) => `<option value="${escapeHtml(club.name)}">${escapeHtml(club.name)}</option>`)
      .join("");
  }

  function renderVisits() {
    const visits = [...state.visits].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    $("visitList").innerHTML = visits.length
      ? visits
          .map(
            (visit) => `
              <div class="activity-row" style="grid-template-columns:minmax(0,1fr) auto">
                <div>
                  <div class="row-title">${escapeHtml(visit.club)}</div>
                  <div class="row-sub">${escapeHtml(visit.area)} • ${escapeHtml(visit.owner)} • ${escapeHtml(visit.date)}</div>
                </div>
                <button class="button ${visit.complete ? "secondary" : "ghost"}" type="button" data-toggle-visit="${escapeHtml(visit.id)}">${visit.complete ? "Completed" : "Complete"}</button>
              </div>`,
          )
          .join("")
      : '<div class="empty">No visits planned yet.</div>';

    const actions = [...state.actions].sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      return String(a.due || "").localeCompare(String(b.due || ""));
    });
    $("visitActions").innerHTML = actions.length
      ? actions
          .map(
            (action) => `
              <div class="activity-row" style="grid-template-columns:minmax(0,1.2fr) minmax(120px,.5fr) minmax(100px,.5fr) auto">
                <div><div class="row-title">${escapeHtml(action.title)}</div><div class="row-sub">${escapeHtml(action.club || "Regional")} • ${escapeHtml(action.source || "Club review")}</div></div>
                <div><div class="row-title">${escapeHtml(action.owner || "PTM")}</div><div class="row-sub">Owner</div></div>
                <div><div class="row-title">${escapeHtml(action.due || "No date")}</div><div class="row-sub">Due</div></div>
                <button class="button ${action.complete ? "secondary" : "ghost"}" type="button" data-toggle-action="${escapeHtml(action.id)}">${action.complete ? "Done" : "Complete"}</button>
              </div>`,
          )
          .join("")
      : '<div class="empty">No actions recorded yet.</div>';
    renderActionHealth();
    renderCadence();
    renderLocalSummary();
  }

  function planClubVisit(key) {
    const [area, ...parts] = String(key).split("::");
    const club = parts.join("::");
    $("clubDrawer").close();
    setRoute("visits");
    $("visitArea").value = area;
    renderVisitClubOptions();
    $("visitClub").value = club;
    $("visitDate").focus();
  }

  function createClubAction(key) {
    const [area, ...parts] = String(key).split("::");
    const club = parts.join("::");
    const clubData = (state.data.clubsByArea[area] || []).find((item) => item.name === club);
    if (!clubData) return;
    const due = new Date();
    due.setDate(due.getDate() + 2);
    state.actions.unshift({
      id: uid(),
      title: nextMove(clubData),
      club,
      area,
      owner: area,
      due: due.toISOString().slice(0, 10),
      source: "Club review",
      complete: false,
    });
    save(STORE.actions, state.actions);
    $("clubDrawer").close();
    renderAll();
    setRoute("visits");
  }

  function metricConfig(metric) {
    const configs = {
      eft: { label: "Projected EFT", target: "goal", format: money, copy: "Projected EFT versus target." },
      revActual: {
        label: "Projected revenue",
        target: "revGoal",
        format: money,
        copy: "Projected revenue versus goal.",
      },
      showRate: { label: "Show rate", targetValue: 60, format: percent, copy: "Show rate versus the 60% standard." },
      closeRate: { label: "Close rate", targetValue: 30, format: percent, copy: "Close rate versus the 30% standard." },
      posBooking: { label: "POS booking", targetValue: 50, format: percent, copy: "POS booking versus the 50% standard." },
    };
    return configs[metric] || configs.eft;
  }

  function renderPerformance() {
    const metric = $("performanceMetric").value;
    const config = metricConfig(metric);
    const areas = operatingAreas();
    const ratios = areas.map((area) => {
      const target = config.target ? Number(area[config.target] || 0) : config.targetValue;
      return target ? (Number(area[metric] || 0) / target) * 100 : 0;
    });
    const max = Math.max(110, ...ratios);
    $("performanceChartCopy").textContent = config.copy;
    $("metricTarget").textContent = config.targetValue
      ? `Target ${config.format(config.targetValue)}`
      : "Goal comparison";
    $("performanceBars").innerHTML = areas
      .map((area, index) => {
        const target = config.target ? Number(area[config.target] || 0) : config.targetValue;
        const actual = Number(area[metric] || 0);
        const ratio = target ? (actual / target) * 100 : 0;
        const tone = ratio >= 100 ? "var(--green)" : ratio >= 85 ? "var(--yellow)" : "var(--red)";
        return `
          <div class="metric-bar">
            <div class="bar-name">${escapeHtml(area.name)}</div>
            <div class="bar-track"><span style="--bar:${Math.min(100, (ratios[index] / max) * 100)}%;--bar-color:${tone}"></span></div>
            <div class="bar-value">${config.format(actual)} • ${Math.round(ratio)}%</div>
          </div>`;
      })
      .join("");

    const region = scopeMetric();
    const funnel = [
      { label: "Sets", value: Number(region.sets || 0), base: Number(region.sets || 1) },
      { label: "Shows", value: Number(region.shows || 0), base: Number(region.sets || 1) },
      { label: "Closes", value: Number(region.closes || 0), base: Number(region.sets || 1) },
    ];
    $("funnelSummary").innerHTML = funnel
      .map(
        (item) => `
          <div style="margin-bottom:18px">
            <div class="inline" style="justify-content:space-between"><span class="row-title">${item.label}</span><strong>${number(item.value)}</strong></div>
            <div class="progress"><span style="--progress:${Math.min(100, (item.value / item.base) * 100)}%;--progress-color:var(--aqua)"></span></div>
          </div>`,
      )
      .join("");

    $("performanceTable").innerHTML = areas
      .map(
        (area) => `
          <tr>
            <td><button class="table-action" type="button" data-select-area="${escapeHtml(area.name)}">${escapeHtml(area.name)}</button></td>
            <td class="numeric">${number(area.sets)}</td>
            <td class="numeric">${number(area.shows)}</td>
            <td class="numeric">${number(area.closes)}</td>
            <td class="numeric">${percent(area.showRate)}</td>
            <td class="numeric">${percent(area.closeRate)}</td>
            <td class="numeric">${percent(area.posBooking)}</td>
            <td class="numeric ${gap(area.eft, area.goal) < 0 ? "tone-red" : "tone-green"}">${money(gap(area.eft, area.goal))}</td>
            <td class="numeric ${gap(area.revActual, area.revGoal) < 0 ? "tone-red" : "tone-green"}">${money(gap(area.revActual, area.revGoal))}</td>
          </tr>`,
      )
      .join("");
  }

  function renderLocalSummary() {
    const openActions = state.actions.filter((action) => !action.complete).length;
    $("localRecordSummary").textContent = `${state.visits.length} visits • ${state.actions.length} actions • ${openActions} open`;
  }

  function renderSourceState() {
    $("sideSourceState").textContent =
      state.source === "Live" ? "Live data connected" : "Snapshot ready";
    $("sideSourceMeta").textContent = state.lastSync
      ? `Refreshed ${state.lastSync.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "Regional snapshot • refresh from Settings";
    $("freshnessStatus").textContent = state.source;
    $("freshnessStatus").className = `status ${state.source === "Live" ? "green" : ""}`;
  }

  function renderAll() {
    populateAreaControls();
    renderTodayKpis();
    renderAttention();
    renderCadence();
    renderActionHealth();
    renderAreaScorecard();
    renderRecentActivity();
    renderClubs();
    renderVisits();
    renderPerformance();
    renderSourceState();
    renderLocalSummary();
  }

  function download(name, text, type = "text/csv") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportClubView() {
    const rows = [
      ["Club", "Area", "Risk", "EFT", "EFT Goal", "EFT Gap", "Revenue", "Revenue Goal", "Revenue Gap", "Show Rate", "Close Rate", "POS Booking", "Next Move"],
      ...filteredClubs().map((club) => [
        club.name,
        club.area,
        riskFor(club).label,
        club.eft,
        club.goal,
        gap(club.eft, club.goal),
        club.revActual,
        club.revGoal,
        gap(club.revActual, club.revGoal),
        club.showRate,
        club.closeRate,
        club.posBooking,
        nextMove(club),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");
    download(`ptr4-clubs-${today()}.csv`, csv);
  }

  function exportLocal() {
    download(
      `ptr4-local-records-${today()}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), visits: state.visits, actions: state.actions }, null, 2),
      "application/json",
    );
  }

  function parseCsvLine(line = "") {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  }

  function csvRows(text = "") {
    return String(text)
      .replace(/^\ufeff/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map(parseCsvLine);
  }

  function clean(value = "") {
    return String(value ?? "").trim();
  }

  function metricNumber(value) {
    const raw = clean(value);
    if (!raw || /^#(DIV\/0!|VALUE!|N\/A|REF!)/i.test(raw)) return 0;
    const negative = /^\(.*\)$/.test(raw);
    const parsed = Number(raw.replace(/[,$%()]/g, "").replace(/,/g, ""));
    if (!Number.isFinite(parsed)) return 0;
    return negative ? -parsed : parsed;
  }

  function normalizeArea(name = "") {
    const value = clean(name).replace(/\s+/g, " ");
    if (/^STEPHON/i.test(value)) return "Stephon";
    if (/^DOMENICK/i.test(value)) return "Domenick";
    if (/^NATHAN/i.test(value)) return "Nathan";
    if (/^NOLA/i.test(value) || /open.*nola/i.test(value)) return "Open - NOLA";
    if (/^OZARKS/i.test(value) || /open.*ozarks/i.test(value)) return "Open - Ozarks";
    if (/central louisiana/i.test(value)) return "Open - Central Louisiana";
    if (/florida/i.test(value) && /stephon/i.test(value)) return "Stephon";
    if (/georgia/i.test(value) && /domenick/i.test(value)) return "Domenick";
    if (/(kentucky|tennessee|north carolina)/i.test(value) && /nathan/i.test(value))
      return "Nathan";
    return value;
  }

  function rowIndex(rows) {
    const indexes = {};
    rows.forEach((row, index) => {
      const label = clean(row[1] || row[0]).toUpperCase();
      if (label && indexes[label] == null) indexes[label] = index;
    });
    return indexes;
  }

  function readRow(rows, indexes, label, columns) {
    const index = indexes[String(label).toUpperCase()];
    if (index == null) return columns.map(() => 0);
    return columns.map((column) => metricNumber((rows[index] || [])[column]));
  }

  function parseAreaSummary(rows) {
    const headerIndex = rows.findIndex(
      (row) =>
        clean(row[1]).toUpperCase() === "AREA" &&
        row.slice(2).some((cell) => /STEPHON|DOMENICK|NATHAN|NOLA|OZARKS|CENTRAL/i.test(cell)),
    );
    if (headerIndex < 0) return null;
    const columns = [];
    for (let column = 2; column < rows[headerIndex].length; column += 1) {
      const name = normalizeArea(rows[headerIndex][column]);
      if (!name) break;
      columns.push({ column, name });
    }
    const indexes = rowIndex(rows);
    const cols = columns.map((item) => item.column);
    const values = {
      eft: readRow(rows, indexes, "PROJ EFT NEXT MONTH", cols),
      goal: readRow(rows, indexes, "PROJ EFT MONTH START", cols),
      tav: readRow(rows, indexes, "GROSS SOLD", cols),
      dp: readRow(rows, indexes, "DOWN PAYMENT", cols),
      sets: readRow(rows, indexes, "FC'S", cols),
      shows: readRow(rows, indexes, "FC SHOWS", cols),
      closes: readRow(rows, indexes, "DEALS", cols),
      showRate: readRow(rows, indexes, "FC SHOW %", cols),
      closeRate: readRow(rows, indexes, "FC CLOSING %", cols),
      posBooking: readRow(rows, indexes, "FC BOOKING %", cols),
      revActual: readRow(rows, indexes, "REVENUE PROJECTED", cols),
      revGoal: readRow(rows, indexes, "REVENUE GOAL", cols),
    };
    return columns.map((item, index) => {
      const area = { name: item.name };
      Object.entries(values).forEach(([key, list]) => {
        area[key] = list[index] || 0;
      });
      area.revGap = gap(area.revActual, area.revGoal);
      return area;
    });
  }

  function parseClubBlocks(rows) {
    const clubsByArea = {};
    for (let index = 0; index < rows.length; index += 1) {
      const joined = rows[index].join(" ");
      if (!/(Florida|Georgia|Kentucky|Tennessee|North Carolina|NOLA|Ozarks|Central Louisiana)/i.test(joined))
        continue;
      if (!/(Stephon|Domenick|Nathan|Ozarks|NOLA|Central Louisiana|OPEN)/i.test(joined))
        continue;
      const rawArea =
        rows[index].find((cell) =>
          /(Florida|Georgia|Kentucky|Tennessee|North Carolina|NOLA|Ozarks|Central Louisiana)/i.test(
            cell,
          ),
        ) || "";
      const area = normalizeArea(rawArea);
      const relativeHeader = rows
        .slice(index, index + 12)
        .findIndex((row) => clean(row[1]).toUpperCase() === "CLUB");
      if (!area || relativeHeader < 0) continue;
      const start = index + relativeHeader;
      const columns = [];
      for (let column = 2; column < rows[start].length; column += 1) {
        const name = clean(rows[start][column]).replace(/\s+\($/, "").replace(/\s+/g, " ");
        if (!name || /CLUBS?/i.test(name)) break;
        columns.push({ column, name });
      }
      if (!columns.length) continue;
      let end = rows.length;
      for (let probe = start + 1; probe < rows.length; probe += 1) {
        const text = rows[probe].join(" ");
        if (
          probe > start + 8 &&
          /(Florida|Georgia|Kentucky|Tennessee|North Carolina|NOLA|Ozarks|Central Louisiana)/i.test(
            text,
          ) &&
          /(Stephon|Domenick|Nathan|Ozarks|NOLA|Central Louisiana|OPEN)/i.test(text)
        ) {
          end = probe;
          break;
        }
      }
      const block = rows.slice(start, end);
      const indexes = rowIndex(block);
      const cols = columns.map((item) => item.column);
      const values = {
        eft: readRow(block, indexes, "CURRENT PROJ EFT NEXT MONTH", cols),
        goal: readRow(block, indexes, "PROJ EFT NEXT MONTH START", cols),
        tav: readRow(block, indexes, "GROSS SOLD", cols),
        dp: readRow(block, indexes, "DOWN PAYMENT", cols),
        sets: readRow(block, indexes, "FC'S", cols),
        shows: readRow(block, indexes, "FC SHOWS", cols),
        closes: readRow(block, indexes, "DEALS", cols),
        showRate: readRow(block, indexes, "FC SHOW %", cols),
        closeRate: readRow(block, indexes, "FC CLOSING %", cols),
        posBooking: readRow(block, indexes, "FC BOOKING %", cols),
        revActual: readRow(block, indexes, "REVENUE PROJECTED", cols),
        revGoal: readRow(block, indexes, "REVENUE GOAL", cols),
      };
      clubsByArea[area] = columns.map((item, valueIndex) => {
        const club = { area, name: item.name };
        Object.entries(values).forEach(([key, list]) => {
          club[key] = list[valueIndex] || 0;
        });
        club.revGap = gap(club.revActual, club.revGoal);
        return club;
      });
      index = end - 1;
    }
    return clubsByArea;
  }

  function summarizeRegion(areas) {
    const region = {
      eft: 0,
      goal: 0,
      tav: 0,
      dp: 0,
      sets: 0,
      shows: 0,
      closes: 0,
      revActual: 0,
      revGoal: 0,
      showRate: 0,
      closeRate: 0,
      posBooking: 0,
    };
    areas.forEach((area) => {
      ["eft", "goal", "tav", "dp", "sets", "shows", "closes", "revActual", "revGoal"].forEach(
        (key) => {
          region[key] += Number(area[key] || 0);
        },
      );
    });
    region.showRate = region.sets ? (region.shows / region.sets) * 100 : 0;
    region.closeRate = region.shows ? (region.closes / region.shows) * 100 : 0;
    region.revGap = gap(region.revActual, region.revGoal);
    return region;
  }

  function parseTrackerCsv(text) {
    const rows = csvRows(text);
    const areas = parseAreaSummary(rows);
    const clubsByArea = parseClubBlocks(rows);
    if (!areas?.length || !Object.keys(clubsByArea).length) {
      throw new Error("The feed did not match the expected PTR4 tracker layout.");
    }
    return { areas, clubsByArea, region: summarizeRegion(areas), defaultCsvUrl: state.data.defaultCsvUrl };
  }

  function normalizeCsvUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.includes("/pubhtml")) {
      return raw.replace("/pubhtml", "/pub?gid=0&single=true&output=csv");
    }
    if (/docs\.google\.com\/spreadsheets\/d\/e\//i.test(raw)) {
      const url = new URL(raw);
      url.searchParams.set("output", "csv");
      if (!url.searchParams.has("gid")) url.searchParams.set("gid", "0");
      if (!url.searchParams.has("single")) url.searchParams.set("single", "true");
      return url.toString();
    }
    if (/docs\.google\.com\/spreadsheets\/d\//i.test(raw)) {
      return `${raw.split("#")[0].split("?")[0].replace(/\/$/, "")}/export?format=csv`;
    }
    return raw;
  }

  async function refreshData() {
    const feedback = $("dataFeedback");
    const url = normalizeCsvUrl($("csvUrl").value);
    if (!url) {
      feedback.textContent = "Add a published CSV URL first.";
      feedback.className = "feedback error";
      return;
    }
    feedback.textContent = "Refreshing the regional feed…";
    feedback.className = "feedback";
    $("quickRefresh").disabled = true;
    $("refreshCsv").disabled = true;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Feed returned ${response.status}.`);
      state.data = parseTrackerCsv(await response.text());
      state.source = "Live";
      state.lastSync = new Date();
      localStorage.setItem(STORE.csvUrl, url);
      renderAll();
      feedback.textContent = "Live regional data refreshed.";
      feedback.className = "feedback success";
    } catch (error) {
      feedback.textContent = `Refresh failed. The saved snapshot is still active. ${error.message}`;
      feedback.className = "feedback error";
    } finally {
      $("quickRefresh").disabled = false;
      $("refreshCsv").disabled = false;
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const route = event.target.closest("[data-route]");
      if (route) {
        setRoute(route.dataset.route);
        return;
      }
      const club = event.target.closest("[data-open-club]");
      if (club) {
        openClubDrawer(club.dataset.openClub);
        return;
      }
      const area = event.target.closest("[data-select-area]");
      if (area) {
        state.selectedArea = area.dataset.selectArea;
        $("globalArea").value = state.selectedArea;
        $("clubAreaFilter").value = state.selectedArea;
        updateAreaUrl();
        renderAll();
        setRoute("clubs");
        return;
      }
      const createAction = event.target.closest("[data-create-club-action]");
      if (createAction) {
        createClubAction(createAction.dataset.createClubAction);
        return;
      }
      const planVisit = event.target.closest("[data-plan-club-visit]");
      if (planVisit) {
        planClubVisit(planVisit.dataset.planClubVisit);
        return;
      }
      const toggleVisit = event.target.closest("[data-toggle-visit]");
      if (toggleVisit) {
        const visit = state.visits.find((item) => item.id === toggleVisit.dataset.toggleVisit);
        if (visit) visit.complete = !visit.complete;
        save(STORE.visits, state.visits);
        renderVisits();
        return;
      }
      const toggleAction = event.target.closest("[data-toggle-action]");
      if (toggleAction) {
        const action = state.actions.find((item) => item.id === toggleAction.dataset.toggleAction);
        if (action) action.complete = !action.complete;
        save(STORE.actions, state.actions);
        renderVisits();
      }
    });

    window.addEventListener("hashchange", () =>
      setRoute(location.hash.replace("#", "") || "today", false),
    );
    $("globalArea").addEventListener("change", () => {
      state.selectedArea = $("globalArea").value;
      $("clubAreaFilter").value = state.selectedArea;
      updateAreaUrl();
      renderAll();
    });
    ["clubSearch", "clubAreaFilter", "clubRiskFilter", "clubSort"].forEach((id) => {
      $(id).addEventListener(id === "clubSearch" ? "input" : "change", renderClubs);
    });
    $("visitArea").addEventListener("change", renderVisitClubOptions);
    $("performanceMetric").addEventListener("change", renderPerformance);
    $("closeClubDrawer").addEventListener("click", () => $("clubDrawer").close());
    $("clubDrawer").addEventListener("click", (event) => {
      if (event.target === $("clubDrawer")) $("clubDrawer").close();
    });
    $("exportClubs").addEventListener("click", exportClubView);
    $("exportLocal").addEventListener("click", exportLocal);
    $("quickRefresh").addEventListener("click", refreshData);
    $("refreshCsv").addEventListener("click", refreshData);
    $("restoreSnapshot").addEventListener("click", () => {
      state.data = clone(SNAPSHOT);
      state.source = "Snapshot";
      state.lastSync = null;
      renderAll();
      $("dataFeedback").textContent = "Saved regional snapshot restored.";
      $("dataFeedback").className = "feedback success";
    });
    $("clearLocal").addEventListener("click", () => {
      if (!confirm("Clear all visits and actions saved on this device?")) return;
      state.visits = [];
      state.actions = [];
      save(STORE.visits, state.visits);
      save(STORE.actions, state.actions);
      renderAll();
    });
    $("visitForm").addEventListener("reset", () => {
      setTimeout(() => {
        $("visitDate").value = today();
        $("visitFeedback").textContent = "";
      });
    });
    $("visitForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const visit = {
        id: uid(),
        area: $("visitArea").value,
        club: $("visitClub").value,
        date: $("visitDate").value,
        owner: $("visitOwner").value.trim(),
        priority: $("visitPriority").value,
        followup: $("visitFollowup").value,
        notes: $("visitNotes").value.trim(),
        complete: false,
      };
      state.visits.push(visit);
      if (visit.followup) {
        state.actions.push({
          id: uid(),
          title: `Complete ${visit.club} visit follow-up`,
          area: visit.area,
          club: visit.club,
          owner: visit.owner,
          due: visit.followup,
          source: "Visit",
          complete: false,
        });
      }
      save(STORE.visits, state.visits);
      save(STORE.actions, state.actions);
      $("visitFeedback").textContent = `${visit.club} visit saved.`;
      $("visitFeedback").className = "feedback success";
      $("visitNotes").value = "";
      renderVisits();
    });
  }

  function init() {
    $("csvUrl").value =
      localStorage.getItem(STORE.csvUrl) || SNAPSHOT.defaultCsvUrl || "";
    $("visitDate").value = today();
    bindEvents();
    renderAll();
    setRoute(location.hash.replace("#", "") || "today", false);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
