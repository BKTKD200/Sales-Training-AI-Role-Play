const state = {
  config: null,
  setup: null,
  pc: null,
  dc: null,
  localStream: null,
  transcript: [],
  current: {
    user: null,
    assistant: null,
  },
  selected: null,
  muted: false,
  pendingProgressSetup: null,
  signedInSetup: null,
};

const els = {
  form: document.querySelector("#setup-form"),
  keySetup: document.querySelector("#key-setup"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  saveKeyButton: document.querySelector("#save-key-button"),
  keyStatus: document.querySelector("#key-status"),
  center: document.querySelector("#center"),
  employeeName: document.querySelector("#employeeName"),
  objectionWrap: document.querySelector("#objection-wrap"),
  objectionType: document.querySelector("#objectionType"),
  startButton: document.querySelector("#start-button"),
  muteButton: document.querySelector("#mute-button"),
  endButton: document.querySelector("#end-button"),
  statusTitle: document.querySelector("#status-title"),
  eventStatus: document.querySelector("#event-status"),
  sessionMeta: document.querySelector("#session-meta"),
  skillPracticeBanner: document.querySelector("#skill-practice-banner"),
  skillPracticeTitle: document.querySelector("#skill-practice-title"),
  transcript: document.querySelector("#transcript"),
  toggleTranscriptButton: document.querySelector("#toggle-transcript-button"),
  report: document.querySelector("#report"),
  saveStatus: document.querySelector("#save-status"),
  remoteAudio: document.querySelector("#remote-audio"),
  practiceTabButton: document.querySelector("#practice-tab-button"),
  dashboardTabButton: document.querySelector("#dashboard-tab-button"),
  setupForm: document.querySelector("#setup-form"),
  dashboardFilters: document.querySelector("#dashboard-filters"),
  practiceView: document.querySelector("#practice-view"),
  dashboardView: document.querySelector("#dashboard-view"),
  dashboardCenters: document.querySelector("#dashboard-centers"),
  dashboardEmployees: document.querySelector("#dashboard-employees"),
  period1Start: document.querySelector("#period1-start"),
  period1End: document.querySelector("#period1-end"),
  period2Start: document.querySelector("#period2-start"),
  period2End: document.querySelector("#period2-end"),
  refreshDashboardButton: document.querySelector("#refresh-dashboard-button"),
  dashboardStatus: document.querySelector("#dashboard-status"),
  metricCalls: document.querySelector("#metric-calls"),
  metricScore1: document.querySelector("#metric-score-1"),
  metricScore2: document.querySelector("#metric-score-2"),
  metricImprovement: document.querySelector("#metric-improvement"),
  metricAppointmentRate: document.querySelector("#metric-appointment-rate"),
  metricAppointmentAttemptRate: document.querySelector("#metric-appointment-attempt-rate"),
  metricEmployees: document.querySelector("#metric-employees"),
  metricSkillPractices: document.querySelector("#metric-skill-practices"),
  centerComparison: document.querySelector("#center-comparison"),
  employeeSummary: document.querySelector("#employee-summary"),
  dailyCompletions: document.querySelector("#daily-completions"),
  difficultyMix: document.querySelector("#difficulty-mix"),
  scoreTrend: document.querySelector("#score-trend"),
  commonOpportunities: document.querySelector("#common-opportunities"),
  skillsPracticed: document.querySelector("#skills-practiced"),
  recentSkillPractices: document.querySelector("#recent-skill-practices"),
  recentSessions: document.querySelector("#recent-sessions"),
  progressModal: document.querySelector("#practice-progress-modal"),
  progressWeek: document.querySelector("#progress-week"),
  progressCompleted: document.querySelector("#progress-completed"),
  progressRemaining: document.querySelector("#progress-remaining"),
  progressToday: document.querySelector("#progress-today"),
  progressGuidance: document.querySelector("#progress-guidance"),
  progressContinueButton: document.querySelector("#progress-continue-button"),
};

boot();

async function boot() {
  const response = await fetch("/api/config");
  state.config = await response.json();

  els.center.innerHTML = `<option value="">Select center</option>${state.config.centers.map((center) => `<option>${escapeHtml(center)}</option>`).join("")}`;
  renderEmployeeOptions();
  els.objectionType.innerHTML = state.config.curveBallChallenges
    .map((challenge) => `<option value="${challenge.id}">${escapeHtml(challenge.label)}</option>`)
    .join("");

  els.form.addEventListener("change", () => {
    syncDifficulty();
    updateSetupPreview();
  });
  els.center.addEventListener("change", () => {
    renderEmployeeOptions();
    updateSetupPreview();
  });
  els.form.addEventListener("submit", startRoleplay);
  els.saveKeyButton.addEventListener("click", saveApiKey);
  els.endButton.addEventListener("click", endAndEvaluate);
  els.muteButton.addEventListener("click", toggleMute);
  els.toggleTranscriptButton.addEventListener("click", toggleTranscript);
  document.addEventListener("click", handleFullReportToggle);
  document.addEventListener("click", handleSkillPracticeClick);
  els.practiceTabButton.addEventListener("click", () => switchTab("practice"));
  els.dashboardTabButton.addEventListener("click", () => switchTab("dashboard"));
  els.refreshDashboardButton.addEventListener("click", loadDashboard);
  els.progressContinueButton.addEventListener("click", beginRoleplayFromProgress);
  syncDifficulty();
  refreshHealth();
  setDefaultDashboardDates();
  restoreSignedInSetup();
  updateSetupPreview();
  loadDashboard();
}

async function refreshHealth() {
  try {
    const health = await fetchJson("/api/health");
    els.keySetup.classList.toggle("hidden", Boolean(health.hasApiKey));
  } catch {
    els.keySetup.classList.remove("hidden");
  }
}

async function saveApiKey() {
  const apiKey = els.apiKeyInput.value.trim();
  els.keyStatus.textContent = "Saving...";
  els.saveKeyButton.disabled = true;

  try {
    await fetchJson("/api/setup-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    els.apiKeyInput.value = "";
    els.keyStatus.textContent = "Saved locally. You can start the role-play now.";
    await refreshHealth();
  } catch (error) {
    els.keyStatus.textContent = error.message;
  } finally {
    els.saveKeyButton.disabled = false;
  }
}

function switchTab(tabName) {
  const isDashboard = tabName === "dashboard";
  els.practiceTabButton.classList.toggle("active", !isDashboard);
  els.dashboardTabButton.classList.toggle("active", isDashboard);
  els.setupForm.classList.toggle("active", !isDashboard);
  els.practiceView.classList.toggle("active", !isDashboard);
  els.dashboardFilters.classList.toggle("active", isDashboard);
  els.dashboardView.classList.toggle("active", isDashboard);
  if (isDashboard) loadDashboard();
}

function setDefaultDashboardDates() {
  const today = new Date();
  const period2End = toDateInputValue(today);
  const period2Start = toDateInputValue(addDays(today, -30));
  const period1End = toDateInputValue(addDays(new Date(period2Start), -1));
  const period1Start = toDateInputValue(addDays(new Date(period1End), -30));
  els.period1Start.value = period1Start;
  els.period1End.value = period1End;
  els.period2Start.value = period2Start;
  els.period2End.value = period2End;
}

async function loadDashboard() {
  els.dashboardStatus.textContent = "Loading";
  try {
    const params = new URLSearchParams({
      centers: getCheckedValues(els.dashboardCenters).join(","),
      employees: getCheckedValues(els.dashboardEmployees).join(","),
      period1Start: els.period1Start.value,
      period1End: els.period1End.value,
      period2Start: els.period2Start.value,
      period2End: els.period2End.value,
    });
    const dashboard = await fetchJson(`/api/dashboard?${params}`);
    renderDashboardFilters(dashboard);
    renderDashboard(dashboard);
    els.dashboardStatus.textContent = "Updated";
  } catch (error) {
    els.dashboardStatus.textContent = error.message;
  }
}

function renderDashboardFilters(dashboard) {
  renderCheckList(els.dashboardCenters, dashboard.options.centers, dashboard.filters.centers, "center-filter");
  renderCheckList(els.dashboardEmployees, dashboard.options.employees, dashboard.filters.employees, "employee-filter");
  els.period1Start.value = dashboard.filters.period1Start;
  els.period1End.value = dashboard.filters.period1End;
  els.period2Start.value = dashboard.filters.period2Start;
  els.period2End.value = dashboard.filters.period2End;
}

function renderCheckList(container, options, selected, name) {
  const selectedSet = new Set(selected);
  const allSelected = selectedSet.size === 0;
  if (!options.length) {
    container.innerHTML = `<p class="empty-state">No saved options yet.</p>`;
    return;
  }

  container.innerHTML = options.map((option) => {
    const id = `${name}-${slug(option)}`;
    const checked = allSelected || selectedSet.has(option) ? "checked" : "";
    return `
      <label for="${id}">
        <input id="${id}" type="checkbox" value="${escapeHtml(option)}" ${checked} />
        ${escapeHtml(option)}
      </label>
    `;
  }).join("");
}

function renderDashboard(dashboard) {
  const period2 = dashboard.aggregate.period2;
  els.metricCalls.textContent = formatNumber(period2.callsCompleted);
  els.metricScore1.textContent = formatScore(dashboard.aggregate.period1.avgScore);
  els.metricScore2.textContent = formatScore(period2.avgScore);
  els.metricImprovement.textContent = formatDelta(dashboard.aggregate.improvement);
  els.metricAppointmentRate.textContent = formatPercent(period2.appointmentSecuredRate);
  els.metricAppointmentAttemptRate.textContent = formatPercent(period2.appointmentAttemptedRate);
  els.metricEmployees.textContent = formatNumber(period2.activeEmployees);
  els.metricSkillPractices.textContent = formatNumber(dashboard.skillPractice?.completed || 0);

  els.centerComparison.innerHTML = dashboard.centers.length
    ? dashboard.centers.map((row) => {
      const vsAggregate = row.period2.avgScore === null || period2.avgScore === null ? null : round(row.period2.avgScore - period2.avgScore);
      return `
        <tr>
          <td>${escapeHtml(row.center)}</td>
          <td>${formatNumber(row.period2.callsCompleted)}</td>
          <td>${formatScore(row.period1.avgScore)}</td>
          <td>${formatScore(row.period2.avgScore)}</td>
          <td>${formatDelta(row.improvement)}</td>
          <td>${formatDelta(vsAggregate)}</td>
          <td>${formatPercent(row.period2.appointmentSecuredRate)}</td>
        </tr>
      `;
    }).join("")
    : emptyRow(7, "No completed practice calls match these filters.");

  els.employeeSummary.innerHTML = dashboard.employees.length
    ? dashboard.employees.map((row) => `
      <tr>
        <td>${escapeHtml(row.employeeName)}</td>
        <td>${escapeHtml(row.center)}</td>
        <td>${formatNumber(row.summary.callsCompleted)}</td>
        <td>${formatScore(row.summary.avgScore)}</td>
        <td>${formatPercent(row.summary.appointmentSecuredRate)}</td>
      </tr>
    `).join("")
    : emptyRow(5, "No employees have calls in time frame 2.");

  els.recentSessions.innerHTML = dashboard.recentSessions.length
    ? dashboard.recentSessions.map(renderRecentSession).join("")
    : `<li class="empty-state">No saved sessions yet.</li>`;

  els.dailyCompletions.innerHTML = renderTrackingList(
    dashboard.tracking.dailyCompletions.map((item) => ({ label: formatDateOnly(item.date), value: item.count })),
    "No completed calls in time frame 2."
  );
  els.difficultyMix.innerHTML = renderTrackingList(dashboard.tracking.difficultyMix, "No difficulty data yet.");
  els.scoreTrend.innerHTML = renderTrackingList(
    dashboard.tracking.scoreTrend.map((item) => ({ label: formatDateOnly(item.date), value: formatScore(item.avgScore) })),
    "No scored calls in time frame 2."
  );
  els.commonOpportunities.innerHTML = renderCoachingOpportunities(dashboard.tracking.commonOpportunities, "No coaching themes yet.");
  els.skillsPracticed.innerHTML = renderSkillPracticeList(dashboard.skillPractice?.skillsPracticed || [], "No focused skill drills yet.");
  els.recentSkillPractices.innerHTML = renderRecentSkillPractices(dashboard.skillPractice?.recentPractices || []);
}

function renderTrackingList(items, emptyText) {
  if (!items.length) return `<li class="empty-state">${escapeHtml(emptyText)}</li>`;
  return items.map((item) => `
    <li>
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(formatTrackingValue(item))}</strong>
    </li>
  `).join("");
}

function formatTrackingValue(item) {
  const value = item.value ?? item.count;
  return value === null || value === undefined || value === "" ? "-" : value;
}

function renderCoachingOpportunities(items, emptyText) {
  if (!items.length) return `<li class="empty-state">${escapeHtml(emptyText)}</li>`;
  return items.map((item) => {
    const count = formatTrackingValue(item);
    const label = String(count) === "1" ? "Appeared in 1 call" : `Appeared in ${count} calls`;
    return `
      <li>
        <span>${escapeHtml(item.label)}</span>
        <div class="coaching-opportunity-actions">
          <strong>${escapeHtml(label)}</strong>
          <button type="button" class="practice-skill-button" data-skill="${escapeHtml(item.label)}">Practice this skill</button>
        </div>
      </li>
    `;
  }).join("");
}

function renderSkillPracticeList(items, emptyText) {
  if (!items.length) return `<li class="empty-state">${escapeHtml(emptyText)}</li>`;
  return items.map((item) => {
    const count = formatTrackingValue(item);
    const label = String(count) === "1" ? "Practiced in 1 drill" : `Practiced in ${count} drills`;
    return `
      <li>
        <span>${escapeHtml(item.label)}</span>
        <div class="coaching-opportunity-actions">
          <strong>${escapeHtml(label)}</strong>
        </div>
      </li>
    `;
  }).join("");
}

function renderRecentSkillPractices(items) {
  if (!items.length) return `<li class="empty-state">No focused skill drills yet.</li>`;
  return items.map((item) => `
    <li>
      <strong>${escapeHtml(item.employeeName)}</strong>
      <span>${escapeHtml(item.center)} · ${formatDateTime(item.savedAt)}</span>
      <span>${escapeHtml(item.focusSkill)}</span>
    </li>
  `).join("");
}

async function handleSkillPracticeClick(event) {
  const button = event.target.closest(".practice-skill-button");
  if (!button) return;

  const focusSkill = button.dataset.skill || "";
  const formSetup = setupFromForm();
  const setup = formSetup.employeeName && formSetup.center ? formSetup : getSignedInSetup();

  if (!setup?.employeeName || !setup?.center) {
    switchTab("practice");
    renderSkillPracticeBanner(focusSkill);
    setStatus("Choose rep first", "Select your center and name once, then return to the dashboard to practice this skill.");
    return;
  }

  rememberSignedInSetup(setup);
  state.setup = {
    ...setup,
    practiceMode: "skill",
    focusSkill,
    difficulty: "Skill Practice",
    objectionType: "none",
  };

  switchTab("practice");
  resetSessionUi();
  renderSkillPracticeBanner(focusSkill);
  renderMeta(state.setup);
  renderReport(`Focused skill practice: ${focusSkill}`, { plain: true });
  await beginRoleplay();
}

function renderRecentSession(session, index) {
  const transcriptId = `recent-transcript-${index}`;
  const reportId = `recent-report-${index}`;
  const transcript = renderSavedTranscript(session);
  const report = formatSavedReport(session.report);

  return `
    <li>
      <details class="recent-session-detail">
        <summary>
          <strong>${escapeHtml(session.employeeName)}</strong>
        </summary>
        <div class="recent-session-links">
          <a href="#${transcriptId}">Transcript</a>
          <a href="#${reportId}">Report</a>
        </div>
        <section id="${transcriptId}" class="saved-call-block">
          <h3>Transcript</h3>
          ${transcript || `<p class="report-placeholder">No transcript was saved for this call.</p>`}
        </section>
        <section id="${reportId}" class="saved-call-block saved-report-block">
          <h3>Report</h3>
          <div class="report-content saved-report-content">
            ${report ? renderReportHtml(report) : `<p class="report-placeholder">No report was saved for this call.</p>`}
          </div>
        </section>
      </details>
    </li>
  `;
}

function renderSavedTranscript(session) {
  const entries = Array.isArray(session.transcript)
    ? session.transcript.filter((entry) => entry?.text?.trim())
    : [];

  if (entries.length) {
    return `
      <ol class="transcript saved-transcript">
        ${entries.map((entry) => {
          const label = entry.speaker === "assistant" ? "Prospect" : "Representative";
          return `<li><strong>${label}</strong><p>${escapeHtml(entry.text.trim())}</p></li>`;
        }).join("")}
      </ol>
    `;
  }

  const transcriptText = formatSavedTranscript(session);
  return transcriptText ? `<pre>${escapeHtml(transcriptText)}</pre>` : "";
}

function formatSavedTranscript(session) {
  if (String(session.transcriptText || "").trim()) return session.transcriptText.trim();
  if (!Array.isArray(session.transcript)) return "";
  return session.transcript
    .filter((entry) => entry?.text?.trim())
    .map((entry) => `${entry.speaker === "assistant" ? "Prospect" : "Representative"}: ${entry.text.trim()}`)
    .join("\n");
}

function formatSavedReport(report) {
  return String(report || "")
    .trim()
    .replace(/^Overall score:\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/im, "Overall score: $1");
}


function getCheckedValues(container) {
  const inputs = [...container.querySelectorAll("input[type='checkbox']")];
  if (!inputs.length) return [];
  const checked = inputs.filter((input) => input.checked).map((input) => input.value);
  return checked.length === inputs.length ? [] : checked;
}

function syncDifficulty() {
  const difficulty = new FormData(els.form).get("difficulty");
  els.objectionWrap.classList.toggle("hidden", difficulty !== "Curve Balls");
}

function renderEmployeeOptions() {
  const center = els.center.value;
  const employees = state.config.employeesByCenter?.[center] || [];
  els.employeeName.innerHTML = center && employees.length
    ? `<option value="">Select employee</option>${employees.map((employee) => `<option>${escapeHtml(employee)}</option>`).join("")}`
    : `<option value="">No employees configured</option>`;
}

function updateSetupPreview() {
  state.setup = setupFromForm();
  if (state.setup.employeeName && state.setup.center) {
    rememberSignedInSetup(state.setup);
    renderMeta(state.setup);
  } else {
    renderMeta(null);
  }
}

function rememberSignedInSetup(setup) {
  if (!setup?.employeeName || !setup?.center) return;
  state.signedInSetup = { ...setup };
  try {
    localStorage.setItem("ffbVoiceRoleplaySignedInSetup", JSON.stringify(state.signedInSetup));
  } catch {
    // Local storage may be unavailable; the in-memory setup still works.
  }
}

function getSignedInSetup() {
  if (state.signedInSetup?.employeeName && state.signedInSetup?.center) return { ...state.signedInSetup };

  try {
    const saved = JSON.parse(localStorage.getItem("ffbVoiceRoleplaySignedInSetup") || "null");
    if (saved?.employeeName && saved?.center) {
      state.signedInSetup = saved;
      return { ...saved };
    }
  } catch {
    return null;
  }

  return null;
}

function restoreSignedInSetup() {
  const saved = getSignedInSetup();
  if (!saved?.employeeName || !saved?.center) return;
  if (!state.config.centers.includes(saved.center)) return;

  els.center.value = saved.center;
  renderEmployeeOptions();
  const employees = state.config.employeesByCenter?.[saved.center] || [];
  if (employees.includes(saved.employeeName)) {
    els.employeeName.value = saved.employeeName;
    state.setup = setupFromForm();
  }
}

async function startRoleplay(event) {
  event.preventDefault();
  state.setup = setupFromForm();
  rememberSignedInSetup(state.setup);
  renderSkillPracticeBanner(null);
  state.pendingProgressSetup = state.setup;

  try {
    const params = new URLSearchParams({
      employeeName: state.setup.employeeName,
      center: state.setup.center,
    });
    const progress = await fetchJson(`/api/progress?${params}`);
    showProgressModal(progress);
  } catch (error) {
    setStatus("Could not load progress", error.message);
  }
}

async function beginRoleplayFromProgress() {
  hideProgressModal();
  if (state.pendingProgressSetup) state.setup = state.pendingProgressSetup;
  await beginRoleplay();
}

async function beginRoleplay() {
  resetSessionUi();
  if (state.setup?.practiceMode === "skill") {
    renderSkillPracticeBanner(state.setup.focusSkill);
  } else {
    renderSkillPracticeBanner(null);
  }
  els.endButton.textContent = state.setup?.practiceMode === "skill" ? "End skill practice" : "End and evaluate";
  renderMeta(state.setup);
  setBusy(true, "Checking setup");

  try {
    const health = await fetchJson("/api/health");
    if (!health.hasApiKey) {
      throw new Error("Server setup needed: add OPENAI_API_KEY to .env, then restart the app.");
    }

    setStatus("Requesting microphone", "Allow microphone access to start the spoken role-play");
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setStatus("Connecting", "Creating live voice session");

    state.pc = new RTCPeerConnection();
    state.pc.ontrack = (event) => {
      els.remoteAudio.srcObject = event.streams[0];
    };
    state.localStream.getTracks().forEach((track) => state.pc.addTrack(track, state.localStream));

    state.dc = state.pc.createDataChannel("oai-events");
    wireDataChannel(state.dc);

    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    await waitForIceGathering(state.pc);

    const response = await fetch("/api/live-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup: state.setup, sdp: state.pc.localDescription.sdp }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || "Could not start session.");
    if (!payload.answerSdp) throw new Error("The live session did not return an SDP answer.");

    state.selected = payload.selected;
    await state.pc.setRemoteDescription({ type: "answer", sdp: payload.answerSdp });
    renderMeta(state.setup);
    setStatus("Connected", "Waiting for prospect");
    els.muteButton.disabled = false;
    els.endButton.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus("Could not start", friendlyStartError(error));
    cleanupConnection();
  } finally {
    setBusy(false);
  }
}

function showProgressModal(progress) {
  els.progressWeek.textContent = `Week beginning/ending: ${progress.weekLabel}`;
  els.progressCompleted.textContent = `${progress.completedThisWeek} / ${progress.weeklyTarget}`;
  els.progressRemaining.textContent = String(progress.remainingThisWeek);
  els.progressToday.textContent = `${progress.completedToday} / ${progress.dailyTarget}`;
  els.progressGuidance.textContent = progress.remainingThisWeek
    ? `${progress.employeeName} needs ${progress.remainingThisWeek} more practice call${progress.remainingThisWeek === 1 ? "" : "s"} to hit the weekly target.`
    : `${progress.employeeName} has met the weekly target. Extra practice still counts.`;
  els.progressModal.classList.remove("hidden");
}

function hideProgressModal() {
  els.progressModal.classList.add("hidden");
}

function wireDataChannel(dc) {
  dc.addEventListener("open", () => {
    setStatus("Connected", "Role-play in progress");
  });

  dc.addEventListener("message", (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }

    if (event.type === "session.started") {
      const isSkillPractice = state.setup?.practiceMode === "skill";
      sendClientEvent({
        type: "session.commentary.append",
        event_id: makeEventId("start"),
        delegation_id: null,
        content: isSkillPractice
          ? "Begin the focused skill practice now. Start as the coach by congratulating the representative for committing to improve, explain the focus skill, ask what questions they have, then move into the short drill."
          : "Begin the role-play now with a brief, natural prospect opening. Stay in character.",
      });
      setStatus(isSkillPractice ? "Skill practice" : "In progress", isSkillPractice ? "Ask questions, then practice the focused skill" : "Speak as the sales representative");
    }

    if (event.type === "session.input_transcript.delta") {
      appendTranscript("user", event.delta || "");
    }

    if (event.type === "session.output_transcript.delta") {
      appendTranscript("assistant", event.delta || "");
    }

    if (event.type === "session.closed") {
      setStatus("Ended", "Conversation closed");
    }

    if (event.type === "error") {
      const message = event.error?.message || "Live session error";
      setStatus("Session warning", message);
    }
  });
}

function appendTranscript(speaker, delta) {
  if (!delta) return;
  const other = speaker === "user" ? "assistant" : "user";
  state.current[other] = null;

  let entry = state.current[speaker];
  if (!entry) {
    entry = {
      speaker,
      text: "",
      startedAt: Date.now(),
    };
    state.transcript.push(entry);
    state.current[speaker] = entry;
  }
  entry.text += delta;
  renderTranscript();
}

async function endAndEvaluate() {
  if (state.setup?.practiceMode === "skill") {
    endSkillPractice();
    return;
  }

  els.endButton.disabled = true;
  els.muteButton.disabled = true;
  els.startButton.disabled = true;
  setStatus("Ending", "Preparing evaluation");
  renderReport("Evaluating the role-play...", { plain: true });
  els.saveStatus.textContent = "";

  try {
    sendClientEvent({
      type: "session.close",
      event_id: makeEventId("close"),
    });
  } catch {
    // The connection may already be closed; evaluation can still continue with captured transcript.
  }

  cleanupConnection();

  try {
    const cleanTranscript = state.transcript
      .map((entry) => ({ speaker: entry.speaker, text: entry.text.trim(), startedAt: entry.startedAt }))
      .filter((entry) => entry.text);

    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup: state.setup, transcript: cleanTranscript }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || "Could not evaluate.");

    renderReport(payload.report);
    els.saveStatus.textContent = payload.saved?.filename ? `Saved: ${payload.saved.filename}` : "Saved";
    setStatus("Evaluation ready", "Review the coaching report. You can start another practice when ready.");
    loadDashboard();
  } catch (error) {
    renderReport(error.message, { plain: true, error: true });
    setStatus("Evaluation unavailable", error.message);
  } finally {
    prepareForNextPractice();
  }
}

async function endSkillPractice() {
  els.endButton.disabled = true;
  els.muteButton.disabled = true;
  els.startButton.disabled = true;
  setStatus("Ending", "Closing focused skill practice");

  try {
    sendClientEvent({
      type: "session.close",
      event_id: makeEventId("close"),
    });
  } catch {
    // The connection may already be closed.
  }

  cleanupConnection();
  const cleanTranscript = state.transcript
    .map((entry) => ({ speaker: entry.speaker, text: entry.text.trim(), startedAt: entry.startedAt }))
    .filter((entry) => entry.text);

  try {
    const response = await fetch("/api/skill-practice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup: state.setup, transcript: cleanTranscript }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || "Could not save skill practice.");

    renderReport(`Focused skill practice complete: ${state.setup.focusSkill}`, { plain: true });
    els.saveStatus.textContent = payload.saved?.filename ? "Saved as focused skill drill" : "Saved";
    setStatus("Skill practice complete", "Saved separately from scored practice calls.");
    loadDashboard();
  } catch (error) {
    renderReport(`Focused skill practice complete, but saving failed: ${error.message}`, { plain: true, error: true });
    els.saveStatus.textContent = "Not saved";
    setStatus("Skill practice complete", "The drill ended, but saving failed.");
  } finally {
    prepareForNextPractice();
  }
}

function setupFromForm() {
  const data = new FormData(els.form);
  const center = String(data.get("center") || "").trim();
  return {
    employeeName: String(data.get("employeeName") || "").trim(),
    center,
    brand: state.config?.brandByCenter?.[center] || "",
    callDirection: String(data.get("callDirection") || "").trim(),
    difficulty: String(data.get("difficulty") || "").trim(),
    objectionType: String(data.get("difficulty")) === "Curve Balls" ? String(data.get("objectionType") || "").trim() : "none",
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || payload.error || "Request failed.");
  return payload;
}

function friendlyStartError(error) {
  if (error?.name === "NotAllowedError" || /permission denied/i.test(error?.message || "")) {
    return "Microphone access is blocked. Allow microphone access for this site, then reload and start again.";
  }
  if (error?.name === "NotFoundError") {
    return "No microphone was found. Connect or enable a microphone, then try again.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser does not expose microphone access here. Open the app in a browser that supports microphone access on localhost.";
  }
  return error?.message || "The role-play could not start.";
}

function renderMeta(setup = state.setup) {
  if (!setup) {
    els.sessionMeta.innerHTML = "";
    return;
  }
  const items = setup.practiceMode === "skill"
    ? [setup.employeeName, setup.center, setup.brand, "Skill practice"]
    : [
      setup.employeeName,
      setup.center,
      setup.brand,
      setup.callDirection,
      setup.difficulty,
    ];
  if (setup.objectionType !== "none") {
    const label = state.config.curveBallChallenges.find((item) => item.id === setup.objectionType)?.label || setup.objectionType;
    items.push(label);
  }
  els.sessionMeta.innerHTML = items.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
}

function renderSkillPracticeBanner(skill) {
  if (!skill) {
    els.skillPracticeBanner.classList.add("hidden");
    els.skillPracticeTitle.textContent = "";
    document.body.classList.remove("skill-practice-mode");
    return;
  }

  els.skillPracticeTitle.textContent = formatSkillTitle(skill);
  els.skillPracticeBanner.classList.remove("hidden");
  document.body.classList.add("skill-practice-mode");
}

function formatSkillTitle(skill) {
  return String(skill || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*[:;,.!?]+$/g, "");
}

function renderTranscript() {
  els.transcript.innerHTML = state.transcript
    .filter((entry) => entry.text.trim())
    .map((entry) => {
      const label = entry.speaker === "assistant" ? "Prospect" : "Representative";
      return `<li><strong>${label}</strong><p>${escapeHtml(entry.text.trim())}</p></li>`;
    })
    .join("");
}

function toggleTranscript() {
  const expanded = els.transcript.classList.toggle("expanded");
  els.toggleTranscriptButton.textContent = expanded ? "Condense transcript" : "Expand transcript";
}

function renderReport(text, options = {}) {
  const value = String(text || "").trim();
  if (!value) {
    els.report.innerHTML = `<p class="report-placeholder">Complete a role-play to generate the coaching report.</p>`;
    return;
  }

  if (options.plain) {
    const className = options.error ? "report-placeholder report-error" : "report-placeholder";
    els.report.innerHTML = `<p class="${className}">${escapeHtml(value)}</p>`;
    return;
  }

  els.report.innerHTML = renderReportHtml(value);
}

function renderReportHtml(text) {
  const blocks = parseReportBlocks(text);
  return `
    ${renderShortReport(blocks)}
    <div class="full-report-action">
      <button class="full-report-toggle" type="button" aria-expanded="false">View full report</button>
    </div>
    <div class="full-report-content hidden" hidden>
      ${blocks.map(renderReportBlock).join("")}
    </div>
  `;
}

function handleFullReportToggle(event) {
  const button = event.target.closest(".full-report-toggle");
  if (!button) return;

  const wrapper = button.closest(".report-content");
  const content = wrapper?.querySelector(".full-report-content");
  if (!content) return;

  const isOpen = content.hidden;
  content.hidden = !isOpen;
  content.classList.toggle("hidden", !isOpen);
  button.setAttribute("aria-expanded", String(isOpen));
  button.textContent = isOpen ? "Hide full report" : "View full report";
}

function parseReportBlocks(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (/^Overall score:/i.test(line)) {
      blocks.push({ type: "score", text: line });
      current = null;
      continue;
    }

    if (isReportHeading(line)) {
      current = { type: "section", heading: line.replace(/:$/, ""), items: [] };
      blocks.push(current);
      continue;
    }

    if (!current) {
      current = { type: "section", heading: "Summary", items: [] };
      blocks.push(current);
    }
    current.items.push(line.replace(/^[-*]\s*/, ""));
  }

  return blocks;
}

function isReportHeading(line) {
  return [
    "What went well",
    "Main opportunity",
    "Next call direction",
    "Evidence from the role-play",
  ].some((heading) => line.replace(/:$/, "").toLowerCase() === heading.toLowerCase());
}

function renderReportBlock(block) {
  if (block.type === "score") {
    const parts = block.text.split(":");
    const score = formatScore(parts.slice(1).join(":").trim());
    return `
      <section class="report-score">
        <span>Overall score out of 10</span>
        <strong>${escapeHtml(score || block.text)}</strong>
      </section>
    `;
  }

  const items = block.items.map((item) => {
    const metric = item.match(/^([^:]{2,40}):\s*(.+)$/);
    if (metric) {
      return `<li><strong>${escapeHtml(metric[1])}:</strong> ${escapeHtml(metric[2])}</li>`;
    }
    return `<li>${escapeHtml(item)}</li>`;
  }).join("");

  return `
    <section class="report-section">
      <h3>${escapeHtml(block.heading)}</h3>
      ${items ? `<ul>${items}</ul>` : ""}
    </section>
  `;
}

function renderShortReport(blocks) {
  const scoreBlock = blocks.find((block) => block.type === "score");
  const whatWentWell = findReportSection(blocks, "What went well");
  const mainOpportunity = findReportSection(blocks, "Main opportunity");
  const nextCallDirection = findReportSection(blocks, "Next call direction");

  const best = firstUsefulItem(whatWentWell?.items) || "Repeat the strongest Discovery, listening, Match, Invite, or call-control behavior from this call.";
  const improve = firstUsefulItem(mainOpportunity?.items) || "Keep building each question from what the prospect just said, then move clearly toward a specific appointment.";
  const example = firstUsefulItem(nextCallDirection?.items) || extractExample(improve) || "Try: “Based on what you shared, what would make it worth coming in for a first appointment this week?”";

  return `
    <section class="quick-report">
      ${scoreBlock ? renderReportBlock(scoreBlock) : ""}
      <div class="quick-report-grid">
        <article>
          <p>Best: repeat this</p>
          <h3>${escapeHtml(best)}</h3>
        </article>
        <article>
          <p>Next time: improve this</p>
          <h3>${escapeHtml(improve)}</h3>
          <div class="try-this">
            <strong>Try this:</strong>
            <span>${escapeHtml(example)}</span>
          </div>
        </article>
      </div>
    </section>
  `;
}

function findReportSection(blocks, heading) {
  return blocks.find((block) => block.type === "section" && block.heading.toLowerCase() === heading.toLowerCase());
}

function firstUsefulItem(items = []) {
  return items.map((item) => item.trim()).find(Boolean) || "";
}

function extractExample(text) {
  const quoted = String(text || "").match(/[“"]([^”"]{20,})[”"]/);
  return quoted?.[1] || "";
}

function formatScore(value) {
  if (value === null || value === undefined || value === "") return "-";
  const match = String(value).match(/(\d+(?:\.\d+)?)/);
  if (match) return match[1];
  return String(value).replace(/\s*\/\s*10\b/i, "").trim() || "-";
}

function formatDelta(value) {
  if (value === null || value === undefined) return "-";
  if (value > 0) return `+${value}`;
  return String(value);
}

function formatPercent(value) {
  return value === null || value === undefined ? "-" : `${value}%`;
}

function formatNumber(value) {
  return String(value ?? 0);
}

function emptyRow(columns, text) {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(text)}</td></tr>`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatDateOnly(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "option";
}

function toggleMute() {
  state.muted = !state.muted;
  for (const track of state.localStream?.getAudioTracks() || []) {
    track.enabled = !state.muted;
  }
  els.muteButton.textContent = state.muted ? "Unmute" : "Mute";
}

function sendClientEvent(event) {
  if (state.dc?.readyState === "open") {
    state.dc.send(JSON.stringify(event));
  }
}

function cleanupConnection() {
  for (const track of state.localStream?.getTracks() || []) track.stop();
  state.localStream = null;
  state.dc?.close();
  state.dc = null;
  state.pc?.close();
  state.pc = null;
}

function prepareForNextPractice() {
  cleanupConnection();
  state.current = { user: null, assistant: null };
  state.selected = null;
  state.muted = false;
  state.pendingProgressSetup = null;
  els.startButton.disabled = false;
  els.startButton.textContent = "Start live role-play";
  els.muteButton.textContent = "Mute";
  els.muteButton.disabled = true;
  els.endButton.disabled = true;
  els.endButton.textContent = "End and evaluate";
  renderSkillPracticeBanner(null);
  updateSetupPreview();
}

function resetSessionUi() {
  cleanupConnection();
  state.transcript = [];
  state.current = { user: null, assistant: null };
  state.selected = null;
  state.muted = false;
  els.transcript.innerHTML = "";
  els.transcript.classList.remove("expanded");
  els.toggleTranscriptButton.textContent = "Expand transcript";
  renderReport("");
  els.saveStatus.textContent = "";
  renderMeta(state.setup);
  els.muteButton.textContent = "Mute";
  els.muteButton.disabled = true;
  els.endButton.disabled = true;
  els.endButton.textContent = "End and evaluate";
  renderSkillPracticeBanner(state.setup?.practiceMode === "skill" ? state.setup.focusSkill : null);
}

function setBusy(isBusy, statusText = "") {
  els.startButton.disabled = isBusy;
  els.startButton.textContent = isBusy ? "Starting..." : "Start live role-play";
  if (statusText) els.eventStatus.textContent = statusText;
}

function setStatus(title, detail) {
  els.statusTitle.textContent = title;
  els.eventStatus.textContent = detail;
}

function waitForIceGathering(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1500);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function makeEventId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
