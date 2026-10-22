# EventDesk

Event page + organizer dashboard with Razorpay payments, manual approval, email cadence and calendar reminders.
Node 18+, Express, SQLite (`data/app.db`), no build step.

## Run it

```bash
npm install
cp .env.example .env      # set ADMIN_PASSWORD at minimum
npm start
```

- Public page: http://localhost:3000
- Organizer dashboard: http://localhost:3000/#admin

Without Razorpay keys, payments run in **demo mode** (no charge). Without SMTP settings, emails print to the console. You can test the full flow locally.

## How it works

1. **Register and pay.** The visitor fills the form. The server creates a Razorpay order, Checkout opens, and `/api/verify` checks the HMAC signature. The registration becomes `pending_review` and a "payment received, under review" email is sent.
2. **Review.** In the dashboard, click **Accept** or **Decline**.
   - **Accept:** a confirmation email goes out (map, Google Calendar link, `.ics` with 1-day and 1-hour alarms). Reminder emails are scheduled for 7 days, 1 day and 1 hour before, plus a thank-you the day after.
   - **Decline:** the payment is refunded through Razorpay and a **humorous declined receipt** is emailed. Edit the jokes in `templates.js`.
3. **Attendee list.** In the dashboard, choose what the public page shows for accepted attendees: full names, masked names (`P•••• S•••`), count only, or nothing. Only accepted registrants are ever shown.

## Customize

- Banner, description, price, capacity, speakers (photo, role, talk, LinkedIn URL): all in the dashboard.
- Email copy, cadence timing and decline jokes: `templates.js`.
- Event times are interpreted as IST (+05:30).

## Go live

1. Create live keys in the Razorpay dashboard and set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
2. Set `BASE_URL` to your public HTTPS URL and a strong `ADMIN_PASSWORD`.
3. Configure SMTP and verify your sending domain (SPF/DKIM) so emails don't land in spam.
4. Deploy on any host with a persistent disk (Render, Railway, Fly.io, a VPS). Keep `data/` on that disk: it holds the database and uploaded images. Put the app behind HTTPS.

## Not included yet

- Multiple events (the schema is single-event).
- Razorpay webhooks as a fallback if a visitor closes the tab right after paying.
- Rate limiting, per-user admin accounts, QR check-in.
