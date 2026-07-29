(() => {
  "use strict";

  const STORAGE_EXCLUDED = "tis_v14_excluded";
  const STORAGE_HIDE_PTMS = "tis_v14_hide_ptms";
  const STORAGE_ALIASES = "tis_v14_aliases";
  const DEFAULT_ALIASES = {
    "jonathan sine": "jonathan d sine",
    "jayson stinson": "jayson m stinson",
    "jeziel carrasquillo": "jeziel o carrasquillo silva",
    "fernando dallacqua": "fernando h dallacqua",
    "viviane cordeiro": "viviane k cordeiro",
    "jeff mera": "jeff l mera",
    "sarah pau": "sarah k pau",
    "mike hassett": "michael t hassett",
    "rene claure": "rene claure",
    "rafaelle zen": "rafaelle zen",
    "alexandria stinson": "alexandria d stinson",
    "alex d stinson": "alexandria d stinson",
    "alex stinson": "alexandria d stinson",
    "stinson alexandria": "alexandria d stinson"
  };
  const NICK_GROUPS = [
    ["mike", "michael"],
    ["jon", "jonathan"],
    ["jeff", "jeffrey"],
    ["jay", "jayson"],
    ["alex", "alexandria", "alexander"],
    ["sam", "samuel", "samantha"],
    ["chris", "christopher", "christina"],
    ["ren", "rene"]
  ];
  const NICK_MAP = (() => {
    const map = {};
    NICK_GROUPS.forEach((group) => group.forEach((name) => {
      map[name] = group[group.length - 1];
    }));
    return map;
  })();

  const $ = (id) => document.getElementById(id);
  const safeParse = (value, fallback) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  const download = (name, content, type) => {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  };

  let appRows = [];
  let matchReview = [];
  let excluded = new Set(safeParse(localStorage.getItem(STORAGE_EXCLUDED), []));
  let aliasMap = { ...safeParse(localStorage.getItem(STORAGE_ALIASES), {}) };

  function norm(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[’'`.-]/g, " ")
      .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toDisplayName(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (!raw.includes(",")) return raw.replace(/\s+/g, " ").trim();
    const [last, rest] = raw.split(",", 2);
    return `${rest} ${last}`.replace(/\s+/g, " ").trim();
  }

  function tokens(value) {
    return norm(value).split(" ").filter(Boolean);
  }

  function levenshtein(a, b) {
    const left = norm(a);
    const right = norm(b);
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    const grid = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let index = 0; index <= left.length; index += 1) grid[index][0] = index;
    for (let index = 0; index <= right.length; index += 1) grid[0][index] = index;
    for (let row = 1; row <= left.length; row += 1) {
      for (let column = 1; column <= right.length; column += 1) {
        grid[row][column] = Math.min(
          grid[row - 1][column] + 1,
          grid[row][column - 1] + 1,
          grid[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
        );
      }
    }
    return grid[left.length][right.length];
  }

  function similarity(a, b) {
    const left = norm(a);
    const right = norm(b);
    if (!left && !right) return 1;
    return 1 - levenshtein(left, right) / Math.max(left.length, right.length, 1);
  }

  function scoreName(source, target, sourceClub = "", targetClub = "") {
    const sourceTokens = tokens(source);
    const targetTokens = tokens(target);
    if (!sourceTokens.length || !targetTokens.length) return 0;
    const sourceSet = new Set(sourceTokens);
    const targetSet = new Set(targetTokens);
    let intersection = 0;
    sourceSet.forEach((token) => {
      if (targetSet.has(token)) intersection += 1;
    });
    const union = new Set([...sourceTokens, ...targetTokens]).size || 1;
    const sourceFirst = NICK_MAP[sourceTokens[0]] || sourceTokens[0];
    const targetFirst = NICK_MAP[targetTokens[0]] || targetTokens[0];
    const sourceLast = sourceTokens[sourceTokens.length - 1];
    const targetLast = targetTokens[targetTokens.length - 1];
    let score = similarity(source, target) * 55 + (intersection / union) * 20;
    if (sourceFirst === targetFirst) score += 12;
    if (sourceLast === targetLast) score += 16;
    if (sourceTokens.length >= 2 && targetTokens.length >= 2 && sourceTokens[0][0] === targetTokens[0][0]) score += 3;
    if (sourceClub && targetClub && norm(sourceClub) === norm(targetClub)) score += 4;
    return Math.round(Math.min(100, score));
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    $("log").textContent += `${line}\n`;
    $("log").scrollTop = $("log").scrollHeight;
  }

  function setPill(state, text) {
    const pill = $("loaderPill");
    pill.className = `status ${state === "error" ? "red" : state === "loading" ? "yellow" : "green"}`;
    pill.textContent = text;
  }

  function setWorkflowStep(phase) {
    [1, 2, 3, 4].forEach((number) => {
      const step = $(`workflow${number}`);
      step.classList.toggle("complete", number < phase);
      step.classList.toggle("active", number === phase);
    });
  }

  function saveState() {
    localStorage.setItem(STORAGE_EXCLUDED, JSON.stringify([...excluded]));
    localStorage.setItem(STORAGE_HIDE_PTMS, JSON.stringify($("hidePTMs").checked));
    localStorage.setItem(STORAGE_ALIASES, JSON.stringify(aliasMap));
  }

  function updateFileState() {
    const timeFile = $("timeFile").files[0];
    const commissionFiles = [...$("commFiles").files];
    const ready = Boolean(timeFile && commissionFiles.length);
    $("fileState").textContent = ready
      ? `${timeFile.name} + ${commissionFiles.length} commission file${commissionFiles.length === 1 ? "" : "s"} ready.`
      : "Choose one time report and at least one commission report.";
    $("fileState").classList.remove("inline-error");
    $("processBtn").disabled = !ready;
    $("exportBtn").disabled = true;
    setWorkflowStep(ready ? 2 : 1);
  }

  function excelSerialToDate(serial) {
    const value = Number(serial);
    if (!Number.isFinite(value)) return null;
    const utcDays = Math.floor(value - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    const fractionalDay = value - Math.floor(value) + 1e-10;
    let totalSeconds = Math.floor(86400 * fractionalDay);
    const seconds = totalSeconds % 60;
    totalSeconds = Math.floor(totalSeconds / 60);
    const minutes = totalSeconds % 60;
    const hours = Math.floor(totalSeconds / 60) % 24;
    return new Date(
      dateInfo.getUTCFullYear(),
      dateInfo.getUTCMonth(),
      dateInfo.getUTCDate(),
      hours,
      minutes,
      seconds
    );
  }

  function parseExcelDate(value) {
    if (value instanceof Date) return value;
    if (typeof value === "number") return excelSerialToDate(value);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async function readWorkbook(file) {
    if (!window.XLSX?.read) {
      throw new Error("The workbook reader did not load. Check your connection and try again.");
    }
    log(`Reading ${file.name}`);
    const workbook = window.XLSX.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: true,
      raw: false
    });
    return {
      sheets: workbook.SheetNames.map((name) => {
        const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], {
          header: 1,
          raw: true,
          defval: "",
          blankrows: false
        });
        return {
          name,
          rows: matrix.map((sourceRow) => {
            const row = [];
            sourceRow.forEach((value, index) => {
              row[index + 1] = value;
            });
            return row;
          })
        };
      })
    };
  }

  function parseTimeWorkbook(workbook) {
    const rows = workbook.sheets[0]?.rows || [];
    const people = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || [];
      if (String(row[1] || "").trim() !== "Employee:") continue;
      const trainer = toDisplayName(row[6] || "");
      let blockEnd = rows.length;
      for (let next = index + 1; next < rows.length; next += 1) {
        if (String((rows[next] || [])[1] || "").trim() === "Employee:") {
          blockEnd = next;
          break;
        }
      }
      const jobLine = String((rows[index + 3] || [])[1] || "");
      const club = (jobLine.split("/").find((part) => / FL$/i.test(String(part).trim())) || "")
        .replace(/\s+FL$/i, "")
        .trim();
      const role = /manager/i.test(jobLine) ? "PTM" : "Trainer";
      let detailHours = 0;
      let summaryHours = 0;
      for (let detail = index; detail < blockEnd; detail += 1) {
        const detailRow = rows[detail] || [];
        const label = String(detailRow[1] || "").trim();
        const payCode = String(detailRow[6] || "").trim();
        const clockIn = parseExcelDate(detailRow[10]);
        const clockOut = parseExcelDate(detailRow[16]);
        if (label === "Actual Total Hours") {
          const summary = Number(detailRow[15] || 0);
          if (summary > 0) summaryHours = Math.max(summaryHours, summary);
        }
        if (clockIn && clockOut && !payCode) {
          const difference = (clockOut - clockIn) / 36e5;
          if (difference > 0 && difference < 24) detailHours += difference;
        }
      }
      const hoursWorked = summaryHours > 0 ? summaryHours : detailHours;
      if (trainer) {
        people.push({
          trainer,
          norm: norm(trainer),
          club,
          role,
          isPTM: role === "PTM",
          hoursWorked: Number(hoursWorked.toFixed(2))
        });
      }
    }
    log(`Parsed ${people.length} people from the time report.`);
    return people;
  }

  function parseCommissionWorkbook(workbook, fileName) {
    const rows = workbook.sheets[0]?.rows || [];
    let header = -1;
    for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
      const row = rows[index] || [];
      if (String(row[1] || "").trim() === "Location Name" && String(row[2] || "").trim() === "Sales Person") {
        header = index;
        break;
      }
    }
    if (header < 0) throw new Error(`${fileName}: commission header row was not found.`);
    const entries = [];
    for (let index = header + 1; index < rows.length; index += 1) {
      const row = rows[index] || [];
      const location = String(row[1] || "").trim();
      const trainer = toDisplayName(row[2] || "");
      if ((!location && !trainer) || /^total$/i.test(location) || !trainer) continue;
      entries.push({
        trainer,
        norm: norm(trainer),
        club: location.replace(/,\s*FL$/i, ""),
        fileName,
        events: Number(String(row[8]).replace(/,/g, "")) || 0
      });
    }
    log(`Parsed ${entries.length} commission rows from ${fileName}.`);
    return entries;
  }

  function applyAlias(value) {
    return aliasMap[norm(value)] || DEFAULT_ALIASES[norm(value)] || norm(value);
  }

  function findBestMatch(commission, timeRows) {
    const source = applyAlias(commission.trainer);
    const exact = timeRows.find((row) => row.norm === source);
    if (exact) {
      return {
        target: exact,
        quality: source !== norm(commission.trainer) ? "Alias" : "Exact",
        score: 100
      };
    }
    let best = null;
    let second = null;
    timeRows.forEach((row) => {
      const candidate = {
        target: row,
        score: scoreName(source, row.trainer, commission.club, row.club)
      };
      if (!best || candidate.score > best.score) {
        second = best;
        best = candidate;
      } else if (!second || candidate.score > second.score) {
        second = candidate;
      }
    });
    if (!best || best.score < 70) return { target: null, quality: "Unmatched", score: best?.score || 0 };
    if (second && best.score - second.score < 5 && second.score >= 75) {
      return { target: best.target, quality: "Ambiguous", score: best.score, alt: second.target.trainer };
    }
    return {
      target: best.target,
      quality: best.score >= 88 ? "Strong" : "Fuzzy",
      score: best.score
    };
  }

  function mergeData(timeRows, commissionRows) {
    const aggregate = {};
    const review = [];
    const rank = { Exact: 5, Alias: 4, Strong: 3, Fuzzy: 2, Ambiguous: 1, Unmatched: 0 };
    commissionRows.forEach((commission) => {
      const match = findBestMatch(commission, timeRows);
      review.push({
        source: commission.trainer,
        club: commission.club,
        target: match.target?.trainer || "",
        quality: match.quality,
        score: match.score,
        alt: match.alt || ""
      });
      if (!match.target) return;
      const key = match.target.norm;
      if (!aggregate[key]) {
        aggregate[key] = {
          events: 0,
          clubs: new Set(),
          quality: match.quality,
          score: match.score
        };
      }
      aggregate[key].events += commission.events;
      aggregate[key].clubs.add(commission.club);
      if (rank[match.quality] < rank[aggregate[key].quality]) {
        aggregate[key].quality = match.quality;
        aggregate[key].score = match.score;
      }
    });
    const rows = timeRows.map((timeRow) => {
      const commission = aggregate[timeRow.norm] || {
        events: 0,
        clubs: new Set(),
        quality: "Unmatched",
        score: 0
      };
      const tis = timeRow.hoursWorked > 0 ? (commission.events / timeRow.hoursWorked) * 100 : 0;
      return {
        ...timeRow,
        events: commission.events || 0,
        sourceClubList: [...commission.clubs].join(", "),
        tis,
        gapPct: Math.max(0, 80 - tis),
        sessionsGap: Math.max(0, Math.ceil(0.8 * timeRow.hoursWorked - commission.events)),
        status: tis >= 80 ? "green" : tis >= 70 ? "yellow" : "red",
        action: tis < 70
          ? "Rebuild the schedule and create same-day volume."
          : tis < 80
            ? "Add sessions and tighten confirmations."
            : "Protect volume and maintain the standard.",
        matchQuality: commission.quality,
        matchScore: commission.score
      };
    });
    return { rows, review };
  }

  function visibleRows() {
    const query = norm($("searchInput").value);
    const status = $("statusFilter").value;
    const role = $("roleFilter").value;
    const match = $("matchFilter").value;
    const hidePTMs = $("hidePTMs").checked;
    return appRows.filter((row) => {
      if (excluded.has(row.norm)) return false;
      if ((hidePTMs || role === "trainer") && row.isPTM) return false;
      if (role === "ptm" && !row.isPTM) return false;
      if (status !== "all" && row.status !== status) return false;
      if (match !== "all" && row.matchQuality !== match) return false;
      if (query && !norm(`${row.trainer} ${row.club} ${row.sourceClubList}`).includes(query)) return false;
      return true;
    });
  }

  function renderKpis(rows) {
    const hours = rows.reduce((sum, row) => sum + row.hoursWorked, 0);
    const events = rows.reduce((sum, row) => sum + row.events, 0);
    $("kActive").textContent = rows.length;
    $("kTis").textContent = `${(hours ? (events / hours) * 100 : 0).toFixed(1)}%`;
    $("kGreen").textContent = rows.filter((row) => row.status === "green").length;
    $("kYellow").textContent = rows.filter((row) => row.status === "yellow").length;
    $("kRed").textContent = rows.filter((row) => row.status === "red").length;
    $("kGap").textContent = rows.reduce((sum, row) => sum + row.sessionsGap, 0);
  }

  function renderTable(rows) {
    $("tableCount").textContent = `${rows.length} ${rows.length === 1 ? "person" : "people"}`;
    $("tbody").innerHTML = rows.length
      ? rows.map((row) => {
        const matchClass = ["Exact", "Alias", "Strong"].includes(row.matchQuality)
          ? "green"
          : row.matchQuality === "Fuzzy"
            ? "yellow"
            : "red";
        return `
          <tr>
            <td><strong>${escapeHtml(row.trainer)}</strong><div class="muted">${escapeHtml(row.sourceClubList || "No commission rows matched")}</div><button class="text-button" type="button" data-exclude="${escapeHtml(row.norm)}">Exclude</button></td>
            <td>${escapeHtml(row.club || "—")}</td>
            <td>${escapeHtml(row.role)}</td>
            <td class="numeric">${row.hoursWorked.toFixed(2)}</td>
            <td class="numeric">${row.events}</td>
            <td class="numeric"><strong>${row.tis.toFixed(1)}%</strong></td>
            <td><span class="status ${row.status}">${row.status}</span></td>
            <td class="numeric">${row.gapPct.toFixed(1)}%</td>
            <td class="numeric">${row.sessionsGap}</td>
            <td><span class="status ${matchClass}">${escapeHtml(row.matchQuality)}</span><div class="muted">${row.matchScore || ""}</div></td>
            <td>${escapeHtml(row.action)}</td>
          </tr>`;
      }).join("")
      : `<tr><td colspan="11"><div class="empty"><strong>No matching people</strong><span>Adjust the filters or restore excluded names.</span></div></td></tr>`;
  }

  function renderMatchingControls() {
    const items = matchReview.filter((match) => !["Exact", "Alias"].includes(match.quality));
    $("matchReview").innerHTML = items.length
      ? items.map((match, index) => `
        <div class="activity-row">
          <div>
            <strong>${escapeHtml(match.source)} → ${escapeHtml(match.target || "No match")}</strong>
            <span>${escapeHtml(match.club)} · ${escapeHtml(match.quality)} · score ${match.score}${match.alt ? ` · alternative ${escapeHtml(match.alt)}` : ""}</span>
          </div>
          ${match.target ? `<button class="button ghost" type="button" data-approve="${index}">Approve</button>` : ""}
        </div>`).join("")
      : `<div class="muted">${appRows.length ? "No fuzzy or unmatched names." : "No reports processed."}</div>`;

    const aliases = Object.entries(aliasMap).sort(([left], [right]) => left.localeCompare(right));
    $("aliasList").innerHTML = aliases.length
      ? aliases.map(([source, target]) => `
        <div class="activity-row"><div><strong>${escapeHtml(source)}</strong><span>→ ${escapeHtml(target)}</span></div><button class="text-button" type="button" data-remove-alias="${escapeHtml(source)}">Remove</button></div>`).join("")
      : `<div class="muted">No saved aliases.</div>`;

    $("excludedList").innerHTML = excluded.size
      ? [...excluded].sort().map((name) => `
        <div class="activity-row"><div><strong>${escapeHtml(name)}</strong><span>Excluded from the active roster</span></div><button class="text-button" type="button" data-restore="${escapeHtml(name)}">Restore</button></div>`).join("")
      : `<div class="muted">No excluded names.</div>`;
  }

  function coachingAction(row) {
    if (row.tis < 70) return "Rebuild today’s schedule, fill open time, and create same-day opportunities.";
    if (row.tis < 80) return "Push to green through confirmations, reschedules, and one more session block.";
    return "Protect the schedule and look for incremental session growth.";
  }

  function renderCoaching(rows) {
    if (!rows.length) {
      $("coachingList").innerHTML = `<div class="empty"><strong>No coaching queue yet</strong><span>Process reports or adjust the filters.</span></div>`;
      $("coachingMessage").textContent = "Process reports to generate a coaching brief.";
      return;
    }
    const priorities = [...rows]
      .sort((left, right) => left.tis - right.tis || right.hoursWorked - left.hoursWorked)
      .slice(0, 5);
    $("coachingList").innerHTML = priorities.map((row, index) => `
      <div class="activity-row">
        <div>
          <strong>${index + 1}. ${escapeHtml(row.trainer)}</strong>
          <span>${escapeHtml(row.club || "Unassigned")} · ${row.events} events / ${row.hoursWorked.toFixed(2)} hours</span>
          <span>${escapeHtml(coachingAction(row))}</span>
        </div>
        <span class="status ${row.status}">${row.tis.toFixed(1)}%</span>
      </div>`).join("");

    const reds = rows.filter((row) => row.status === "red").length;
    const yellows = rows.filter((row) => row.status === "yellow").length;
    const clubCounts = {};
    rows.filter((row) => row.tis < 80).forEach((row) => {
      const club = row.club || "Unassigned";
      clubCounts[club] = (clubCounts[club] || 0) + 1;
    });
    const largestConcentration = Object.entries(clubCounts).sort((left, right) => right[1] - left[1])[0];
    const priorityLines = priorities.map((row) => (
      `- ${row.trainer} (${row.club || "Unassigned"}): ${row.tis.toFixed(1)}% — ${coachingAction(row)}`
    ));
    $("coachingMessage").textContent = [
      "Team — here is today’s TIS coaching focus.",
      "",
      `Red: ${reds} | Yellow: ${yellows}`,
      largestConcentration
        ? `Largest coaching concentration: ${largestConcentration[0]} (${largestConcentration[1]} below green)`
        : "Every visible trainer is at standard.",
      "",
      "Priority conversations:",
      ...priorityLines,
      "",
      "Execution standard: protect confirmed sessions, close schedule gaps early, and move yellow trainers to green today."
    ].join("\n");
  }

  function render() {
    const rows = visibleRows();
    renderKpis(rows);
    renderTable(rows);
    renderMatchingControls();
    renderCoaching(rows);
    saveState();
  }

  async function processReports() {
    try {
      setPill("loading", "Processing");
      setWorkflowStep(2);
      $("fileState").classList.remove("inline-error");
      log("—");
      const timeFile = $("timeFile").files[0];
      const commissionFiles = [...$("commFiles").files];
      if (!timeFile) throw new Error("Choose a time report.");
      if (!commissionFiles.length) throw new Error("Choose at least one commission report.");
      const timeRows = parseTimeWorkbook(await readWorkbook(timeFile));
      let commissionRows = [];
      for (const file of commissionFiles) {
        commissionRows = commissionRows.concat(parseCommissionWorkbook(await readWorkbook(file), file.name));
      }
      const merged = mergeData(timeRows, commissionRows);
      appRows = merged.rows;
      matchReview = merged.review;
      render();
      setPill("ready", "Processed");
      setWorkflowStep(3);
      $("exportBtn").disabled = !appRows.length;
      $("fileState").textContent = `Processed ${timeRows.length} people and ${commissionRows.length} commission rows.`;
      log(`Ready: ${timeRows.length} people, ${commissionRows.length} commission rows.`);
    } catch (error) {
      setPill("error", "Needs review");
      setWorkflowStep(2);
      $("exportBtn").disabled = true;
      $("fileState").textContent = error.message || String(error);
      $("fileState").classList.add("inline-error");
      log(`ERROR: ${error.message || error}`);
    }
  }

  function exportCsv() {
    const rows = visibleRows();
    const matrix = [
      ["Trainer", "Club", "Role", "Hours Worked", "Events", "TIS", "Status", "Gap to 80%", "Sessions to Green", "Match Quality", "Match Score", "Next Move"],
      ...rows.map((row) => [
        row.trainer,
        row.club,
        row.role,
        row.hoursWorked,
        row.events,
        row.tis.toFixed(1),
        row.status,
        row.gapPct.toFixed(1),
        row.sessionsGap,
        row.matchQuality,
        row.matchScore,
        row.action
      ])
    ];
    const csv = matrix.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    download("ptr4-tis-coaching.csv", csv, "text/csv;charset=utf-8");
    setWorkflowStep(4);
  }

  function preloadAliases() {
    let added = 0;
    Object.entries(DEFAULT_ALIASES).forEach(([source, target]) => {
      if (!aliasMap[source]) {
        aliasMap[source] = target;
        added += 1;
      }
    });
    log(`Loaded ${added} known aliases.`);
    render();
  }

  function addAlias() {
    const source = norm($("aliasSource").value);
    const target = norm($("aliasTarget").value);
    if (!source || !target) return;
    aliasMap[source] = target;
    $("aliasSource").value = "";
    $("aliasTarget").value = "";
    log(`Saved alias ${source} → ${target}.`);
    render();
  }

  $("timeFile").addEventListener("change", updateFileState);
  $("commFiles").addEventListener("change", updateFileState);
  $("processBtn").addEventListener("click", processReports);
  $("exportBtn").addEventListener("click", exportCsv);
  ["statusFilter", "roleFilter", "matchFilter"].forEach((id) => $(id).addEventListener("change", render));
  $("searchInput").addEventListener("input", render);
  $("hidePTMs").addEventListener("change", render);
  $("refreshCoaching").addEventListener("click", render);
  $("resetRosterBtn").addEventListener("click", () => {
    excluded.clear();
    render();
  });
  $("preloadAliasesBtn").addEventListener("click", preloadAliases);
  $("addAliasBtn").addEventListener("click", addAlias);
  $("tbody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-exclude]");
    if (!button) return;
    excluded.add(button.dataset.exclude);
    render();
  });
  $("matchReview").addEventListener("click", (event) => {
    const button = event.target.closest("[data-approve]");
    if (!button) return;
    const item = matchReview.filter((match) => !["Exact", "Alias"].includes(match.quality))[Number(button.dataset.approve)];
    if (!item?.target) return;
    aliasMap[norm(item.source)] = norm(item.target);
    log(`Approved ${item.source} → ${item.target}. Reprocess reports to apply the alias.`);
    render();
  });
  $("aliasList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-alias]");
    if (!button) return;
    delete aliasMap[button.dataset.removeAlias];
    render();
  });
  $("excludedList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-restore]");
    if (!button) return;
    excluded.delete(button.dataset.restore);
    render();
  });
  $("copyCoaching").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("coachingMessage").textContent);
      $("copyCoaching").textContent = "Copied";
      setWorkflowStep(4);
      setTimeout(() => {
        $("copyCoaching").textContent = "Copy message";
      }, 1200);
    } catch {
      $("copyCoaching").textContent = "Copy failed";
    }
  });

  $("hidePTMs").checked = safeParse(localStorage.getItem(STORAGE_HIDE_PTMS), true);
  updateFileState();
  preloadAliases();
  setPill("ready", "Ready");
  log("Ready. Reports are processed locally in this browser.");

  window.addEventListener("error", (event) => {
    setPill("error", "Needs review");
    log(`ERROR: ${event.message}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    setPill("error", "Needs review");
    log(`ERROR: ${event.reason?.message || event.reason}`);
  });
})();
