// Runs a command with the database chosen explicitly, so routine work never
// reaches a real hosted database by accident.
//   node scripts/with-db.mjs local -- <command>   the Docker database on port 5433
//   node scripts/with-db.mjs none  -- <command>   no database (browser-only storage)
//   node scripts/with-db.mjs neon  -- <command>   whatever .env says, with remote access allowed
import { spawn } from "node:child_process";

const LOCAL_DATABASE_URL = "postgres://holographic:holographic@localhost:5433/holographic";

const [mode, separator, ...command] = process.argv.slice(2);
if (!["local", "none", "neon"].includes(mode ?? "") || separator !== "--" || command.length === 0) {
  console.error("Usage: node scripts/with-db.mjs local|none|neon -- <command...>");
  process.exit(2);
}

const env = { ...process.env };
if (mode === "local") {
  env.DATABASE_URL = LOCAL_DATABASE_URL;
  env.DATABASE_URL_UNPOOLED = "";
} else if (mode === "none") {
  env.DATABASE_URL = "";
  env.DATABASE_URL_UNPOOLED = "";
} else {
  env.HOLOGRAPHIC_ALLOW_REMOTE_DB = "1";
}

const child = spawn(command[0], command.slice(1), { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
