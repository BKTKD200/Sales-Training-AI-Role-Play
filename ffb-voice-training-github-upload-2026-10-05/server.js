import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { brandByCenter, brands, centers, curveBallChallenges, employeesByCenter, prospectProfiles, randomObjections } from "./config/appConfig.js";
import { buildLiveRoleplayInstructions } from "./prompts/liveRoleplay.js";
import { buildEvaluatorInstructions } from "./prompts/evaluator.js";
import { createAccessGate } from "./accessGate.js";
import { createStorage, recordFilename } from "./storage.js";
import { createAccountGate, readBody } from "./accountAuth.js";
import { handleAdmin } from "./adminApi.js";
import { authorizedSetup, visibleRoster as rosterForUser, dashboardOptions } from "./accessPolicy.js";

// Hostinger's LiteSpeed launcher requires this module synchronously.
// Keep asynchronous database/auth initialization inside startup, not at module scope.
async function start() {
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
loadDotEnv();

const storageRoot = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
if(process.env.NODE_ENV==='production'&&process.env.STORAGE_MODE!=='mysql')throw new Error('Production requires STORAGE_MODE=mysql so updates retain training data.');
if(process.env.AUTH_MODE&&!['shared','accounts'].includes(process.env.AUTH_MODE))throw new Error('AUTH_MODE must be shared or accounts.');
const store = await createStorage(process.env, storageRoot);
const accountsEnabled = process.env.AUTH_MODE === "accounts";
const accessGate = accountsEnabled ? await createAccountGate({store, env:process.env}) : createAccessGate({
  password: process.env.APP_PASSWORD || "",
  production: process.env.NODE_ENV === "production",
  origin: process.env.APP_ORIGIN || "",
});

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
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (await accessGate(req, res, url)) return;
    if (await handleAdmin(req, res, url, store, employeesByCenter)) return;
    if (req.method === "GET" && url.pathname === "/api/login-mode") return sendJson(res,{mode:"shared"});
    if (req.method === "GET" && url.pathname === "/account") return await serveStatic("/account.html", res);
    if (req.method === "GET" && url.pathname === "/admin") return await serveStatic("/admin.html", res);
    if (req.method === "GET" && url.pathname === "/login") return await serveStatic("/login.html", res);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, {
        centers: Object.keys(visibleRoster(req.user)),
        employeesByCenter: visibleRoster(req.user),
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
      return await handleDashboard(url, res, req.user);
    }

    if (req.method === "GET" && url.pathname === "/api/progress") {
      return await handleProgress(url, res, req.user);
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
  const setup = normalizeSetup(authorizedSetup(body.setup || {}, req.user));
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

async function handleEvaluate(req, res) {
  const body = await readJson(req);
  let existing;
  if (body.recordId) {
    if(typeof body.recordId !== 'string' || !/^[-a-zA-Z0-9._]{1,250}\.json$/.test(body.recordId))return sendJson(res,{error:'Invalid saved practice identifier.'},400);
    existing = (await store.listRecords('call', req.user, {ids:[body.recordId]})).find(record => record.filename === body.recordId);
    if (!existing) return sendJson(res, {error:'Saved practice was not found in your accessible history.'}, 404);
    if (existing.evaluationStatus !== 'pending') return sendJson(res, {report:existing.report,saved:{filename:existing.filename}});
  }
  const setup = normalizeSetup(authorizedSetup(existing?.setup || body.setup || {}, req.user));
  const transcript = existing?.transcript || (Array.isArray(body.transcript) ? body.transcript : []);
  const transcriptText = transcriptToText(transcript);

  if (!transcriptText.trim()) {
    return sendJson(res, { error: "No transcript was captured, so evaluation cannot run." }, 400);
  }

  const pending = existing || {setup,transcript,transcriptText,report:'',evaluationStatus:'pending',savedAt:new Date().toISOString(),recordedBy:req.user?.id||null};
  const saved = existing ? {filename:existing.filename} : await saveSession(pending, req.user?.id);
  try {
  requireApiKey();
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
    signal: AbortSignal.timeout(120000),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error("Evaluation error:", text);
    throw new Error('Evaluation service is unavailable. Your transcript is saved; retry evaluation from your dashboard.');
  }

  const result = JSON.parse(text);
  const report = extractResponseText(result);
  if (!report || report === 'No evaluator text was returned.' || extractScore(report) === null) throw new Error('No scored evaluation was returned. Your transcript is saved; retry evaluation from your dashboard.');
  const {filename, ...record} = pending;
  const outcome = extractAppointmentOutcome(report);
  await store.updateRecord('call',saved.filename,{...record,report,evaluationStatus:'complete',appointmentOutcome:{...outcome,source:'report-section-v2'},dashboardSummary:{score:extractScore(report),appointmentSecured:outcome.secured,appointmentAttempted:outcome.attempted,mainOpportunity:extractMainOpportunity(report)}},req.user);
  sendJson(res, { report, saved });
  } catch (error) {
    console.error('Saved practice awaiting evaluation:', error.message);
    sendJson(res,{saved,pending:true,error:'Your transcript is saved. Evaluation is pending; use Retry evaluation in your dashboard.'});
  }
}

async function handleSkillPractice(req, res) {
  const body = await readJson(req);
  const setup = normalizeSetup(authorizedSetup(body.setup || {}, req.user));
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  if (setup.practiceMode !== "skill" || !setup.focusSkill) {
    return sendJson(res, { error: "Focused skill practice details are required." }, 400);
  }
  if (!transcriptToText(transcript).trim()) return sendJson(res,{error:'No transcript was captured, so the drill cannot be saved.'},400);

  const saved = await saveSkillPractice({
    setup,
    transcript,
    transcriptText: transcriptToText(transcript),
  }, req.user?.id);
  sendJson(res, { saved });
}

async function handleDashboard(url, res, user) {
  const savedSessions = await loadSavedSessions(user);
  const sessions = savedSessions.filter(session => session.evaluationStatus !== 'pending');
  const skillPractices = await loadSavedSkillPractices(user);
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
  const options = dashboardOptions(user, employeesByCenter, [...sessions, ...skillPractices]);
  const history = filterByDateRange(savedSessions.filter(session => (!filters.centers.length || filters.centers.includes(session.center)) && (!filters.employees.length || filters.employees.includes(session.employeeName))), filters.period2Start, filters.period2End).sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt)||a.id.localeCompare(b.id));
  const requestedPage = Math.max(0,Math.floor(Number(url.searchParams.get('historyPage'))||0));
  const historyPage = Math.min(requestedPage,Math.max(0,Math.ceil(history.length/12)-1));
  const recentIds = history.slice(historyPage*12,historyPage*12+12).map(session=>session.id);
  const recentSessions = recentIds.length ? await loadSavedSessions(user,recentIds) : [];

  sendJson(res, {
    filters: {
      centers: filters.centers,
      employees: filters.employees,
      period1Start: filters.period1Start,
      period1End: filters.period1End,
      period2Start: filters.period2Start,
      period2End: filters.period2End,
    },
    options,
    aggregate: {
      period1: summarizeSessions(period1),
      period2: summarizeSessions(period2),
      improvement: scoreDelta(period1, period2),
    },
    tracking: buildTracking(period2),
    skillPractice: summarizeSkillPractice(skillPeriod2),
    centers: summarizeByCenter(filtered, {...filters, centers: filters.centers.length ? filters.centers.filter(center => options.centers.includes(center)) : options.centers}),
    employees: summarizeByEmployee(filtered, filters),
    history: {page:historyPage,total:history.length,hasMore:(historyPage+1)*12<history.length},
    recentSessions: recentIds.map(id=>recentSessions.find(session=>session.id===id)).filter(Boolean),
  });
}

async function handleProgress(url, res, user) {
  const employeeName = user?.role === "trainer" ? user.employeeName : clean(url.searchParams.get("employeeName"));
  const center = user?.role === "trainer" ? user.center : clean(url.searchParams.get("center"));
  if(user?.role==='manager'&&!user.allowedCenters.includes(center))return sendJson(res,{error:'Center access is not allowed.'},403);
  if (!employeeName || !center) {
    return sendJson(res, { error: "Employee and center are required." }, 400);
  }

  const sessions = (await loadSavedSessions(user)).filter(session => session.evaluationStatus !== 'pending');
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

async function loadSavedSessions(user, ids) {
  return (await store.listRecords('call',user,{summary:!ids,ids})).filter(record=>!ids||ids.includes(record.filename)).map(parsed=>{
    const setup=parsed.setup||{};const report=String(parsed.report||'');
    const summary=parsed.dashboardSummary;
    return {id:parsed.filename,evaluationStatus:parsed.evaluationStatus||'complete',employeeName:setup.employeeName||'Unknown',center:setup.center||'Unknown',brand:setup.brand||'',callDirection:setup.callDirection||'',difficulty:setup.difficulty||'',objectionType:setup.objectionType||'none',savedAt:parsed.savedAt||dateFromSessionFilename(parsed.filename),score:summary?.score??extractScore(report),appointmentSecured:summary?summary.appointmentSecured:extractAppointmentSecured(report),appointmentAttempted:summary?summary.appointmentAttempted:extractAppointmentAttempted(report),mainOpportunity:summary?.mainOpportunity??extractMainOpportunity(report),transcript:parsed.transcript||[],transcriptText:parsed.transcriptText||transcriptToText(parsed.transcript||[]),report};
  });
}
async function loadSavedSkillPractices(user) {
  return (await store.listRecords('skill',user,{summary:true})).map(parsed=>{const setup=parsed.setup||{};return {id:parsed.filename,employeeName:setup.employeeName||'Unknown',center:setup.center||'Unknown',brand:setup.brand||'',focusSkill:setup.focusSkill||'Focused skill',savedAt:parsed.savedAt||dateFromSessionFilename(parsed.filename),transcript:parsed.transcript||[],transcriptText:parsed.transcriptText||transcriptToText(parsed.transcript||[])};});
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
  return sessions.filter((session) => {
    const date = new Date(session.savedAt);
    if (!Number.isFinite(date.getTime())) return false;
    const day = toDateInputValue(date);
    return day >= start && day <= end;
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
    const key = JSON.stringify([session.center, session.employeeName]);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(session);
  }
  return [...byEmployee.entries()]
    .map(([, employeeSessions]) => ({
      employeeName: employeeSessions[0].employeeName,
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
    appointmentsSecured: secured,
    appointmentOutcomesKnown: knownAppointment,
    appointmentOutcomesUnknown: sessions.length - knownAppointment,
    activeEmployees: new Set(sessions.map((session) => JSON.stringify([session.center, session.employeeName]))).size,
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
  return extractAppointmentOutcome(report).secured;
}

function extractAppointmentAttempted(report) {
  return extractAppointmentOutcome(report).attempted;
}

function extractAppointmentOutcome(report) {
  const lines = String(report || "").replace(/\*\*/g, "").split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*[-#*]*\s*Invite\s*\/\s*appointment that shows\s*:/i.test(line));
  if (start < 0) return {secured: null, attempted: false};
  const section = [lines[start].replace(/^.*?appointment that shows\s*:/i, "")];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !/^[-*]\s/.test(line)) break;
    if (/^[-*]\s+(?:Discovery|Active listening|Personal motivation|Match|Information discipline|Call Control)\s*:/i.test(line)) break;
    if (/^\s*[-*]?\s*(?:missing step|to improve|(?:small )?opportunity|(?:you|the rep) should|(?:you|the rep) could have|for example)\b/i.test(line)) break;
    section.push(line);
  }
  const text = section.join("\n").replace(/[‑–—]/g, "-");
  const noAttempt = /\bno (?:clear )?(?:invitation|invite|ask|attempt)(?:\b|ation)|\bno appointment (?:was )?(?:requested|request)|\b(?:did not|didn't|never) (?:ask|invite|offer|attempt)/i.test(text);
  const notBooked = /\bno (?:specific |confirmed |firm )?appointment(?:\s+\w+){0,5}\s(?:secured|set|booked|scheduled|made)|\b(?:did not|didn't|never) (?:secure|book|schedule|confirm)|\bprospect (?:declined|refused)|\b(?:declined|refused) (?:the |an? )?(?:visit|appointment|invite)/i.test(text);
  if (noAttempt) return {secured: false, attempted: false};
  const hasTime = /\b\d{1,2}(?::\d{2}|\s*(?:a\.?m\.?|p\.?m\.?|o.clock))\b|\b(?:tomorrow|tonight|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(text);
  const booked = /\b(?:booked|secured|secures|locked (?:in|down)|got (?:a |verbal |a specific )?(?:agreement|commitment|time))\b/i.test(text) || (hasTime && /\b(?:confirmed|confirms|committed|agreed|accepted|chose|chooses|specific appointment|specific time|verbal commitment|verbally confirming)\b/i.test(text));
  const attempted = (!notBooked && booked) || /\b(?:clear|strong|direct|confident|verbal)\s+(?:\w+\s+)?invite\b|\b(?:invited|invitation|offered|asked|attempted)\b/i.test(text);
  return {secured: notBooked ? false : booked ? true : null, attempted};
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
  toDateInputValue.formatter ||= new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
  const parts = toDateInputValue.formatter.formatToParts(date);
  const part = type => parts.find(value=>value.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function weekRange(date) {
  const start = new Date(`${toDateInputValue(date)}T12:00:00Z`);
  const day = start.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diffToMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start, end };
}

function isWithinRange(value, start, end) {
  return filterByDateRange([{savedAt:value}],toDateInputValue(start),toDateInputValue(end)).length > 0;
}

function formatDisplayDate(date) {
  return date.toLocaleDateString("en-US", {timeZone:'America/New_York', month: "short", day: "numeric", year: "numeric" });
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

async function saveSession(record,userId) {
  return store.saveRecord('call',recordFilename('call',record),{...record,savedAt:new Date().toISOString()},userId||null);
}
async function saveSkillPractice(record,userId) {
  return store.saveRecord('skill',recordFilename('skill',record),{...record,savedAt:new Date().toISOString(),recordType:'skill-practice'},userId||null);
}
function visibleRoster(user) {
  return rosterForUser(user,employeesByCenter);
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
  return readBody(req);
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
}

start().catch((error) => {
  console.error('FFB startup failed:', error);
  process.exit(1);
});
