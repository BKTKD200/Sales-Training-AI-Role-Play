import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { brandByCenter, brands, centers, curveBallChallenges, employeesByCenter, prospectProfiles, randomObjections } from "./config/appConfig.js";
import { buildLiveRoleplayInstructions } from "./prompts/liveRoleplay.js";
import { buildEvaluatorInstructions } from "./prompts/evaluator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data", "sessions");
const skillPracticeDir = path.join(__dirname, "data", "skill-practices");

loadDotEnv();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const liveModel = process.env.LIVE_MODEL || "gpt-live-1";
const evaluatorModel = process.env.EVALUATOR_MODEL || "gpt-5.1";
const weeklyPracticeTarget = Number(process.env.WEEKLY_PRACTICE_TARGET || 10);
const dailyPracticeTarget = Number(process.env.DAILY_PRACTICE_TARGET || 2);
let prospectProfileDeck = [];
let prospectGenderDeck = [];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, {
        centers,
        employeesByCenter,
        brandByCenter,
        brands: Object.keys(brands),
        difficulties: ["Beginner", "Curve Balls"],
        callDirections: ["inbound", "outbound"],
        curveBallChallenges: Object.entries(curveBallChallenges).map(([id, value]) => ({
          id,
          label: value.label,
        })),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, {
        ready: hasUsableApiKey(),
        hasApiKey: hasUsableApiKey(),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      return await handleDashboard(url, res);
    }

    if (req.method === "GET" && url.pathname === "/api/progress") {
      return await handleProgress(url, res);
    }

    if (req.method === "POST" && url.pathname === "/api/setup-key") {
      return await handleSetupKey(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/live-session") {
      return await handleLiveSession(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      return await handleEvaluate(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/skill-practice") {
      return await handleSkillPractice(req, res);
    }

    if (req.method === "GET") {
      return await serveStatic(url.pathname, res);
    }

    sendJson(res, { error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || "Unexpected server error" }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`FFB Voice Role-Play Training MVP running at http://${host}:${port}`);
});

async function handleLiveSession(req, res) {
  requireApiKey();

  const body = await readJson(req);
  const setup = normalizeSetup(body.setup || {});
  const offerSdp = String(body.sdp || "");

  if (!offerSdp.startsWith("v=")) {
    return sendJson(res, { error: "Missing browser SDP offer." }, 400);
  }

  const selected = selectProspectAndObjection(setup);
  const instructions = buildLiveRoleplayInstructions({
    setup: { ...setup, brandFacts: brands[setup.brand] },
    prospect: selected.prospect,
    objection: selected.objection,
  });

  const response = await fetch("https://api.openai.com/v1/live/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": hashSafetyId(`${setup.employeeName}:${setup.center}`),
    },
    body: JSON.stringify({
      session: {
        model: liveModel,
        instructions,
        store: false,
        audio: {
          output: {
            voice: "marin",
          },
        },
      },
      transport: {
        type: "webrtc",
        sdp: offerSdp,
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error("Live session error:", text);
    return sendJson(res, { error: "Could not start the live role-play.", detail: safeDetail(text) }, response.status);
  }

  const live = JSON.parse(text);
  sendJson(res, {
    answerSdp: live.transport?.sdp,
    sessionId: live.session?.id,
    selected: {
      objectionType: selected.objectionType,
    },
  });
}

async function handleSetupKey(req, res) {
  const body = await readJson(req);
  const apiKey = String(body.apiKey || "").trim();

  if (!apiKey.startsWith("sk-")) {
    return sendJson(res, { error: "That does not look like an OpenAI API key." }, 400);
  }

  const envPath = path.join(__dirname, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const nextLine = `OPENAI_API_KEY=${apiKey}`;
  let next;

  if (/^OPENAI_API_KEY=/m.test(existing)) {
    next = existing.replace(/^OPENAI_API_KEY=.*$/m, nextLine);
  } else {
    next = `${nextLine}\n${existing}`;
  }

  await writeFile(envPath, next);
  process.env.OPENAI_API_KEY = apiKey;
  sendJson(res, { ok: true });
}

async function handleEvaluate(req, res) {
  requireApiKey();

  const body = await readJson(req);
  const setup = normalizeSetup(body.setup || {});
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const transcriptText = transcriptToText(transcript);

  if (!transcriptText.trim()) {
    return sendJson(res, { error: "No transcript was captured, so evaluation cannot run." }, 400);
  }

  const instructions = buildEvaluatorInstructions({ setup, transcriptText });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": hashSafetyId(`${setup.employeeName}:${setup.center}`),
    },
    body: JSON.stringify({
      model: evaluatorModel,
      input: instructions,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error("Evaluation error:", text);
    return sendJson(res, { error: "Could not evaluate the role-play.", detail: safeDetail(text) }, response.status);
  }

  const result = JSON.parse(text);
  const report = extractResponseText(result);
  const saved = await saveSession({ setup, transcript, transcriptText, report });
  sendJson(res, { report, saved });
}

async function handleSkillPractice(req, res) {
  const body = await readJson(req);
  const setup = normalizeSetup(body.setup || {});
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  if (setup.practiceMode !== "skill" || !setup.focusSkill) {
    return sendJson(res, { error: "Focused skill practice details are required." }, 400);
  }

  const saved = await saveSkillPractice({
    setup,
    transcript,
    transcriptText: transcriptToText(transcript),
  });
  sendJson(res, { saved });
}

async function handleDashboard(url, res) {
  const sessions = await loadSavedSessions();
  const skillPractices = await loadSavedSkillPractices();
  const filters = parseDashboardFilters(url);
  const filtered = sessions.filter((session) => {
    if (filters.centers.length && !filters.centers.includes(session.center)) return false;
    if (filters.employees.length && !filters.employees.includes(session.employeeName)) return false;
    return true;
  });
  const filteredSkillPractices = skillPractices.filter((practice) => {
    if (filters.centers.length && !filters.centers.includes(practice.center)) return false;
    if (filters.employees.length && !filters.employees.includes(practice.employeeName)) return false;
    return true;
  });

  const period1 = filterByDateRange(filtered, filters.period1Start, filters.period1End);
  const period2 = filterByDateRange(filtered, filters.period2Start, filters.period2End);
  const skillPeriod2 = filterByDateRange(filteredSkillPractices, filters.period2Start, filters.period2End);
  const allCenters = unique([...centers, ...sessions.map((session) => session.center), ...skillPractices.map((practice) => practice.center)]);
  const allEmployees = unique([...Object.values(employeesByCenter).flat(), ...sessions.map((session) => session.employeeName), ...skillPractices.map((practice) => practice.employeeName)]);

  sendJson(res, {
    filters: {
      centers: filters.centers,
      employees: filters.employees,
      period1Start: filters.period1Start,
      period1End: filters.period1End,
      period2Start: filters.period2Start,
      period2End: filters.period2End,
    },
    options: {
      centers: allCenters,
      employees: allEmployees,
    },
    aggregate: {
      period1: summarizeSessions(period1),
      period2: summarizeSessions(period2),
      improvement: scoreDelta(period1, period2),
    },
    tracking: buildTracking(period2),
    skillPractice: summarizeSkillPractice(skillPeriod2),
    centers: summarizeByCenter(filtered, filters),
    employees: summarizeByEmployee(filtered, filters),
    recentSessions: filtered
      .slice()
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
      .slice(0, 12),
  });
}

async function handleProgress(url, res) {
  const employeeName = clean(url.searchParams.get("employeeName"));
  const center = clean(url.searchParams.get("center"));
  if (!employeeName || !center) {
    return sendJson(res, { error: "Employee and center are required." }, 400);
  }

  const sessions = await loadSavedSessions();
  const now = new Date();
  const week = weekRange(now);
  const weekSessions = sessions.filter((session) => (
    session.employeeName === employeeName &&
    session.center === center &&
    isWithinRange(session.savedAt, week.start, week.end)
  ));
  const todaySessions = sessions.filter((session) => (
    session.employeeName === employeeName &&
    session.center === center &&
    toDateInputValue(new Date(session.savedAt)) === toDateInputValue(now)
  ));

  sendJson(res, {
    employeeName,
    center,
    weekStart: toDateInputValue(week.start),
    weekEnd: toDateInputValue(week.end),
    weekLabel: `${formatDisplayDate(week.start)} - ${formatDisplayDate(week.end)}`,
    weeklyTarget: weeklyPracticeTarget,
    dailyTarget: dailyPracticeTarget,
    completedThisWeek: weekSessions.length,
    remainingThisWeek: Math.max(0, weeklyPracticeTarget - weekSessions.length),
    completedToday: todaySessions.length,
    remainingToday: Math.max(0, dailyPracticeTarget - todaySessions.length),
  });
}

async function loadSavedSessions() {
  if (!existsSync(dataDir)) return [];
  const files = (await readdir(dataDir)).filter((file) => file.endsWith(".json"));
  const sessions = [];

  for (const file of files) {
    try {
      const raw = await readFile(path.join(dataDir, file), "utf8");
      const parsed = JSON.parse(raw);
      const setup = parsed.setup || {};
      const report = String(parsed.report || "");
      sessions.push({
        id: file,
        employeeName: setup.employeeName || "Unknown",
        center: setup.center || "Unknown",
        brand: setup.brand || "",
        callDirection: setup.callDirection || "",
        difficulty: setup.difficulty || "",
        objectionType: setup.objectionType || "none",
        savedAt: parsed.savedAt || dateFromSessionFilename(file),
        score: extractScore(report),
        appointmentSecured: extractAppointmentSecured(report),
        appointmentAttempted: extractAppointmentAttempted(report),
        mainOpportunity: extractMainOpportunity(report),
        transcript: Array.isArray(parsed.transcript) ? parsed.transcript : [],
        transcriptText: parsed.transcriptText || transcriptToText(Array.isArray(parsed.transcript) ? parsed.transcript : []),
        report,
      });
    } catch (error) {
      console.warn(`Skipping unreadable session ${file}:`, error.message);
    }
  }

  return sessions;
}

async function loadSavedSkillPractices() {
  if (!existsSync(skillPracticeDir)) return [];
  const files = (await readdir(skillPracticeDir)).filter((file) => file.endsWith(".json"));
  const practices = [];

  for (const file of files) {
    try {
      const raw = await readFile(path.join(skillPracticeDir, file), "utf8");
      const parsed = JSON.parse(raw);
      const setup = parsed.setup || {};
      practices.push({
        id: file,
        employeeName: setup.employeeName || "Unknown",
        center: setup.center || "Unknown",
        brand: setup.brand || "",
        focusSkill: setup.focusSkill || "Focused skill",
        savedAt: parsed.savedAt || dateFromSessionFilename(file),
        transcript: Array.isArray(parsed.transcript) ? parsed.transcript : [],
        transcriptText: parsed.transcriptText || transcriptToText(Array.isArray(parsed.transcript) ? parsed.transcript : []),
      });
    } catch (error) {
      console.warn(`Skipping unreadable skill practice ${file}:`, error.message);
    }
  }

  return practices;
}

function parseDashboardFilters(url) {
  const now = new Date();
  const period2End = cleanDate(url.searchParams.get("period2End")) || toDateInputValue(now);
  const period2Start = cleanDate(url.searchParams.get("period2Start")) || toDateInputValue(addDays(new Date(period2End), -30));
  const period1End = cleanDate(url.searchParams.get("period1End")) || toDateInputValue(addDays(new Date(period2Start), -1));
  const period1Start = cleanDate(url.searchParams.get("period1Start")) || toDateInputValue(addDays(new Date(period1End), -30));

  return {
    centers: splitFilter(url.searchParams.get("centers")),
    employees: splitFilter(url.searchParams.get("employees")),
    period1Start,
    period1End,
    period2Start,
    period2End,
  };
}

function splitFilter(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function filterByDateRange(sessions, start, end) {
  const startTime = new Date(`${start}T00:00:00`).getTime();
  const endTime = new Date(`${end}T23:59:59.999`).getTime();
  return sessions.filter((session) => {
    const time = new Date(session.savedAt).getTime();
    return Number.isFinite(time) && time >= startTime && time <= endTime;
  });
}

function summarizeByCenter(sessions, filters) {
  const selectedCenters = filters.centers.length ? filters.centers : [...new Set(sessions.map((session) => session.center))].sort();
  return selectedCenters.map((center) => {
    const centerSessions = sessions.filter((session) => session.center === center);
    const period1 = filterByDateRange(centerSessions, filters.period1Start, filters.period1End);
    const period2 = filterByDateRange(centerSessions, filters.period2Start, filters.period2End);
    return {
      center,
      period1: summarizeSessions(period1),
      period2: summarizeSessions(period2),
      improvement: scoreDelta(period1, period2),
    };
  });
}

function summarizeByEmployee(sessions, filters) {
  const period2 = filterByDateRange(sessions, filters.period2Start, filters.period2End);
  const byEmployee = new Map();
  for (const session of period2) {
    if (!byEmployee.has(session.employeeName)) byEmployee.set(session.employeeName, []);
    byEmployee.get(session.employeeName).push(session);
  }
  return [...byEmployee.entries()]
    .map(([employeeName, employeeSessions]) => ({
      employeeName,
      center: mostCommon(employeeSessions.map((session) => session.center)),
      summary: summarizeSessions(employeeSessions),
    }))
    .sort((a, b) => b.summary.callsCompleted - a.summary.callsCompleted || a.employeeName.localeCompare(b.employeeName));
}

function summarizeSessions(sessions) {
  const scored = sessions.filter((session) => typeof session.score === "number");
  const secured = sessions.filter((session) => session.appointmentSecured === true).length;
  const knownAppointment = sessions.filter((session) => typeof session.appointmentSecured === "boolean").length;
  const attempted = sessions.filter((session) => session.appointmentAttempted === true).length;
  return {
    callsCompleted: sessions.length,
    avgScore: scored.length ? round(scored.reduce((sum, session) => sum + session.score, 0) / scored.length) : null,
    scoredCalls: scored.length,
    appointmentSecuredRate: knownAppointment ? round((secured / knownAppointment) * 100) : null,
    appointmentAttemptedRate: sessions.length ? round((attempted / sessions.length) * 100) : null,
    appointmentAttempts: attempted,
    activeEmployees: new Set(sessions.map((session) => session.employeeName)).size,
  };
}

function buildTracking(sessions) {
  return {
    dailyCompletions: summarizeDailyCompletions(sessions),
    difficultyMix: summarizeCounts(sessions.map((session) => session.difficulty || "Unknown")),
    scoreTrend: summarizeScoreTrend(sessions),
    commonOpportunities: summarizeCounts(sessions.map((session) => session.mainOpportunity).filter(Boolean)).slice(0, 5),
  };
}

function summarizeSkillPractice(practices) {
  return {
    completed: practices.length,
    activeEmployees: new Set(practices.map((practice) => practice.employeeName)).size,
    skillsPracticed: summarizeCounts(practices.map((practice) => practice.focusSkill)).slice(0, 6),
    recentPractices: practices
      .slice()
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
      .slice(0, 8),
  };
}

function summarizeDailyCompletions(sessions) {
  const counts = new Map();
  for (const session of sessions) {
    const date = toDateInputValue(new Date(session.savedAt));
    counts.set(date, (counts.get(date) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

function summarizeScoreTrend(sessions) {
  const byDate = new Map();
  for (const session of sessions) {
    if (typeof session.score !== "number") continue;
    const date = toDateInputValue(new Date(session.savedAt));
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(session.score);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => ({
      date,
      avgScore: round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    }));
}

function summarizeCounts(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

function scoreDelta(period1, period2) {
  const first = summarizeSessions(period1).avgScore;
  const second = summarizeSessions(period2).avgScore;
  if (first === null || second === null) return null;
  return round(second - first);
}

function extractScore(report) {
  const match = String(report || "").match(/Overall score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  if (!match) return null;
  const score = Number(match[1]);
  return Number.isFinite(score) ? score : null;
}

function extractAppointmentSecured(report) {
  const inviteLine = String(report || "").split(/\r?\n/).find((line) => /Invite|appointment that shows/i.test(line));
  if (!inviteLine) return null;
  if (/\b(no|not|did not|didn't|failed|missed|was not|wasn't)\b/i.test(inviteLine)) return false;
  if (/\b(secured|confirmed|scheduled|booked|set|accepted|yes)\b/i.test(inviteLine)) return true;
  return null;
}

function extractAppointmentAttempted(report) {
  const inviteLine = String(report || "").split(/\r?\n/).find((line) => /Invite|appointment that shows/i.test(line));
  if (!inviteLine) return false;
  if (/\b(asked|offered|attempted|invited|scheduled|booked|set|secured|confirmed)\b/i.test(inviteLine)) return true;
  return false;
}

function extractMainOpportunity(report) {
  const lines = String(report || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => /^Main opportunity:?$/i.test(line));
  if (index === -1) return "";
  const next = lines[index + 1] || "";
  return next.replace(/^[-*]\s*/, "");
}

function dateFromSessionFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
  return match ? match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z") : new Date().toISOString();
}

function cleanDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function weekRange(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function isWithinRange(value, start, end) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function formatDisplayDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeSetup(raw) {
  const setup = {
    employeeName: clean(raw.employeeName),
    center: clean(raw.center),
    brand: "",
    callDirection: clean(raw.callDirection).toLowerCase(),
    difficulty: clean(raw.difficulty),
    objectionType: clean(raw.objectionType) || "none",
    practiceMode: clean(raw.practiceMode),
    focusSkill: clean(raw.focusSkill),
  };

  if (!setup.employeeName) throw new Error("Employee name is required.");
  if (!centers.includes(setup.center)) throw new Error("Choose a configured center.");
  setup.brand = clean(brandByCenter[setup.center] || raw.brand).toUpperCase();
  if (employeesByCenter[setup.center]?.length && !employeesByCenter[setup.center].includes(setup.employeeName)) {
    throw new Error("Choose a configured employee for this center.");
  }
  if (!brands[setup.brand]) throw new Error("This center needs a configured brand.");
  if (!["inbound", "outbound"].includes(setup.callDirection)) throw new Error("Choose inbound or outbound.");
  if (!["Beginner", "Curve Balls", "Skill Practice"].includes(setup.difficulty)) throw new Error("Choose Beginner, Curve Balls, or Skill Practice.");
  if (setup.practiceMode === "skill" && !setup.focusSkill) throw new Error("Choose a skill to practice.");
  if (setup.difficulty !== "Curve Balls") setup.objectionType = "none";
  if (setup.difficulty === "Curve Balls" && !curveBallChallenges[setup.objectionType]) {
    throw new Error("Choose a curve ball challenge.");
  }

  return setup;
}

function selectProspectAndObjection(setup) {
  const prospect = drawProspectProfile();
  const prospectGender = drawProspectGender();
  let objectionType = setup.objectionType;
  let objection = null;

  if (setup.difficulty === "Curve Balls") {
    objection = { ...curveBallChallenges[objectionType] };
    if (objectionType === "random") {
      objection.selectedRandom = randomObjections[Math.floor(Math.random() * randomObjections.length)];
    }
  }

  return { prospect: { ...prospect, gender: prospectGender }, objection, objectionType };
}

function drawProspectProfile() {
  if (!prospectProfileDeck.length) {
    prospectProfileDeck = shuffle([...prospectProfiles]);
  }
  return prospectProfileDeck.pop();
}

function drawProspectGender() {
  if (!prospectGenderDeck.length) {
    prospectGenderDeck = shuffle([
      "male",
      "female",
      "female",
      "female",
      "female",
      "female",
      "female",
      "female",
      "female",
      "female",
    ]);
  }
  return prospectGenderDeck.pop();
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

async function saveSession(record) {
  await mkdir(dataDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = record.setup.employeeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee";
  const filename = `${stamp}-${safeName}-${record.setup.brand}-${record.setup.difficulty.replace(/\s+/g, "-")}.json`;
  const fullPath = path.join(dataDir, filename);
  await writeFile(fullPath, JSON.stringify({ ...record, savedAt: new Date().toISOString() }, null, 2));
  return { filename };
}

async function saveSkillPractice(record) {
  await mkdir(skillPracticeDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = record.setup.employeeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee";
  const safeSkill = record.setup.focusSkill.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "skill";
  const filename = `${stamp}-${safeName}-${safeSkill}.json`;
  const fullPath = path.join(skillPracticeDir, filename);
  await writeFile(fullPath, JSON.stringify({ ...record, savedAt: new Date().toISOString(), recordType: "skill-practice" }, null, 2));
  return { filename };
}

function transcriptToText(transcript) {
  return transcript
    .map((entry) => `${entry.speaker === "assistant" ? "Prospect" : "Representative"}: ${entry.text}`)
    .join("\n");
}

function extractResponseText(result) {
  if (typeof result.output_text === "string" && result.output_text.trim()) {
    return result.output_text.trim();
  }
  const parts = [];
  for (const item of result.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim() || "No evaluator text was returned.";
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(requested).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, normalized);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return sendJson(res, { error: "Not found" }, 404);
  }
  const content = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(content);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function clean(value) {
  return String(value || "").trim();
}

function requireApiKey() {
  if (!hasUsableApiKey()) {
    throw new Error("OPENAI_API_KEY is not set on the server.");
  }
}

function hasUsableApiKey() {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  return key.startsWith("sk-") && key !== "sk-your-project-key";
}

function safeDetail(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.error || "OpenAI API request failed.";
  } catch {
    return text.slice(0, 500);
  }
}

function hashSafetyId(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
