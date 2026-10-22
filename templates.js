// Edit freely. Merge fields: {{name}} {{event}} {{date}} {{time}} {{venue}} {{map}} {{cal}} {{ics}}
// {{price}} {{speakers}} {{receipt}} {{paymentId}} {{page}} and, for declines, {{joke}} {{refundNote}}
const merge = (t, c) => t.replace(/\{\{(\w+)\}\}/g, (a, k) => (c[k] ?? a));

// [email kind, minutes BEFORE event start]. Negative = after the event starts.
const cadence = [['reminder7d', 7 * 1440], ['reminder1d', 1440], ['reminder1h', 60], ['thanks', -1440]];

const sign = '\n\nThe EventDesk Team';
const emails = {
  received: {
    subject: 'Payment received – your seat is under review',
    body: `Hi {{name}},\n\nWe've received your payment of {{price}} for {{event}} (payment {{paymentId}}).\n\nSeats are curated, so our team will review your registration and email you a decision shortly. If we can't offer you a seat, your payment is refunded automatically.${sign}`
  },
  accepted: {
    subject: "You're in! {{event}} – {{date}}",
    body: `Hi {{name}},\n\nGood news: your registration is accepted.\n\nWhen: {{date}}, {{time}}\nWhere: {{venue}}\nMap: {{map}}\n\nAdd to calendar (Google): {{cal}}\nAdd to calendar (.ics, with reminders): {{ics}}\n\nSpeakers:\n{{speakers}}${sign}`
  },
  reminder7d: {
    subject: 'One week to go – {{event}}',
    body: `Hi {{name}},\n\nOnly a week left! Line-up:\n{{speakers}}\n\nVenue: {{venue}}\nDirections: {{map}}${sign}`
  },
  reminder1d: {
    subject: 'Tomorrow: {{event}} – logistics inside',
    body: `Hi {{name}},\n\nTomorrow's the day. Starts {{time}}.\n\nVenue: {{venue}}\nDirections: {{map}}\nBring a photo ID.${sign}`
  },
  reminder1h: {
    subject: 'Starting in an hour – {{event}}',
    body: `Hi {{name}},\n\nWe start in one hour at {{venue}}.\nDirections: {{map}}${sign}`
  },
  thanks: {
    subject: 'Thanks for joining {{event}}',
    body: `Hi {{name}},\n\nThank you for being part of {{event}}. Slides and recordings will follow soon.${sign}`
  },
  declined: {
    subject: 'Your declined receipt – {{event}} (#{{receipt}})',
    body: `DECLINED RECEIPT #{{receipt}}\n------------------------------\nItem:      1 x seat at {{event}}\nStatus:    Politely, firmly, regretfully NOT ACCEPTED\nRefund:    {{price}}. {{refundNote}}\nDrama:     0 (we checked)\n------------------------------\n\nHi {{name}},\n\n{{joke}}\n\nThank you for your interest. We hope to see you at the next one.${sign}`
  }
};

const jokes = [
  "We reviewed your registration with the care of a sommelier tasting gas-station coffee. Verdict: the guest list is exactly the right size, and you would make it one too many. It's not you. It's the fire marshal.",
  "Our selection committee deliberated for hours, mostly about snacks. Sadly, the seats were filled before we got to your application. Your money is coming back faster than a Bengaluru auto driver quotes a fare.",
  "Like a Mumbai local at 9 a.m., this event is physically full. Not even one more person can be squeezed in. Your refund, however, has a guaranteed seat and is already on its way.",
  "Think of this as a plot twist rather than a rejection. In the sequel, you are the hero, the venue is bigger, and the biryani is unlimited."
];

module.exports = { merge, cadence, emails, jokes };
