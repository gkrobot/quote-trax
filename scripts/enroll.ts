// One-time setup: creates the password hash, TOTP secret and session key, then
// stores them as Worker secrets. Running it again generates NEW values and
// locks out any authenticator app enrolled with the old secret.
//
// Usage (keeps the password out of shell history):
//   read -s QT_PASSWORD && export QT_PASSWORD
//   npm run enroll
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { hashPassword } from "../src/crypto";
import { base32Encode, totpUri } from "../src/totp";

const password = process.env.QT_PASSWORD;
if (!password || password.length < 12) {
  console.error("Set QT_PASSWORD (12+ characters) before running this script.");
  process.exit(1);
}

const totpSecret = base32Encode(new Uint8Array(randomBytes(20)));
const sessionSecret = randomBytes(32).toString("hex");
const passwordHash = await hashPassword(password);

function putSecret(name: string, value: string): void {
  const result = spawnSync("npx", ["wrangler", "secret", "put", name], {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`wrangler secret put ${name} failed`);
}

putSecret("APP_PASSWORD_HASH", passwordHash);
putSecret("TOTP_SECRET", totpSecret);
putSecret("SESSION_SECRET", sessionSecret);

console.log("\nSecrets saved to the Worker.\n");
console.log("Add this account to your authenticator app.");
console.log("Either scan a QR code generated from this URI with a local tool, or enter the key manually:\n");
console.log(`  Key: ${totpSecret}`);
console.log(`  URI: ${totpUri(totpSecret, "owner", "quote-trax")}\n`);
console.log("Store the key in your password manager too, since it can't be recovered from the Worker.");
