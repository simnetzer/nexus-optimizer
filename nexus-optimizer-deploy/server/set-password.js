"use strict";

/*
 * Set or reset the owner password without putting it in code, .env or logs.
 * Usage: node server/set-password.js
 * Only a scrypt hash is written to SQLite.
 */

const { config, db, hashPassword, seedOwner } = require("./lib");

function promptHidden(question) {
  return new Promise(function (resolve, reject) {
    if (!process.stdin.isTTY) {
      reject(new Error("This command needs an interactive terminal."));
      return;
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    let value = "";

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
    }

    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          cleanup();
          process.exit(1);
        } else if (ch === "\r" || ch === "\n") {
          cleanup();
          resolve(value);
          return;
        } else if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
        } else if (ch >= " ") {
          value += ch;
        }
      }
    }

    stdin.on("data", onData);
  });
}

(async function main() {
  seedOwner();
  const owner = db.prepare("SELECT * FROM users WHERE role = 'owner' LIMIT 1").get();
  if (!owner) throw new Error("Owner row missing. Start the server once first.");

  console.log("Owner username: " + config.ownerUsername);
  const first = await promptHidden("New owner password (min 16 chars): ");
  if (first.length < 16) throw new Error("Password must be at least 16 characters.");
  const second = await promptHidden("Repeat password: ");
  if (first !== second) throw new Error("Passwords do not match.");

  db.prepare("UPDATE users SET password_hash = ?, status = 'active' WHERE id = ?").run(
    hashPassword(first),
    owner.id
  );
  console.log("Owner password updated. Only the scrypt hash was stored.");
  db.close();
})().catch(function (error) {
  console.error("Error: " + error.message);
  process.exit(1);
});
