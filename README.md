# quote-trax

A private book-quotes site on Cloudflare Workers. Data lives in D1. Access requires a username, a password, and a code from an authenticator app (TOTP).

## Setup (no terminal needed)

1. **Create the database.** Storage & Databases → D1 → Create, named `quote-trax`. Put its ID in `database_id` in `wrangler.toml`.

2. **Create the tables.** Open the database's Console and run `migrations/0001_init.sql`, `migrations/0002_totp_state.sql`, and `migrations/0003_account.sql`, in that order.

3. **Load your quotes.** Run the import SQL in the Console (generated from your export with `npm run import`, or prepared by hand).

4. **Set the Worker variables.** In the Worker, go to Settings → Variables and Secrets:
   - `APP_USERNAME`: plain text, the only username allowed to set up the account.
   - `SETUP_TOKEN`: **Secret**, a long random string you save somewhere safe. You type it once on the setup page.

5. **Deploy.** Save and deploy the Worker. Cloudflare builds from the `main` branch.

6. **Set up the account.** Open the Worker's URL in Safari. Enter the username, a password of at least 12 characters, and the setup token. The page shows an authenticator key. Add it to Passwords or your authenticator app with "Enter setup key", then enter the 6-digit code to confirm. Setup can only run once.

7. **Sign in.** Enter the username, the password, and the current code.

Optional cleanup: the Worker secrets `APP_PASSWORD_HASH`, `TOTP_SECRET`, and `SESSION_SECRET` from earlier setups are no longer used. Delete them in the dashboard.

## Local development

Create `.dev.vars` (gitignored) with `APP_USERNAME` and `SETUP_TOKEN`, then run `npm run db:migrate:local` and `npm run dev`. Open the local URL to complete setup against the local database.

## Notes

- After setup, the setup endpoints return 404 permanently. To start over, you'd have to clear the `account` table in the Console.
- The account's password hash, authenticator key, and session key are stored in D1. Anyone with D1 Console access can read them.
- Sessions are signed cookies that expire after 12 hours. Logout clears the cookie in this browser only.
- Sign-in is limited to three wrong codes per attempt. The username and password step is not rate limited yet.
