import { createFileRoute } from "@tanstack/react-router";

import { LegalContact, LegalPage } from "../components/legal";
import { pageHead } from "../lib/site-head";

const PrivacyPage = () => (
  <LegalPage title="Privacy Policy">
    <p>
      This policy explains what pcobooster.com (“PCOBooster,” “we,” “us”)
      collects when you use the site and the scheduling app, why, and what
      control you have. PCOBooster is operated by Jake Bodea. It is in beta, so
      this policy may change as the product does.
    </p>

    <h2>Who we are</h2>
    <p>
      PCOBooster is an independent third-party tool that connects to your
      Planning Center Services account. It is not affiliated with, sponsored by,
      or endorsed by Planning Center. Planning Center is a trademark of Ministry
      Centered Technologies, Inc.
    </p>

    <h2>What we collect</h2>
    <p>
      <strong>Sign-in and account data.</strong> You sign in with Planning
      Center. We request the <code>openid</code>, <code>services</code>, and{" "}
      <code>people</code> scopes. We store your Planning Center name, email
      address, and organization ID and name, along with the OAuth access and
      refresh tokens Planning Center issues so we can act on your behalf, and a
      session record (with your IP address and browser user agent) so you stay
      signed in. This is kept in our database on Cloudflare D1.
    </p>
    <p>
      <strong>Planning Center data.</strong> To show availability, open
      positions, and serving history, the app reads people, teams, plans,
      schedules, blockouts, and songs from Planning Center using your access.
      When you assign, remove, or update a person or plan item, we send that
      change back to Planning Center. We do not keep a permanent copy of this
      data. Recent responses are cached briefly to keep the app fast and within
      Planning Center rate limits: in server memory and in Cloudflare Workers
      KV, for about 5 minutes for the team people directory and about 1 hour for
      the song catalog, with other reads cached for similar short periods.
    </p>
    <p>
      <strong>Activity log.</strong> We record a log of sign-ins, sign-outs,
      account linking, and scheduling actions you take (for example, who was
      assigned to which position and whether it succeeded). Each entry includes
      a timestamp, request path, IP address, and browser user agent. We use it
      to debug problems, prevent abuse, and understand how the app behaves.
    </p>
    <p>
      <strong>Feedback.</strong> If you send feedback from the app, we store
      your message, the page you were on, and your browser user agent, and
      forward the message to our analytics tool so we can read and reply to it.
    </p>
    <p>
      <strong>Analytics.</strong> We use PostHog (US region) for product and
      marketing analytics. Public pages record page views, the referring site or
      campaign, device and browser details, and clicks on links into the app.
      Inside the app we record page views and whether saved actions such as
      scheduling changes succeeded or failed. We mirror the activity log above,
      plus your name, email, and organization, to PostHog under your account so
      usage can be understood per user. Planning Center people you schedule are
      not identified in analytics. A sample of signed-in app sessions may be
      recorded as session replays with all text and inputs masked. We honor Do
      Not Track. Analytics uses cookies or similar browser storage to recognize
      a returning browser.
    </p>
    <p>
      <strong>iPhone app errors.</strong> When the iPhone app hits an error, it
      reports it to PostHog under your account: the kind of error, a shortened
      and filtered error message, the places in the app&apos;s code where it
      happened, the app version, build, and source revision, the iOS version,
      and a random ID for that run of the app. For a failed request it also
      reports which request it was, its request ID (so we can find our
      server&apos;s log line for it), its error code, and how long it took. The
      filter removes passwords, tokens, and other credentials, links, email
      addresses, file paths, long numbers, and long quoted values, but a short
      value inside a message can remain. Failed requests are reported with
      messages we write, never the server&apos;s answer. Reports from before you
      sign in wait on your phone for up to seven days and are sent under the
      account you then sign in to. Nothing is reported in a demo or when
      &ldquo;Share usage analytics and error reports&rdquo; is off. Turning it
      off deletes reports still waiting on the phone and stops a report being
      sent at that moment where it can, but a report PostHog has already
      received is kept there.
    </p>

    <h2>Why we use it</h2>
    <ul>
      <li>To sign you in and run the scheduling features you ask for.</li>
      <li>To keep the service secure, reliable, and free of abuse.</li>
      <li>To fix bugs, respond to feedback, and improve the product.</li>
    </ul>
    <p>
      We do not sell your data, share it for advertising, or use it to train AI
      models.
    </p>

    <h2>Who we share it with</h2>
    <p>
      We use a small set of service providers to run PCOBooster: Cloudflare
      (hosting, database, caching, and security) and PostHog (analytics and
      feedback). They process data on our behalf. We also share data with
      Planning Center, because that is the service you connect. We may disclose
      information if the law requires it.
    </p>

    <h2>Your data belongs to you and your church</h2>
    <p>
      The people, plans, and schedules in Planning Center belong to you and your
      organization. PCOBooster only reads and changes them at your direction,
      through the access you grant. You are responsible for having the right to
      use that data with PCOBooster, including for the people in your account.
    </p>

    <h2>Retention and deletion</h2>
    <p>
      Cached Planning Center data expires within the periods above. Account,
      session, activity, and feedback records are kept while your account is
      active and for as long as needed to run and secure the service. Session
      replays are kept for 30 days in PostHog.
    </p>
    <p>
      You can delete your account yourself in the iPhone app: open your account
      and choose Delete Account. That immediately and permanently deletes, from
      our database, your account, your linked Planning Center organizations and
      the OAuth tokens we stored for them, your sessions on every device, your
      feedback, and your activity log entries. It changes nothing in Planning
      Center. If you sign in again later, you start a new, empty account.
    </p>
    <p>
      Deleting your account also records a request to erase what PostHog holds
      about you: your analytics, the activity and feedback mirror, error
      reports, and session replays. You don&apos;t need to contact us for that.
      We send the erasure to PostHog no sooner than an hour after the deletion,
      so events already on their way are included, and again at least a week
      later; PostHog then removes the data in the background, so it can take up
      to a few weeks to finish. Entries in our server logs and the briefly
      cached Planning Center responses described above expire on their own. Our
      database provider&apos;s point-in-time recovery can hold deleted records
      for up to 30 days. To delete your account without the iPhone app, use the
      contact link below and we will do so within a reasonable time. Some
      records may remain where we are required to keep them.
    </p>

    <h2>Revoking access</h2>
    <p>
      You can disconnect PCOBooster at any time from your Planning Center
      account by removing it from your authorized applications. That invalidates
      the tokens we hold. Signing out of PCOBooster ends your session on that
      device. Revoking access does not delete data on its own, so delete your
      account if you want it removed. Deleting your account does not remove
      PCOBooster from your Planning Center authorized applications; remove it
      there as well if you no longer want it listed.
    </p>

    <h2>Security</h2>
    <p>
      Traffic uses HTTPS, and data is stored with Cloudflare. No system is
      perfectly secure, so we cannot guarantee absolute security.
    </p>

    <h2>Children</h2>
    <p>
      PCOBooster is meant for church staff and volunteers who manage scheduling.
      It is not directed to children under 13, and we do not knowingly collect
      their data.
    </p>

    <h2>Changes</h2>
    <p>
      If we change this policy in a meaningful way, we will update the effective
      date above and, where practical, tell signed-in users.
    </p>

    <LegalContact />
  </LegalPage>
);

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageHead({
      title: "Privacy Policy",
      description:
        "What PCOBooster collects when you sign in with Planning Center, why, how long it is kept, and how to have it deleted.",
      pathname: "/privacy",
    }),
  component: PrivacyPage,
});
