"use strict";

const { config } = require("./lib");

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function badge(status) {
  const safe = esc(status);
  return '<span class="badge badge-' + safe + '">' + safe + "</span>";
}

function layout(title, body, options) {
  const opts = options || {};
  const user = opts.user || null;
  const csrf = opts.csrf || "";
  const admin = opts.admin || false;

  let actions = '<a class="portal-toplink" href="/">Home</a>';
  if (user) {
    actions +=
      (user.role === "owner"
        ? '<a class="portal-toplink" href="/admin">Admin</a>'
        : '<a class="portal-toplink" href="/portal">Portal</a>') +
      '<form method="post" action="' + (admin ? "/admin/logout" : "/portal/logout") + '" class="inline-form">' +
      '<input type="hidden" name="_csrf" value="' + esc(csrf) + '">' +
      '<button type="submit" class="portal-toplink portal-logout">Log out</button>' +
      "</form>";
  } else {
    actions +=
      '<a class="portal-toplink" href="/login">Log in</a>' +
      '<a class="btn btn-primary btn-sm" href="/portal/register">Register</a>';
  }

  return (
    "<!DOCTYPE html><html lang=\"en\"><head>" +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + esc(title) + " — Nexus Optimizer</title>" +
    '<meta name="robots" content="noindex, nofollow">' +
    '<meta name="theme-color" content="#080b10">' +
    '<link rel="icon" href="/assets/favicon.ico" type="image/x-icon">' +
    '<link rel="stylesheet" href="/assets/css/style.css">' +
    '<link rel="stylesheet" href="/assets/css/portal.css">' +
    "</head><body class=\"portal-body\">" +
    '<a class="skip-link" href="#main">Skip to content</a>' +
    '<header class="site-header is-scrolled"><div class="container header-inner is-simple">' +
    '<a class="brand" href="/" aria-label="Nexus Optimizer — home">' +
    '<img class="brand-mark-img" src="/assets/nexus-icon.png" alt="" width="28" height="28">' +
    '<span class="brand-text"><span class="brand-name">NEXUS</span><span class="brand-sub">OPTIMIZER</span></span>' +
    "</a>" +
    '<div class="header-actions portal-actions">' + actions + "</div>" +
    "</div></header>" +
    '<main id="main" class="portal-main"><div class="container">' + body + "</div></main>" +
    '<footer class="legal-footer"><div class="container">' +
    "<p>© " + new Date().getFullYear() + " Nexus Optimizer</p>" +
    '<nav aria-label="Legal"><a href="/">Home</a><a href="/impressum.html">Imprint</a><a href="/datenschutz.html">Privacy</a></nav>' +
    '<p class="watermark">made by <a href="https://guns.lol/synx123" target="_blank" rel="noopener noreferrer"><b>synx121</b></a></p>' +
    "</div></footer></body></html>"
  );
}

function authPage(options) {
  const opts = options || {};
  const error = opts.error
    ? '<div class="notice notice-error">' + esc(opts.error) + "</div>"
    : "";
  const body =
    '<div class="auth-shell"><div class="auth-card">' +
    '<p class="eyebrow"><span></span>' + esc(opts.eyebrow || "Customer portal") + "</p>" +
    "<h1>" + esc(opts.heading) + "</h1>" +
    '<p class="auth-intro">' + esc(opts.intro || "") + "</p>" +
    error +
    opts.form +
    (opts.footer ? '<p class="auth-foot">' + opts.footer + "</p>" : "") +
    "</div></div>";
  return layout(opts.title, body, { csrf: opts.csrf, user: null });
}

function loginPage(csrf, error) {
  const form =
    '<form method="post" action="/login" class="form">' +
    '<input type="hidden" name="_csrf" value="' + esc(csrf) + '">' +
    '<label class="form-row"><span>Email or owner username</span>' +
    '<input type="text" name="identity" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>' +
    '<label class="form-row"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>' +
    '<button class="btn btn-primary btn-block" type="submit">Log in</button>' +
    "</form>";

  return authPage({
    title: "Login",
    eyebrow: "Account login",
    heading: "Log in.",
    intro: "Customers use their email. The owner uses the owner username. No account yet? An invite code is required.",
    form: form,
    csrf: csrf,
    error: error,
    footer: 'New customer? <a href="/portal/register">Register with an invite code</a>',
  });
}

function registerPage(csrf, invite, error) {
  const form =
    '<form method="post" action="/portal/register" class="form">' +
    '<input type="hidden" name="_csrf" value="' + esc(csrf) + '">' +
    '<label class="form-row"><span>Invite code</span><input type="text" name="invite" value="' + esc(invite || "") + '" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="INV-XXXX-XXXX-XXXX"></label>' +
    '<label class="form-row"><span>Username</span><input type="text" name="username" required minlength="3" maxlength="32" autocomplete="username" pattern="[A-Za-z0-9_.\\-]{3,32}"></label>' +
    '<label class="form-row"><span>Email</span><input type="email" name="email" required autocomplete="email"></label>' +
    '<label class="form-row"><span>Password</span><input type="password" name="password" required minlength="10" autocomplete="new-password"><small>At least 10 characters.</small></label>' +
    '<label class="form-row"><span>Repeat password</span><input type="password" name="password2" required minlength="10" autocomplete="new-password"></label>' +
    '<button class="btn btn-primary btn-block" type="submit">Create account</button>' +
    "</form>";

  return authPage({
    title: "Register",
    eyebrow: "Invite only",
    heading: "Create your account.",
    intro: "Registration is invite-only. You need a valid invite code from the owner.",
    form: form,
    csrf: csrf,
    error: error,
    footer: 'Already registered? <a href="/login">Log in</a>',
  });
}

function setupPage(csrf, token, error) {
  const form =
    '<form method="post" action="/admin/setup" class="form">' +
    '<input type="hidden" name="_csrf" value="' + esc(csrf) + '">' +
    '<input type="hidden" name="token" value="' + esc(token) + '">' +
    '<label class="form-row"><span>New owner password</span><input type="password" name="password" required minlength="16" autocomplete="new-password"><small>At least 16 characters. Only the scrypt hash is stored.</small></label>' +
    '<label class="form-row"><span>Repeat password</span><input type="password" name="password2" required minlength="16" autocomplete="new-password"></label>' +
    '<button class="btn btn-primary btn-block" type="submit">Set password</button>' +
    "</form>";

  return authPage({
    title: "Owner setup",
    eyebrow: "First run",
    heading: "Set the owner password.",
    intro: "This one-time link is only valid for a short time. The password is never written to code, logs or the database in plain text.",
    form: form,
    csrf: csrf,
    error: error,
  });
}

function licenseCard(license) {
  const status = license.status;
  const key = license.license_key;
  return (
    '<article class="license-card">' +
    '<div class="license-head"><span class="license-plan">' + esc(license.plan) + "</span>" + badge(status) + "</div>" +
    '<p class="license-label">License key</p>' +
    '<code class="license-key">' + esc(key) + "</code>" +
    '<div class="license-meta">' +
    "<span>Expires: <b>" + fmtDate(license.expires_at) + "</b></span>" +
    "<span>Devices: <b>" + Number(license.used_devices || 0) + " / " + Number(license.max_devices) + "</b></span>" +
    "</div>" +
    '<div class="license-actions">' +
    '<a class="btn btn-primary btn-sm" href="/downloads/NexusOptimizer-Setup.exe" download>Download installer</a>' +
    '<a class="btn btn-ghost btn-sm" href="/downloads/NexusOptimizer.exe" download>Portable EXE</a>' +
    "</div></article>"
  );
}

function portalPage(options) {
  const user = options.user;
  const licenses = options.licenses || [];
  const csrf = options.csrf;
  const flash = options.flash
    ? '<div class="notice notice-success">' + esc(options.flash) + "</div>"
    : "";

  const cards = licenses.length
    ? '<div class="license-grid">' + licenses.map(licenseCard).join("") + "</div>"
    : '<div class="empty-state"><h2>No license yet.</h2><p>Your account is active, but no license has been assigned to it. Ask the owner for a license.</p></div>';

  const body =
    '<div class="portal-head"><div><p class="eyebrow"><span></span>Customer portal</p>' +
    "<h1>Welcome, " + esc(user.username) + ".</h1>" +
    '<p class="section-sub">Your licenses and downloads. Keep your key private — it is your access to the optimizer.</p></div>' +
    '<div class="portal-account"><span>' + esc(user.email || "") + "</span><small>Member since " + fmtDate(user.created_at) + "</small></div></div>" +
    flash +
    cards +
    '<div class="portal-help"><h2>How activation works</h2><p>Open Nexus Optimizer, enter your license key and connect it to this PC. If you replace the PC, ask the owner to reset the activation.</p></div>';

  return layout("Customer portal", body, { csrf: csrf, user: user });
}

function statCard(label, value) {
  return '<div class="admin-stat"><span class="admin-stat-value">' + esc(value) + "</span><span class=\"admin-stat-label\">" + esc(label) + "</span></div>";
}

function inviteRows(invites, csrf) {
  if (!invites.length) return '<tr><td colspan="6" class="table-empty">No invites yet.</td></tr>';
  return invites
    .map(function (invite) {
      const canRevoke = invite.status === "active";
      return (
        "<tr><td><code>" + esc(invite.code_hint) + "</code></td>" +
        "<td>" + esc(invite.note || "—") + "</td>" +
        "<td>" + badge(invite.status) + "</td>" +
        "<td>" + fmtDate(invite.expires_at) + "</td>" +
        "<td>" + esc(invite.used_by_username || "—") + "</td>" +
        '<td class="table-action">' +
        (canRevoke
          ? '<form method="post" action="/admin/invites/' + invite.id + '/revoke" class="inline-form"><input type="hidden" name="_csrf" value="' + esc(csrf) + '"><button class="btn btn-ghost btn-xs" type="submit">Revoke</button></form>'
          : "—") +
        "</td></tr>"
      );
    })
    .join("");
}

function licenseRows(licenses, csrf) {
  if (!licenses.length) return '<tr><td colspan="8" class="table-empty">No licenses yet.</td></tr>';
  return licenses
    .map(function (license) {
      const canRevoke = license.status === "active" || license.status === "expired";
      return (
        "<tr><td><code class=\"table-key\">" + esc(license.license_key) + "</code></td>" +
        "<td>" + esc(license.plan) + "</td>" +
        "<td>" + esc(license.email || "—") + "</td>" +
        "<td>" + badge(license.status) + "</td>" +
        "<td>" + fmtDate(license.expires_at) + "</td>" +
        "<td>" + Number(license.used_devices || 0) + " / " + Number(license.max_devices) + "</td>" +
        "<td>" + Number(license.activation_count || 0) + "</td>" +
        '<td class="table-action">' +
        (canRevoke
          ? '<form method="post" action="/admin/licenses/' + license.id + '/revoke" class="inline-form"><input type="hidden" name="_csrf" value="' + esc(csrf) + '"><button class="btn btn-ghost btn-xs" type="submit">Revoke</button></form>'
          : "—") +
        "</td></tr>"
      );
    })
    .join("");
}

function userRows(users) {
  if (!users.length) return '<tr><td colspan="5" class="table-empty">No customers yet.</td></tr>';
  return users
    .map(function (user) {
      return (
        "<tr><td>" + esc(user.username) + "</td>" +
        "<td>" + esc(user.email || "—") + "</td>" +
        "<td>" + Number(user.license_count || 0) + "</td>" +
        "<td>" + fmtDate(user.created_at) + "</td>" +
        "<td>" + badge(user.status) + "</td></tr>"
      );
    })
    .join("");
}

function adminPage(options) {
  const user = options.user;
  const csrf = options.csrf;
  const data = options.data;
  const flash = options.error
    ? '<div class="notice notice-error">' + esc(options.error) + "</div>"
    : options.flash
      ? '<div class="notice notice-success">' + esc(options.flash) + "</div>"
      : "";
  const generated = options.generated
    ? '<div class="code-reveal"><p><strong>' + (options.generated.type === "invite" ? "New invite code" : "New license key") + "</strong> — copy it now, it is not shown again.</p><code>" +
      esc(options.generated.code) + "</code></div>"
    : "";

  const body =
    '<div class="portal-head"><div><p class="eyebrow"><span></span>Owner only</p>' +
    "<h1>Admin.</h1><p class=\"section-sub\">Invites, licenses and customers. The owner account is never shown in these lists.</p></div>" +
    '<div class="portal-account"><span>' + esc(user.username) + '</span><small>Owner</small></div></div>' +
    flash + generated +
    '<div class="admin-stats">' +
    statCard("Customers", data.stats.customers) +
    statCard("Active licenses", data.stats.activeLicenses) +
    statCard("Activations", data.stats.activations) +
    statCard("Unused invites", data.stats.unusedInvites) +
    "</div>" +
    '<div class="admin-columns">' +
    '<section class="admin-card"><h2>Create invite</h2><p>One-time registration code. Send it manually via Discord.</p>' +
    '<form method="post" action="/admin/invites" class="form">' +
    '<input type="hidden" name="_csrf" value="' + esc(csrf) + '">' +
    '<label class="form-row"><span>Note (optional)</span><input type="text" name="note" maxlength="80" placeholder="e.g. for a friend"></label>' +
    '<label class="form-row"><span>Valid for days</span><input type="number" name="days" value="7" min="1" max="365" required></label>' +
    '<button class="btn btn-primary btn-block" type="submit">Generate invite</button></form></section>' +
    '<section class="admin-card"><h2>Create license</h2><p>Keys are generated server-side. Assign to a registered customer by email.</p>' +
    '<form method="post" action="/admin/licenses" class="form">' +
    '<input type="hidden" name="_csrf" value="' + esc(csrf) + '">' +
    '<label class="form-row"><span>Plan</span><input type="text" name="plan" required maxlength="40" placeholder="e.g. Pro"></label>' +
    '<label class="form-row"><span>Customer email (optional)</span><input type="email" name="email" autocomplete="off" placeholder="customer@example.com"></label>' +
    '<div class="form-split"><label class="form-row"><span>Valid for days</span><input type="number" name="days" value="30" min="0" max="3650" required><small>0 = never expires</small></label>' +
    '<label class="form-row"><span>Max devices</span><input type="number" name="max_devices" value="1" min="1" max="10" required></label></div>' +
    '<label class="form-row"><span>Note (optional)</span><input type="text" name="notes" maxlength="120"></label>' +
    '<button class="btn btn-primary btn-block" type="submit">Generate license</button></form></section>' +
    "</div>" +
    '<section class="admin-card"><h2>Invites</h2><div class="table-wrap"><table><thead><tr><th>Code</th><th>Note</th><th>Status</th><th>Expires</th><th>Used by</th><th></th></tr></thead><tbody>' +
    inviteRows(data.invites, csrf) + "</tbody></table></div></section>" +
    '<section class="admin-card"><h2>Licenses</h2><div class="table-wrap"><table><thead><tr><th>Key</th><th>Plan</th><th>Customer</th><th>Status</th><th>Expires</th><th>Devices</th><th>Activations</th><th></th></tr></thead><tbody>' +
    licenseRows(data.licenses, csrf) + "</tbody></table></div></section>" +
    '<section class="admin-card"><h2>Customers</h2><div class="table-wrap"><table><thead><tr><th>Username</th><th>Email</th><th>Licenses</th><th>Created</th><th>Status</th></tr></thead><tbody>' +
    userRows(data.users) + "</tbody></table></div></section>" +
    '<section class="admin-card"><h2>Recent activity</h2><ul class="audit-list">' +
    (data.audit.length
      ? data.audit.map(function (entry) {
          return "<li><span>" + esc(entry.action) + "</span><em>" + esc(entry.target || "") + "</em><time>" + fmtDate(entry.created_at) + "</time></li>";
        }).join("")
      : '<li class="table-empty">No activity yet.</li>') +
    "</ul></section>";

  return layout("Admin", body, { csrf: csrf, user: user, admin: true });
}

function errorPage(status, message) {
  const body =
    '<div class="error-panel"><p class="eyebrow"><span></span>Error ' + Number(status) + "</p>" +
    "<h1>" + esc(message) + "</h1>" +
    '<p class="section-sub">Go back to the <a href="/">home page</a> or the <a href="/portal">customer portal</a>.</p></div>';
  return layout("Error " + status, body, { csrf: "", user: null });
}

module.exports = {
  esc,
  layout,
  loginPage,
  registerPage,
  setupPage,
  portalPage,
  adminPage,
  errorPage,
  badge,
  fmtDate,
};
