<p align="center">
  <img src="public/brand/quote-trax-wordmark-modern.svg" alt="quote-trax" width="260">
</p>

<p align="center">
  A private, personal library for book quotes. Runs on Cloudflare Workers with a D1 database.
  Sign in with a username, a password, and a code from your authenticator app.
</p>

---

## Features

- **Library:** every quote, grouped by series and book. Search, sort (series order, newest, oldest, author, or title), and filter by series or book.
- **Add:** quotes, books, and series. A book can have an optional number in its series, including halves like 2.5.
- **Manage:** rename or edit series and books, change their numbers, or delete them. A book can only be deleted once its quotes are gone.
- **Stats:** totals, quotes by series, and quotes by book.
- **Import / Export:** paste or upload a JSON export, or copy and download your library. Imports update existing items by ID, so re-importing is safe.
- **Two looks:** Modern (the default) and Comfy. The Look button beside Sign out switches between them, and your choice is remembered in each browser.

## Setup (no terminal needed)

1. **Create the database.** In the Cloudflare dashboard, go to Storage & Databases → D1 → Create, and name it `quote-trax`. Put its ID in `database_id` in `wrangler.toml`.

2. **Create the tables.** Open the database's Console and run `migrations/0001_init.sql`, `migrations/0002_totp_state.sql`, and `migrations/0003_account.sql`, in that order.

3. **Set the Worker variables.** In the Worker, go to Settings → Variables and Secrets:
   - `APP_USERNAME`: plain text. The only username allowed to set up the account.
   - `SETUP_TOKEN`: **Secret**. A long random string you keep somewhere safe. You type it once on the setup page.

4. **Deploy.** Save and deploy the Worker. Cloudflare builds from the `main` branch.

5. **Set up the account.** Open the Worker's URL in Safari. Enter the username, a password of at least 12 characters, and the setup token. The page shows an authenticator key. Add it to Passwords or your authenticator app with "Enter setup key," then enter the 6-digit code to confirm. Setup can only run once.

6. **Sign in.** Enter the username, the password, and the current code.

7. **Load your quotes.** Open the **Import / Export** tab and paste your JSON export, or choose the file.

Optional cleanup: the Worker secrets `APP_PASSWORD_HASH`, `TOTP_SECRET`, and `SESSION_SECRET` from earlier setups are no longer used. Delete them in the dashboard.

## Local development

Create `.dev.vars` (gitignored) with `APP_USERNAME` and `SETUP_TOKEN`. Then run:

```sh
npm install
npm run db:migrate:local
npm run dev
```

Open the local URL to complete setup against the local database.

## Project layout

| Path | What it holds |
| --- | --- |
| `src/index.ts` | Routes, sign-in, sessions, and security headers |
| `src/manage.ts` | Create, edit, delete, and stats logic |
| `src/import.ts`, `src/export.ts` | JSON import and export |
| `src/quote-clean.ts` | Import cleanup rules (headings, wrapped lines, attributions) |
| `src/crypto.ts`, `src/totp.ts` | Password hashing and authenticator codes |
| `public/` | The single-page app: HTML, CSS, and vanilla JavaScript |
| `public/themes/` | The Modern look |
| `public/brand/` | Logos and icons |
| `migrations/` | D1 schema, applied in order |

## Notes and security

- Quote text is displayed as plain text, never as HTML.
- After setup, the setup endpoints stay closed. To start over, clear the `account` table in the D1 Console.
- The password hash, authenticator key, and session key are stored in D1. Anyone with D1 Console access can read them, so keep your Cloudflare account protected with two-factor authentication.
- Sessions are signed cookies that expire after 12 hours. Logout clears the cookie in this browser only, so copies of the cookie stay valid until they expire.
- Sign-in allows three wrong codes per attempt, but a correct password resets that count. The password step is not rate limited yet.
- `wrangler.toml` has a `[[previews.d1_databases]]` block that points branch previews at the production database. Remove it unless you want previews to change your real data.
