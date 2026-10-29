const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";
const CAPTURE_TIMEOUT_MS = 1500;

/** Person profile fields, keyed by Better Auth user ID. */
export interface PostHogPersonProperties {
  readonly email: string;
  readonly name: string;
  readonly organizationId: string | null;
  readonly organizationName: string | null;
}

export interface PostHogPersonSet {
  readonly email: string;
  readonly name: string;
  readonly organization_id: string | null;
  readonly organization_name: string | null;
}

export const toPostHogPersonSet = (
  person: PostHogPersonProperties
): PostHogPersonSet => ({
  email: person.email,
  name: person.name,
  organization_id: person.organizationId,
  organization_name: person.organizationName,
});

export interface PostHogCaptureBody {
  readonly api_key: string;
  readonly event: string;
  readonly distinct_id: string;
  readonly timestamp: string;
  readonly properties: object;
}

export type SendPostHogCapture = (capture: PostHogCaptureBody) => Promise<void>;

export const createPostHogCaptureSender =
  (send: typeof globalThis.fetch): SendPostHogCapture =>
  async (capture) => {
    const response = await send(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(capture),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`PostHog capture failed with status ${response.status}`);
    }
  };
