# quote-trax

A private book-quotes site on Cloudflare Workers. Data lives in D1. Access requires a password plus a code from an authenticator app (TOTP).

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create the D1 database and paste the printed ID into `database_id` in `wrangler.toml`:

   ```sh
   npx wrangler d1 create quote-trax
   ```

3. Apply the migrations:

   ```sh
   npm run db:migrate:remote
   ```

4. Set the login username. In the Worker, go to Settings → Variables and Secrets and add `APP_USERNAME` as a plain (not secret) variable. Login requires this username, then the password, then the authenticator code. The username is compared case-insensitively.

5. Enroll the account. This generates the password hash, TOTP secret, and session key, and stores them as Worker secrets:

   ```sh
   read -s QT_PASSWORD && export QT_PASSWORD
   npm run enroll
   ```

   Add the printed key to your authenticator app (Google Authenticator, Authy, 1Password, and so on) before you log in.

6. Load your quotes. Export the Artifact data to `data/export.json` (the `data/` folder is gitignored), then:

   ```sh
   npm run import -- data/export.json > data/import.sql
   npx wrangler d1 execute quote-trax --remote --file=data/import.sql
   ```

   Read the stderr report first. It lists extracted attributions and quotes with single line breaks.

7. Deploy:

   ```sh
   npm run deploy
   ```

## Local development

Create `.dev.vars` (gitignored) with `APP_USERNAME`, `APP_PASSWORD_HASH`, `TOTP_SECRET`, and `SESSION_SECRET` in `KEY=value` format, then run `npm run db:migrate:local` and `npm run dev`.

## Notes

- Re-running `npm run enroll` creates new secrets. Any authenticator entry for the old secret stops working.
- Sessions are signed cookies that expire after 12 hours. There is no server-side session list yet, so logout clears the cookie in this browser only.
- Recovery codes and login rate limiting are not implemented yet.
