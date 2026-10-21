import { Schema } from "effect";

export interface GitHubAppCredentials {
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}
const encode = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const jsonPart = (value: Record<string, string | number>): string =>
  encode(new TextEncoder().encode(JSON.stringify(value)));

export const installationToken = async (
  credentials: GitHubAppCredentials,
  request: typeof fetch = fetch,
  now: number = Date.now()
): Promise<string> => {
  const seconds = Math.floor(now / 1000);
  const payload = `${jsonPart({ alg: "RS256", typ: "JWT" })}.${jsonPart({ iat: seconds - 60, exp: seconds + 540, iss: credentials.GITHUB_APP_ID })}`;
  const pem = credentials.GITHUB_APP_PRIVATE_KEY.replace(
    "-----BEGIN PRIVATE KEY-----",
    ""
  )
    .replace("-----END PRIVATE KEY-----", "")
    .replaceAll(/\s/gu, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (character) => character.codePointAt(0) ?? 0),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(payload)
  );
  if (!/^\d+$/u.test(credentials.GITHUB_INSTALLATION_ID)) {
    throw new Error("Invalid GitHub installation ID");
  }
  const response = await request(
    `https://api.github.com/app/installations/${credentials.GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload}.${encode(new Uint8Array(signature))}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "pcobooster-cloudflare-builds",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repository_ids: [1_125_110_564],
        permissions: { contents: "read", pull_requests: "read" },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `GitHub installation authentication failed: ${response.status}`
    );
  }
  return Schema.decodeUnknownSync(Schema.Struct({ token: Schema.String }))(
    await response.json()
  ).token;
};

export const allowedGitHubPath = (path: string): boolean =>
  /^(?:pulls\/[1-9]\d*|commits\/[a-f0-9]{40}\/pulls|commits\/main)$/u.test(
    path
  );
