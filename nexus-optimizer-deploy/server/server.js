"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  config,
  db,
  audit,
  nowIso,
  addDays,
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  normalizeCode,
  hashCode,
  makeCode,
  codeHint,
  safeEqual,
  parseCookies,
  addCookie,
  cookieString,
  clientIp,
  rateLimit,
  seedOwner,
  licenseStatus,
  inviteStatus,
} = require("./lib");
const views = require("./views");

let owner = seedOwner();
let setupState = null;
if (!owner.password_hash) {
  setupState = {
    token: randomToken(24),
    expires: Date.now() + config.setupMinutes * 60000,
  };
}

/* ------------------------------------------------------------------ helpers */

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; " +
      "base-uri 'self'; form-action 'self'"
  );
  if (config.secureCookies) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader("Location", location);
  res.end("");
}

function errorPage(res, status, message) {
  html(res, status, views.errorPage(status, message));
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > (limit || 65536)) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

async function formBody(req) {
  const raw = await readBody(req, 65536);
  return Object.fromEntries(new URLSearchParams(raw));
}

async function jsonBody(req) {
  const raw = await readBody(req, 32768);
  if (!raw) return {};
  return JSON.parse(raw);
}

function csrfCookie(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies.nexus_csrf;
  if (!token || !/^[A-Za-z0-9_-]{32,80}$/.test(token)) {
    token = randomToken(24);
    addCookie(
      res,
      cookieString("nexus_csrf", token, {
        maxAge: config.sessionDays * 86400,
        httpOnly: true,
        secure: config.secureCookies,
      })
    );
  }
  return token;
}

function csrfFor(req, res, session) {
  return session ? session.csrf : csrfCookie(req, res);
}

function verifyCsrf(req, body, session) {
  const cookies = parseCookies(req.headers.cookie);
  const expected = session ? session.csrf : cookies.nexus_csrf;
  return safeEqual(body._csrf, expected);
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies.nexus_session;
  if (!raw) return null;
  const row = db
    .prepare(
      "SELECT s.id AS session_id, s.csrf, s.expires_at, u.id, u.username, u.email, u.role, u.status AS user_status, u.created_at " +
        "FROM sessions s JOIN users u ON u.id = s.user_id " +
        "WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'"
    )
    .get(sha256(raw), nowIso());
  if (!row) return null;
  return {
    csrf: row.csrf,
    user: {
      id: Number(row.id),
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.user_status,
      created_at: row.created_at,
    },
  };
}

function createSession(req, res, user) {
  const raw = randomToken(32);
  const csrf = randomToken(24);
  const expires = addDays(config.sessionDays);
  db.prepare(
    "INSERT INTO sessions (id, user_id, csrf, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    sha256(raw),
    user.id,
    csrf,
    nowIso(),
    expires,
    clientIp(req),
    String(req.headers["user-agent"] || "").slice(0, 200)
  );
  addCookie(
    res,
    cookieString("nexus_session", raw, {
      maxAge: config.sessionDays * 86400,
      httpOnly: true,
      secure: config.secureCookies,
    })
  );
  return csrf;
}

function clearSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.nexus_session) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(cookies.nexus_session));
  }
  addCookie(res, "nexus_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" + (config.secureCookies ? "; Secure" : ""));
}

function requireCustomer(req, res) {
  const session = getSession(req);
  if (!session) {
    redirect(res, "/login");
    return null;
  }
  if (session.user.role !== "customer") {
    redirect(res, "/admin");
    return null;
  }
  return session;
}

function requireOwner(req, res) {
  const session = getSession(req);
  if (!session) {
    redirect(res, "/login");
    return null;
  }
  if (session.user.role !== "owner") {
    errorPage(res, 403, "Owner access only.");
    return null;
  }
  return session;
}

function adminData() {
  const now = nowIso();
  const customers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'customer'").get().c;
  const activeLicenses = db
    .prepare(
      "SELECT COUNT(*) AS c FROM licenses WHERE revoked_at IS NULL AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)"
    )
    .get(now).c;
  const activations = db
    .prepare("SELECT COUNT(*) AS c FROM activations WHERE revoked_at IS NULL")
    .get().c;
  const unusedInvites = db
    .prepare(
      "SELECT COUNT(*) AS c FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)"
    )
    .get(now).c;

  const invites = db
    .prepare(
      "SELECT i.*, u.username AS used_by_username FROM invites i " +
        "LEFT JOIN users u ON u.id = i.used_by ORDER BY i.id DESC LIMIT 40"
    )
    .all()
    .map(function (invite) {
      invite.status = inviteStatus(invite);
      return invite;
    });

  const licenses = db
    .prepare(
      "SELECT l.*, u.email, " +
        "(SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.revoked_at IS NULL) AS activation_count, " +
        "(SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.revoked_at IS NULL) AS used_devices " +
        "FROM licenses l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 60"
    )
    .all()
    .map(function (license) {
      license.status = licenseStatus(license);
      return license;
    });

  const users = db
    .prepare(
      "SELECT u.*, (SELECT COUNT(*) FROM licenses l WHERE l.user_id = u.id) AS license_count " +
        "FROM users u WHERE u.role = 'customer' ORDER BY u.id DESC LIMIT 60"
    )
    .all();

  const auditRows = db
    .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 12")
    .all();

  return {
    stats: {
      customers,
      activeLicenses,
      activations,
      unusedInvites,
    },
    invites,
    licenses,
    users,
    audit: auditRows,
  };
}

function renderAdmin(req, res, session, options) {
  const opts = options || {};
  html(
    res,
    opts.status || 200,
    views.adminPage({
      user: session.user,
      csrf: session.csrf,
      data: adminData(),
      generated: opts.generated,
      flash: opts.flash,
      error: opts.error,
    })
  );
}

function findLicenseByKey(key) {
  return db.prepare("SELECT * FROM licenses WHERE license_key = ?").get(String(key || "").trim().toUpperCase());
}

/* -------------------------------------------------------------------- routes */

async function handle(req, res) {
  setSecurityHeaders(res);
  req.setTimeout(15000);
  const parsed = new URL(req.url, config.baseUrl);
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch (error) {
    return errorPage(res, 400, "Bad request.");
  }
  const ip = clientIp(req);

  if (pathname.startsWith("/api/v1/")) {
    return apiRoute(req, res, pathname, ip);
  }

  if (pathname === "/login") {
    if (req.method === "GET") {
      const session = getSession(req);
      if (session) return redirect(res, session.user.role === "owner" ? "/admin" : "/portal");
      return html(res, 200, views.loginPage(csrfCookie(req, res), null));
    }
    if (req.method === "POST") {
      if (!rateLimit("login", ip, 12, 15 * 60000)) {
        return errorPage(res, 429, "Too many attempts. Try again later.");
      }
      const body = await formBody(req);
      if (!verifyCsrf(req, body, null)) {
        return errorPage(res, 403, "Invalid form token. Reload the page.");
      }
      const identity = String(body.identity || "").trim();
      const password = String(body.password || "");
      const ownerRow = db.prepare("SELECT * FROM users WHERE role = 'owner' LIMIT 1").get();
      let user = null;
      if (ownerRow && identity.toLowerCase() === String(ownerRow.username).toLowerCase()) {
        user = ownerRow;
      } else {
        user = db
          .prepare("SELECT * FROM users WHERE email = ? AND role = 'customer' LIMIT 1")
          .get(identity.toLowerCase());
      }
      if (!user || !verifyPassword(password, user.password_hash) || user.status !== "active") {
        audit(null, "login_failed", identity);
        return html(res, 401, views.loginPage(csrfCookie(req, res), "Invalid credentials."));
      }
      clearSession(req, res);
      db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
      createSession(req, res, user);
      audit(user.id, user.role === "owner" ? "admin_login" : "login", user.username);
      return redirect(res, user.role === "owner" ? "/admin" : "/portal");
    }
    return errorPage(res, 405, "Method not allowed.");
  }

  if (pathname === "/portal/login" || pathname === "/admin/login") {
    return redirect(res, "/login");
  }

  if (pathname === "/portal/register") {
    if (req.method === "GET") {
      return html(
        res,
        200,
        views.registerPage(csrfCookie(req, res), String(parsed.searchParams.get("invite") || ""), null)
      );
    }
    if (req.method === "POST") {
      if (!rateLimit("register", ip, 8, 60 * 60000)) {
        return errorPage(res, 429, "Too many attempts. Try again later.");
      }
      const body = await formBody(req);
      if (!verifyCsrf(req, body, null)) {
        return errorPage(res, 403, "Invalid form token. Reload the page.");
      }
      const inviteCode = String(body.invite || "");
      const username = String(body.username || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const password2 = String(body.password2 || "");
      const inviteHash = hashCode(inviteCode);
      const invite = db.prepare("SELECT * FROM invites WHERE code_hash = ? LIMIT 1").get(inviteHash);

      function fail(message, status) {
        return html(
          res,
          status || 400,
          views.registerPage(csrfCookie(req, res), inviteCode, message)
        );
      }

      if (!invite || inviteStatus(invite) !== "active") return fail("This invite code is invalid, used or expired.");
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return fail("Username must be 3–32 characters (letters, numbers, . _ -).");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");
      if (password.length < 10 || password.length > 200) return fail("Password must be at least 10 characters.");
      if (password !== password2) return fail("Passwords do not match.");

      let user;
      try {
        db.exec("BEGIN IMMEDIATE");
        const fresh = db.prepare("SELECT * FROM invites WHERE id = ?").get(invite.id);
        if (!fresh || inviteStatus(fresh) !== "active") throw new Error("invite");
        const result = db
          .prepare(
            "INSERT INTO users (username, email, password_hash, role, status, created_at) VALUES (?, ?, ?, 'customer', 'active', ?)"
          )
          .run(username, email, hashPassword(password), nowIso());
        const userId = Number(result.lastInsertRowid);
        const changed = db
          .prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE id = ? AND used_at IS NULL")
          .run(userId, nowIso(), invite.id);
        if (Number(changed.changes) !== 1) throw new Error("invite");
        db.exec("COMMIT");
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch (rollbackError) {
          /* ignore */
        }
        if (String(error.message).indexOf("UNIQUE constraint failed: users.email") >= 0) {
          return fail("This email address is already registered.");
        }
        if (String(error.message).indexOf("UNIQUE constraint failed: users.username") >= 0) {
          return fail("This username is already taken.");
        }
        if (error.message === "invite") return fail("This invite code is invalid, used or expired.");
        throw error;
      }

      clearSession(req, res);
      createSession(req, res, user);
      audit(user.id, "register", email);
      return redirect(res, "/portal");
    }
    return errorPage(res, 405, "Method not allowed.");
  }

  if (pathname === "/portal") {
    const session = requireCustomer(req, res);
    if (!session) return;
    const licenses = db
      .prepare(
        "SELECT l.*, (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.revoked_at IS NULL) AS used_devices " +
          "FROM licenses l WHERE l.user_id = ? ORDER BY l.id DESC"
      )
      .all(session.user.id)
      .map(function (license) {
        license.status = licenseStatus(license);
        return license;
      });
    return html(
      res,
      200,
      views.portalPage({
        user: session.user,
        csrf: session.csrf,
        licenses: licenses,
        flash: parsed.searchParams.get("ok") === "1" ? "Saved." : null,
      })
    );
  }

  if (pathname === "/portal/logout" && req.method === "POST") {
    const session = getSession(req);
    const body = await formBody(req);
    if (!verifyCsrf(req, body, session)) return errorPage(res, 403, "Invalid form token.");
    if (session) audit(session.user.id, "logout", session.user.username);
    clearSession(req, res);
    return redirect(res, "/login");
  }

  if (pathname === "/admin/setup") {
    if (req.method === "GET") {
      if (owner.password_hash) return errorPage(res, 403, "Owner setup is already complete.");
      if (!setupState || setupState.expires < Date.now()) {
        return errorPage(res, 403, "Setup link expired. Restart the server to get a new link.");
      }
      if (!safeEqual(parsed.searchParams.get("token"), setupState.token)) {
        return errorPage(res, 403, "Invalid setup token.");
      }
      return html(res, 200, views.setupPage(csrfCookie(req, res), setupState.token, null));
    }
    if (req.method === "POST") {
      if (owner.password_hash) return errorPage(res, 403, "Owner setup is already complete.");
      if (!setupState || setupState.expires < Date.now()) {
        return errorPage(res, 403, "Setup link expired. Restart the server to get a new link.");
      }
      const body = await formBody(req);
      if (!verifyCsrf(req, body, null)) return errorPage(res, 403, "Invalid form token.");
      if (!safeEqual(body.token, setupState.token)) return errorPage(res, 403, "Invalid setup token.");
      const password = String(body.password || "");
      if (password.length < 16 || password.length > 200) {
        return html(res, 400, views.setupPage(csrfCookie(req, res), setupState.token, "Use at least 16 characters."));
      }
      if (password !== String(body.password2 || "")) {
        return html(res, 400, views.setupPage(csrfCookie(req, res), setupState.token, "Passwords do not match."));
      }
      db.prepare("UPDATE users SET password_hash = ?, status = 'active' WHERE role = 'owner'").run(hashPassword(password));
      owner = db.prepare("SELECT * FROM users WHERE role = 'owner' LIMIT 1").get();
      const refreshed = owner;
      setupState = null;
      clearSession(req, res);
      createSession(req, res, refreshed);
      audit(refreshed.id, "owner_setup", refreshed.username);
      return redirect(res, "/admin");
    }
    return errorPage(res, 405, "Method not allowed.");
  }

  if (pathname === "/admin" && req.method === "GET") {
    const session = requireOwner(req, res);
    if (!session) return;
    const ok = parsed.searchParams.get("ok");
    const messages = {
      license_revoked: "License revoked.",
      invite_revoked: "Invite revoked.",
    };
    return renderAdmin(req, res, session, { flash: messages[ok] || null });
  }

  if (pathname === "/admin/invites" && req.method === "POST") {
    const session = requireOwner(req, res);
    if (!session) return;
    const body = await formBody(req);
    if (!verifyCsrf(req, body, session)) return errorPage(res, 403, "Invalid form token.");
    const note = String(body.note || "").trim().slice(0, 80);
    const days = Math.max(1, Math.min(365, Number(body.days || 7)));
    let code = null;
    for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
      const candidate = makeCode(config.invitePrefix, 3, 4);
      try {
        db.prepare(
          "INSERT INTO invites (code_hash, code_hint, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(hashCode(candidate), codeHint(candidate), note, session.user.id, nowIso(), addDays(days));
        code = candidate;
      } catch (error) {
        if (String(error.message).indexOf("UNIQUE") < 0) throw error;
      }
    }
    if (!code) return errorPage(res, 500, "Could not generate an invite. Try again.");
    audit(session.user.id, "invite_create", codeHint(code), { days: days });
    return renderAdmin(req, res, session, {
      generated: { type: "invite", code: code },
      flash: "Invite created. Copy it now.",
    });
  }

  if (pathname === "/admin/licenses" && req.method === "POST") {
    const session = requireOwner(req, res);
    if (!session) return;
    const body = await formBody(req);
    if (!verifyCsrf(req, body, session)) return errorPage(res, 403, "Invalid form token.");
    const plan = String(body.plan || "").trim().slice(0, 40);
    const email = String(body.email || "").trim().toLowerCase();
    const days = Math.max(0, Math.min(3650, Number(body.days || 30)));
    const maxDevices = Math.max(1, Math.min(10, Number(body.max_devices || 1)));
    const notes = String(body.notes || "").trim().slice(0, 120);
    if (!plan) return renderAdmin(req, res, session, { status: 400, error: "Plan is required." });

    let userId = null;
    if (email) {
      const customer = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'customer' LIMIT 1").get(email);
      if (!customer) {
        return renderAdmin(req, res, session, {
          status: 400,
          error: "No customer with that email. Create the account first or leave the field empty.",
        });
      }
      userId = customer.id;
    }

    let key = null;
    for (let attempt = 0; attempt < 5 && !key; attempt += 1) {
      const candidate = makeCode(config.licensePrefix, 4, 4);
      try {
        db.prepare(
          "INSERT INTO licenses (license_key, plan, user_id, max_devices, expires_at, notes, created_at, created_by, status) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')"
        ).run(
          candidate,
          plan,
          userId,
          maxDevices,
          days > 0 ? addDays(days) : null,
          notes,
          nowIso(),
          session.user.id
        );
        key = candidate;
      } catch (error) {
        if (String(error.message).indexOf("UNIQUE") < 0) throw error;
      }
    }
    if (!key) return renderAdmin(req, res, session, { error: "Could not generate a license. Try again." });
    audit(session.user.id, "license_create", key, { plan: plan, email: email || null, days: days });
    return renderAdmin(req, res, session, {
      generated: { type: "license", key: key, code: key },
      flash: "License created. Copy it now.",
    });
  }

  const licenseRevoke = pathname.match(/^\/admin\/licenses\/(\d+)\/revoke$/);
  if (licenseRevoke && req.method === "POST") {
    const session = requireOwner(req, res);
    if (!session) return;
    const body = await formBody(req);
    if (!verifyCsrf(req, body, session)) return errorPage(res, 403, "Invalid form token.");
    const id = Number(licenseRevoke[1]);
    db.prepare("UPDATE licenses SET status = 'revoked', revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(
      nowIso(),
      id
    );
    audit(session.user.id, "license_revoke", String(id));
    return redirect(res, "/admin?ok=license_revoked");
  }

  const inviteRevoke = pathname.match(/^\/admin\/invites\/(\d+)\/revoke$/);
  if (inviteRevoke && req.method === "POST") {
    const session = requireOwner(req, res);
    if (!session) return;
    const body = await formBody(req);
    if (!verifyCsrf(req, body, session)) return errorPage(res, 403, "Invalid form token.");
    const id = Number(inviteRevoke[1]);
    db.prepare("UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL").run(
      nowIso(),
      id
    );
    audit(session.user.id, "invite_revoke", String(id));
    return redirect(res, "/admin?ok=invite_revoked");
  }

  if (pathname === "/admin/logout" && req.method === "POST") {
    const session = getSession(req);
    const body = await formBody(req);
    if (!verifyCsrf(req, body, session)) return errorPage(res, 403, "Invalid form token.");
    if (session) audit(session.user.id, "logout", session.user.username);
    clearSession(req, res);
    return redirect(res, "/login");
  }

  if (pathname === "/health") {
    return json(res, 200, { ok: true, service: "nexus-licensing" });
  }

  return serveStatic(req, res, pathname);
}

/* ----------------------------------------------------------------------- api */

async function apiRoute(req, res, pathname, ip) {
  if (pathname === "/api/v1/health" && req.method === "GET") {
    return json(res, 200, { ok: true, service: "nexus-licensing" });
  }

  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

  let body;
  try {
    body = await jsonBody(req);
  } catch (error) {
    return json(res, 400, { ok: false, error: "invalid_json" });
  }

  if (pathname === "/api/v1/activate") {
    if (!rateLimit("activate", ip, 20, 60000)) return json(res, 429, { ok: false, error: "rate_limited" });
    const key = String(body.key || "").trim().toUpperCase();
    const hwid = String(body.hwid || "").trim();
    const label = String(body.label || "").trim().slice(0, 80);
    const version = String(body.version || "").trim().slice(0, 40);
    if (key.length < 8 || key.length > 80 || hwid.length < 8 || hwid.length > 200) {
      return json(res, 400, { ok: false, error: "invalid_request" });
    }
    const license = findLicenseByKey(key);
    if (!license || licenseStatus(license) !== "active") {
      audit(null, "activate_denied", key.slice(0, 10));
      return json(res, 403, { ok: false, error: "license_inactive" });
    }

    const hwidHash = sha256(hwid);
    const existing = db
      .prepare("SELECT * FROM activations WHERE license_id = ? AND hwid_hash = ?")
      .get(license.id, hwidHash);
    if (!existing) {
      const count = db
        .prepare("SELECT COUNT(*) AS c FROM activations WHERE license_id = ? AND revoked_at IS NULL")
        .get(license.id).c;
      if (Number(count) >= Number(license.max_devices)) {
        audit(null, "activate_device_limit", key.slice(0, 10));
        return json(res, 403, { ok: false, error: "device_limit" });
      }
    }

    const token = randomToken(32);
    const tokenHash = sha256(token);
    if (existing) {
      db.prepare(
        "UPDATE activations SET token_hash = ?, last_seen_at = ?, revoked_at = NULL, hwid_label = ? WHERE id = ?"
      ).run(tokenHash, nowIso(), label || existing.hwid_label, existing.id);
    } else {
      db.prepare(
        "INSERT INTO activations (license_id, hwid_hash, hwid_label, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(license.id, hwidHash, label, tokenHash, nowIso(), nowIso());
    }
    db.prepare("UPDATE licenses SET last_activated_at = ? WHERE id = ?").run(nowIso(), license.id);
    audit(null, "activate", String(license.id), { hwid: hwidHash.slice(0, 12), version: version });
    return json(res, 200, {
      ok: true,
      token: token,
      license: {
        plan: license.plan,
        expires_at: license.expires_at,
        max_devices: license.max_devices,
      },
    });
  }

  if (pathname === "/api/v1/validate") {
    if (!rateLimit("validate", ip, 60, 60000)) return json(res, 429, { ok: false, error: "rate_limited" });
    const token = String(body.token || "").trim();
    const hwid = String(body.hwid || "").trim();
    if (!token || !hwid) return json(res, 400, { ok: false, error: "invalid_request" });
    const hwidHash = sha256(hwid);
    const row = db
      .prepare(
        "SELECT a.*, l.plan, l.expires_at, l.status AS license_status, l.revoked_at AS license_revoked_at, l.max_devices " +
          "FROM activations a JOIN licenses l ON l.id = a.license_id WHERE a.token_hash = ? LIMIT 1"
      )
      .get(sha256(token));
    if (!row || row.revoked_at || row.hwid_hash !== hwidHash) {
      return json(res, 200, { ok: true, valid: false });
    }
    if (row.license_revoked_at || licenseStatus({ status: row.license_status, expires_at: row.expires_at, revoked_at: row.license_revoked_at }) !== "active") {
      return json(res, 200, { ok: true, valid: false });
    }
    db.prepare("UPDATE activations SET last_seen_at = ? WHERE id = ?").run(nowIso(), row.id);
    return json(res, 200, {
      ok: true,
      valid: true,
      license: { plan: row.plan, expires_at: row.expires_at, max_devices: row.max_devices },
    });
  }

  if (pathname === "/api/v1/deactivate") {
    const token = String(body.token || "").trim();
    if (!token) return json(res, 400, { ok: false, error: "invalid_request" });
    db.prepare("UPDATE activations SET revoked_at = ? WHERE token_hash = ?").run(nowIso(), sha256(token));
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { ok: false, error: "not_found" });
}

/* -------------------------------------------------------------------- static */

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".exe": "application/octet-stream",
};

const rootFiles = new Set([
  "/index.html",
  "/impressum.html",
  "/datenschutz.html",
  "/404.html",
  "/site.webmanifest",
  "/preview.jpg",
]);

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return errorPage(res, 405, "Method not allowed.");
  }

  let relative = pathname;
  if (relative === "/" || relative === "") relative = "/index.html";
  if (relative === "/favicon.ico") relative = "/assets/favicon.ico";

  const allowed =
    rootFiles.has(relative) ||
    relative.startsWith("/assets/") ||
    relative.startsWith("/downloads/");
  if (!allowed || relative.indexOf("\0") >= 0) return notFound(res);

  const filePath = path.resolve(config.root, "." + relative);
  if (filePath !== config.root && !filePath.startsWith(config.root + path.sep)) {
    return notFound(res);
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return notFound(res);
  }
  if (!stat.isFile()) return notFound(res);

  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Cache-Control", ext === ".html" ? "no-store" : "public, max-age=3600");
  if (ext === ".exe") {
    res.setHeader("Content-Disposition", 'attachment; filename="' + path.basename(filePath) + '"');
  }
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(filePath);
  stream.on("error", function () {
    res.destroy();
  });
  stream.pipe(res);
}

function notFound(res) {
  const filePath = path.join(config.root, "404.html");
  try {
    const body = fs.readFileSync(filePath);
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch (error) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
  }
}

/* --------------------------------------------------------------------- start */

const server = http.createServer(function (req, res) {
  Promise.resolve(handle(req, res)).catch(function (error) {
    console.error("[error]", error);
    if (!res.headersSent) {
      setSecurityHeaders(res);
      errorPage(res, 500, "Internal server error.");
    } else {
      res.destroy();
    }
  });
});

server.listen(config.port, config.host, function () {
  console.log("Nexus Optimizer portal listening on " + config.baseUrl);
  console.log("Owner admin: " + config.baseUrl + "/admin");
  console.log("Customer portal: " + config.baseUrl + "/portal");
  if (setupState) {
    console.log("Owner setup link (one-time): " + config.baseUrl + "/admin/setup?token=" + setupState.token);
    console.log("This link expires in " + config.setupMinutes + " minutes.");
  }
});

function shutdown() {
  try {
    server.close();
    db.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
