import crypto from "node:crypto";

export function createAccessGate({ password = "", production = false, origin = "" }) {
  if ((production || password) && password.length < 16) {
    throw new Error("Set APP_PASSWORD to a shared password of at least 16 characters before starting.");
  }
  const enabled = Boolean(password);
  const cookieName = production ? "__Host-ffb_session" : "ffb_session";
  const sessions = new Map();
  const failures = new Map();
  const lifetime = 8 * 60 * 60 * 1000;
  const passwordDigest = crypto.createHash("sha256").update(password).digest();

  function reply(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }
  function redirect(res, target) {
    res.writeHead(303, { Location: target });
    res.end();
  }
  function token(req) {
    return String(req.headers.cookie || "").split(";")
      .map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || "";
  }
  function cookie(value, maxAge) {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? "; Secure" : ""}`;
  }
  function prune() {
    const now = Date.now();
    for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
    for (const [key, item] of failures) if (item.until <= now) failures.delete(key);
  }

  return async function gate(req, res, url) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=(), geolocation=()");
    if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    prune();

    if (req.method === "GET" && url.pathname === "/healthz") {
      reply(res, 200, { ok: true });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/login-mode") {
      reply(res, 200, { mode: "shared" });
      return true;
    }
    if (enabled && !["GET", "HEAD"].includes(req.method)) {
      const expectedOrigin = origin || `${production ? "https" : "http"}://${req.headers.host}`;
      if (req.headers.origin !== expectedOrigin) {
        reply(res, 403, { error: "Request origin is not allowed." });
        return true;
      }
    }
    const sessionToken = token(req);
    const authenticated = !enabled || (sessions.get(sessionToken) || 0) > Date.now();

    if (req.method === "POST" && url.pathname === "/login") {
      if (!enabled) { redirect(res, "/"); return true; }
      const address = req.socket.remoteAddress || "unknown";
      const failure = failures.get(address);
      if (failure && failure.count >= 10) {
        res.setHeader("Retry-After", String(Math.ceil((failure.until - Date.now()) / 1000)));
        reply(res, 429, { error: "Too many attempts. Please try again in a few minutes." });
        return true;
      }
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 8192) { reply(res, 413, { error: "Request too large." }); return true; }
        chunks.push(chunk);
      }
      let supplied;
      try { supplied = JSON.parse(Buffer.concat(chunks).toString("utf8")).password; }
      catch { reply(res, 400, { error: "Invalid sign-in request." }); return true; }
      const digest = crypto.createHash("sha256").update(typeof supplied === "string" ? supplied : "").digest();
      if (!crypto.timingSafeEqual(digest, passwordDigest)) {
        failures.set(address, { count: (failure?.count || 0) + 1, until: failure?.until || Date.now() + 5 * 60 * 1000 });
        reply(res, 401, { error: "Incorrect password." });
        return true;
      }
      failures.delete(address);
      if (sessions.size >= 1000) { reply(res, 503, { error: "Please try again later." }); return true; }
      sessions.delete(sessionToken);
      const newToken = crypto.randomBytes(32).toString("hex");
      sessions.set(newToken, Date.now() + lifetime);
      res.setHeader("Set-Cookie", cookie(newToken, lifetime / 1000));
      reply(res, 200, { ok: true });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/logout") {
      sessions.delete(sessionToken);
      res.setHeader("Set-Cookie", cookie("", 0));
      redirect(res, "/login");
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/auth" && authenticated) {
      reply(res, 200, { enabled });
      return true;
    }
    if (req.method === "GET" && ["/login", "/login.html", "/login.js", "/styles.css", "/favicon.png", "/brand-logo.png"].includes(url.pathname)) {
      if (authenticated && ["/login", "/login.html"].includes(url.pathname)) {
        redirect(res, "/"); return true;
      }
      return false;
    }
    if (!authenticated) {
      if (url.pathname.startsWith("/api/") || req.method !== "GET") reply(res, 401, { error: "Sign in to continue." });
      else redirect(res, "/login");
      return true;
    }
    return false;
  };
}
