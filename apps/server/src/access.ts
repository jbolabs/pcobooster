/** Who Cloudflare Access admits when `PCOBOOSTER_ADMIN_EMAILS` names no one. */
const OWNER_EMAIL = "jakebodea@gmail.com";

/**
 * `PCOBOOSTER_ADMIN_EMAILS` (comma-separated) as the lowercase addresses Cloudflare Access admits
 * to every staging and pull request stage (`alchemy.run.ts`).
 */
export const parseTeamEmails = (configured: string): string[] => {
  const emails = configured
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return emails.length > 0 ? emails : [OWNER_EMAIL];
};
