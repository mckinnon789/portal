(() => {
  "use strict";

  const STORE_KEY = "pt_eft_command_center_fixed";
  const DATA = window.PTR4_DATA || { clubsByArea: {} };
  const REASONS = {
    sale: ["New EFT", "Upgrade", "Upsell", "Winback", "Other"],
    cancel: [
      "Moved",
      "Medical",
      "Financial",
      "No Usage / No Time",
      "Expectation / Service Issue",
      "Transferred Out",
      "Other",
    ],
    delinquency: [
      "Card Declined",
      "Insufficient Funds",
      "Expired Card",
      "No Response",
      "Pending Collections",
      "Stopped Training / Ghosted",
      "Other",
    ],
    chargeback: ["Chargeback / Dispute", "Fraud Claim", "Bank Reversal", "Other"],
    recovered: ["Paid Current", "Paid Past Due", "Reinstated", "Chargeback Resolved", "Other"],
  };
  const TYPE_LABELS = {
    sale: "EFT added",
    cancel: "Hard loss",
    delinquency: "Delinquency",
    chargeback: "Chargeback",
    recovered: "Recovered",
  };

  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toISOString().slice(0, 10);
  const money = (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const clubCatalog = Object.entries(DATA.clubsByArea || {}).flatMap(([area, clubs]) =>
    clubs.map((club) => ({
      area,
      name: club.name,
      startingEFT: Number(club.eft || 0),
      goal: Number(club.goal || 0),
    })),
  );
  const areas = [...new Set(clubCatalog.map((club) => club.area))];

  function newState() {
    const clubData = {};
    clubCatalog.forEach((club) => {
      clubData[club.name] = {
        area: club.area,
        startingEFT: club.startingEFT,
        goal: club.goal,
        entries: [],
      };
    });
    return { version: 2, clubData };
  }

  function loadState() {
    const base = newState();
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!saved?.clubData) return base;
      const savedByNorm = Object.fromEntries(
        Object.entries(saved.clubData).map(([name, data]) => [normalize(name), data]),
      );
      clubCatalog.forEach((club) => {
        const previous = savedByNorm[normalize(club.name)];
        if (!previous) return;
        base.clubData[club.name] = {
          area: club.area,
          startingEFT: Number(previous.startingEFT ?? club.startingEFT),
          goal: Number(previous.goal ?? club.goal),
          entries: Array.isArray(previous.entries) ? previous.entries : [],
        };
      });
      return base;
    } catch {
      return base;
    }
  }

  let state = loadState();
  let lastEntryId = null;

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function startOfMonth() {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  }

  function startOfWeek() {
    const date = new Date();
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return date.toISOString().slice(0, 10);
  }

  function lastSeven() {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return date.toISOString().slice(0, 10);
  }

  function applyPreset() {
    const preset = $("datePreset").value;
    if (preset === "month") {
      $("filterStart").value = startOfMonth();
      $("filterEnd").value = today();
    } else if (preset === "week") {
      $("filterStart").value = startOfWeek();
      $("filterEnd").value = today();
    } else if (preset === "closeout") {
      $("filterStart").value = lastSeven();
      $("filterEnd").value = today();
    } else if (preset === "all") {
      $("filterStart").value = "";
      $("filterEnd").value = "";
    }
    render();
  }

  function inRange(date) {
    const start = $("filterStart").value;
    const end = $("filterEnd").value;
    return (!start || date >= start) && (!end || date <= end);
  }

  function activeClubs() {
    const area = $("areaFilter").value;
    return clubCatalog.filter((club) => area === "All" || club.area === area);
  }

  function totalsFor(clubName) {
    const data = state.clubData[clubName];
    const totals = {
      sale: 0,
      cancel: 0,
      delinquency: 0,
      chargeback: 0,
      recovered: 0,
      reasons: {},
    };
    (data.entries || []).filter((entry) => inRange(entry.date)).forEach((entry) => {
      if (totals[entry.type] != null) totals[entry.type] += Number(entry.amount || 0);
      if (["cancel", "delinquency", "chargeback"].includes(entry.type)) {
        totals.reasons[entry.reason] =
          Number(totals.reasons[entry.reason] || 0) + Number(entry.amount || 0);
      }
    });
    totals.soft = totals.delinquency + totals.chargeback;
    totals.net = totals.sale - totals.cancel - totals.soft + totals.recovered;
    totals.projected = Number(data.startingEFT || 0) + totals.net;
    totals.gap = totals.projected - Number(data.goal || 0);
    return totals;
  }

  function regionTotals() {
    return activeClubs().reduce(
      (acc, club) => {
        const totals = totalsFor(club.name);
        const data = state.clubData[club.name];
        acc.start += Number(data.startingEFT || 0);
        acc.goal += Number(data.goal || 0);
        ["sale", "cancel", "soft", "recovered", "projected"].forEach((key) => {
          acc[key] += Number(totals[key] || 0);
        });
        Object.entries(totals.reasons).forEach(([reason, amount]) => {
          acc.reasons[reason] = Number(acc.reasons[reason] || 0) + Number(amount || 0);
        });
        return acc;
      },
      {
        start: 0,
        goal: 0,
        sale: 0,
        cancel: 0,
        soft: 0,
        recovered: 0,
        projected: 0,
        reasons: {},
      },
    );
  }

  function renderKpis() {
    const totals = regionTotals();
    const values = [
      ["Baseline", money(totals.start), "Starting EFT"],
      ["EFT added", money(totals.sale), "New and upgraded"],
      ["Hard loss", money(totals.cancel), "Confirmed cancels"],
      ["Soft exposure", money(totals.soft), "Delinquency + chargebacks"],
      ["Recovered", money(totals.recovered), "Returned to current"],
      [
        "Projected EFT",
        money(totals.projected),
        `${totals.projected - totals.goal >= 0 ? "Ahead" : "Behind"} ${money(Math.abs(totals.projected - totals.goal))}`,
      ],
    ];
    $("eftKpis").innerHTML = values
      .map(
        ([label, value, meta]) => `
          <div class="tracker-kpi">
            <span>${label}</span>
            <strong>${value}</strong>
            <div class="row-sub">${meta}</div>
          </div>`,
      )
      .join("");
  }

  function renderExceptions() {
    const clubs = activeClubs().map((club) => ({ club, totals: totalsFor(club.name) }));
    const biggestLoss = [...clubs].sort(
      (a, b) => b.totals.cancel + b.totals.soft - (a.totals.cancel + a.totals.soft),
    )[0];
    const biggestGain = [...clubs].sort((a, b) => b.totals.sale - a.totals.sale)[0];
    const biggestRecovery = [...clubs].sort(
      (a, b) => b.totals.recovered - a.totals.recovered,
    )[0];
    const cards = [
      {
        label: "Largest loss exposure",
        club: biggestLoss?.club.name || "No entries",
        value: money((biggestLoss?.totals.cancel || 0) + (biggestLoss?.totals.soft || 0)),
        copy: "Hard and soft loss combined",
      },
      {
        label: "Largest EFT gain",
        club: biggestGain?.club.name || "No entries",
        value: money(biggestGain?.totals.sale || 0),
        copy: "New EFT in the selected period",
      },
      {
        label: "Largest recovery",
        club: biggestRecovery?.club.name || "No entries",
        value: money(biggestRecovery?.totals.recovered || 0),
        copy: "Recovered EFT in the period",
      },
    ];
    $("eftExceptions").innerHTML = cards
      .map(
        (card) => `
          <article class="exception-card">
            <div class="kpi-label">${card.label}</div>
            <h3 style="margin-top:12px">${escapeHtml(card.club)}</h3>
            <strong>${card.value}</strong>
            <p>${card.copy}</p>
          </article>`,
      )
      .join("");

    const reasons = Object.entries(regionTotals().reasons).sort((a, b) => b[1] - a[1]);
    const max = reasons[0]?.[1] || 1;
    $("reasonRollup").innerHTML = reasons.length
      ? reasons
          .slice(0, 6)
          .map(
            ([reason, amount]) => `
              <div style="margin-bottom:13px">
                <div class="inline" style="justify-content:space-between"><span class="row-title">${escapeHtml(reason)}</span><span class="bar-value">${money(amount)}</span></div>
                <div class="progress"><span style="--progress:${(amount / max) * 100}%;--progress-color:var(--red)"></span></div>
              </div>`,
          )
          .join("")
      : '<div class="empty">Loss reasons appear after ledger entries are added.</div>';
  }

  function renderClubTable() {
    const clubs = activeClubs()
      .map((club) => ({ ...club, totals: totalsFor(club.name) }))
      .sort((a, b) => a.totals.gap - b.totals.gap);
    $("eftClubTable").innerHTML = clubs
      .map((club) => {
        const totals = club.totals;
        const direction =
          totals.gap >= 0
            ? '<span class="status green">On pace</span>'
            : totals.gap >= -500
              ? '<span class="status yellow">Watch</span>'
              : '<span class="status red">Recover</span>';
        return `
          <tr>
            <td><button class="table-action" type="button" data-select-club="${escapeHtml(`${club.area}::${club.name}`)}">${escapeHtml(club.name)}</button></td>
            <td>${escapeHtml(club.area)}</td>
            <td class="numeric">${money(state.clubData[club.name].startingEFT)}</td>
            <td class="numeric tone-green">${money(totals.sale)}</td>
            <td class="numeric tone-red">${money(totals.cancel)}</td>
            <td class="numeric tone-yellow">${money(totals.soft)}</td>
            <td class="numeric tone-green">${money(totals.recovered)}</td>
            <td class="numeric">${money(totals.projected)}</td>
            <td class="numeric ${totals.gap >= 0 ? "tone-green" : "tone-red"}">${money(totals.gap)}</td>
            <td>${direction}</td>
          </tr>`;
      })
      .join("");
  }

  function entriesInView() {
    const allowed = new Set(activeClubs().map((club) => club.name));
    return Object.entries(state.clubData)
      .flatMap(([club, data]) =>
        (data.entries || []).map((entry) => ({ ...entry, club, area: data.area })),
      )
      .filter((entry) => allowed.has(entry.club) && inRange(entry.date))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function renderLog() {
    const entries = entriesInView();
    $("eftLogBody").innerHTML = entries.length
      ? entries
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.date)}</td>
                <td>${escapeHtml(entry.club)}</td>
                <td>${escapeHtml(entry.area)}</td>
                <td>${escapeHtml(TYPE_LABELS[entry.type] || entry.type)}</td>
                <td>${escapeHtml(entry.reason)}</td>
                <td class="numeric">${money(entry.amount)}</td>
                <td>${escapeHtml(entry.note || "—")}</td>
                <td><button class="button ghost" type="button" data-delete-entry="${escapeHtml(entry.id)}">Delete</button></td>
              </tr>`,
          )
          .join("")
      : '<tr><td colspan="8"><div class="empty">No ledger entries in this period.</div></td></tr>';
  }

  function render() {
    renderKpis();
    renderExceptions();
    renderClubTable();
    renderLog();
    const preset = $("datePreset").selectedOptions[0]?.textContent || "Custom";
    $("periodSummary").textContent = `${preset} • ${activeClubs().length} clubs`;
  }

  function populateControls() {
    const areaOptions = areas
      .map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`)
      .join("");
    $("areaFilter").innerHTML = `<option value="All">Entire region</option>${areaOptions}`;
    $("entryArea").innerHTML = areaOptions;
    renderEntryClubs();
    renderReasons();
  }

  function renderEntryClubs() {
    const area = $("entryArea").value || areas[0];
    $("entryClub").innerHTML = clubCatalog
      .filter((club) => club.area === area)
      .map((club) => `<option value="${escapeHtml(club.name)}">${escapeHtml(club.name)}</option>`)
      .join("");
  }

  function renderReasons() {
    $("entryReason").innerHTML = REASONS[$("entryType").value]
      .map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`)
      .join("");
  }

  function addEntry(event) {
    event.preventDefault();
    const club = $("entryClub").value;
    const amount = Number($("entryAmount").value || 0);
    const feedback = $("entryFeedback");
    if (!club || amount <= 0) {
      feedback.textContent = "Choose a club and enter an amount greater than zero.";
      feedback.className = "feedback error";
      return;
    }
    const entry = {
      id: uid(),
      type: $("entryType").value,
      reason: $("entryReason").value,
      amount,
      date: $("entryDate").value || today(),
      note: $("entryNote").value.trim(),
    };
    state.clubData[club].entries.push(entry);
    lastEntryId = entry.id;
    saveState();
    $("entryAmount").value = "";
    $("entryNote").value = "";
    $("undoEntry").disabled = false;
    feedback.textContent = `${money(amount)} ${TYPE_LABELS[entry.type].toLowerCase()} saved for ${club}.`;
    feedback.className = "feedback success";
    render();
  }

  function deleteEntry(id) {
    Object.values(state.clubData).some((club) => {
      const index = (club.entries || []).findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      club.entries.splice(index, 1);
      return true;
    });
    if (lastEntryId === id) {
      lastEntryId = null;
      $("undoEntry").disabled = true;
    }
    saveState();
    render();
  }

  function undoEntry() {
    if (!lastEntryId) return;
    deleteEntry(lastEntryId);
    $("entryFeedback").textContent = "The last movement was removed.";
    $("entryFeedback").className = "feedback success";
  }

  function exportLedger() {
    const blob = new Blob(
      [
        JSON.stringify(
          { version: 2, exportedAt: new Date().toISOString(), state },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ptr4-eft-ledger-${today()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function syncBaseline() {
    clubCatalog.forEach((club) => {
      state.clubData[club.name].startingEFT = club.startingEFT;
      state.clubData[club.name].goal = club.goal;
    });
    saveState();
    render();
    $("settingsFeedback").textContent = "Club baselines and goals synced from the portal snapshot.";
    $("settingsFeedback").className = "feedback success";
  }

  async function importLedger(file) {
    const feedback = $("settingsFeedback");
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed.state || parsed;
      if (!incoming?.clubData) throw new Error("This file does not contain an EFT ledger.");
      localStorage.setItem(STORE_KEY, JSON.stringify(incoming));
      state = loadState();
      render();
      feedback.textContent = "EFT backup imported.";
      feedback.className = "feedback success";
    } catch (error) {
      feedback.textContent = error.message;
      feedback.className = "feedback error";
    }
  }

  function bindEvents() {
    $("entryForm").addEventListener("submit", addEntry);
    $("entryArea").addEventListener("change", renderEntryClubs);
    $("entryType").addEventListener("change", renderReasons);
    $("datePreset").addEventListener("change", applyPreset);
    ["filterStart", "filterEnd", "areaFilter"].forEach((id) =>
      $(id).addEventListener("change", render),
    );
    $("undoEntry").addEventListener("click", undoEntry);
    $("exportEft").addEventListener("click", exportLedger);
    $("syncBaseline").addEventListener("click", syncBaseline);
    $("clearEft").addEventListener("click", () => {
      if (!confirm("Clear all EFT ledger entries and restore snapshot baselines?")) return;
      state = newState();
      saveState();
      render();
    });
    $("importEft").addEventListener("change", () => {
      const [file] = $("importEft").files;
      if (file) importLedger(file);
    });
    document.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-delete-entry]");
      if (remove) deleteEntry(remove.dataset.deleteEntry);
      const club = event.target.closest("[data-select-club]");
      if (club) {
        const [area, ...parts] = club.dataset.selectClub.split("::");
        $("entryArea").value = area;
        renderEntryClubs();
        $("entryClub").value = parts.join("::");
        $("entryAmount").focus();
      }
    });
  }

  function init() {
    populateControls();
    $("entryDate").value = today();
    $("filterStart").value = startOfMonth();
    $("filterEnd").value = today();
    bindEvents();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
