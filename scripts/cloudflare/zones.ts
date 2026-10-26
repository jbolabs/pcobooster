import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Effect } from "effect";

/** The certificate authorities Universal SSL may issue from; CAA records allow only these. */
const certificateAuthorities = [
  ["Google", "pki.goog"],
  ["Sectigo", "sectigo.com"],
  ["LetsEncrypt", "letsencrypt.org"],
] as const;

/** Restrict certificate issuance for a zone's apex (and its subdomains) to Universal SSL's CAs. */
export const allowUniversalSslIssuers = Effect.fn("allowUniversalSslIssuers")(
  function* allowUniversalSslIssuers(
    idPrefix: string,
    zone: Cloudflare.Zone.Zone,
    apex: string
  ) {
    for (const [id, issuer] of certificateAuthorities) {
      yield* Cloudflare.DNS.Record(`${idPrefix}CAA${id}`, {
        zoneId: zone.zoneId,
        name: apex,
        type: "CAA",
        content: { flags: 0, tag: "issue", value: issuer },
      });
    }
  }
);

/**
 * The id of a zone that must already exist in the account. The deploy tokens may not create
 * zones, so a missing zone stops the deploy here instead of failing on a permission error.
 */
export const existingZoneId = Effect.fn("existingZoneId")(
  function* existingZoneId(accountId: string, name: string) {
    const match = yield* Cloudflare.Zone.findZoneByName({
      accountId,
      name,
    }).pipe(Effect.orDie);
    if (match === undefined) {
      return yield* Effect.die(
        new Error(
          `Cloudflare zone ${name} does not exist in account ${accountId}. Add it by hand in ` +
            "the Cloudflare dashboard first; see docs/cloudflare-cutover.md#former-domain-cutover."
        )
      );
    }
    return match.id;
  }
);

/** Paths only vulnerability scanners request; neither app serves any of them. */
const scannerProbePaths = [
  "/.env",
  "/.git/",
  "/.aws",
  "/wp-",
  ".php",
  ".sql",
  "/@fs/",
  "/_ignition/",
] as const;

/** Block requests for scanner probe paths before they reach a Worker. */
export const scannerProbeRule: Cloudflare.Ruleset.Rule = {
  description: "Block vulnerability scanner probes",
  expression: scannerProbePaths
    .map((probe) => `lower(http.request.uri.path) contains "${probe}"`)
    .join(" or "),
  action: "block",
  enabled: true,
};

/**
 * Free-plan edge protection for a zone: Bot Fight Mode and a custom WAF rule for scanner probes.
 * Blocked requests never invoke a Worker. Bot Fight Mode cannot be bypassed on the Free plan, so
 * any future inbound webhook must be checked against it. It challenges scripted clients on
 * datacenter networks: since October 13, 2026 that includes every GitHub runner, so CI verifies
 * production through its workers.dev origin and the Cloudflare API, never through this zone.
 *
 * The AI crawler policy blocks model-training crawlers and leaves AI search crawlers (such as
 * OAI-SearchBot and Claude-SearchBot) and assistant fetches unblocked, so the public pages can be
 * found and cited. `disabled` means Cloudflare takes no action on that class.
 */
export const protectZoneEdge = Effect.fn("protectZoneEdge")(
  function* protectZoneEdge(idPrefix: string, zone: Cloudflare.Zone.Zone) {
    yield* Cloudflare.BotManagement.BotManagement(`${idPrefix}BotManagement`, {
      zoneId: zone.zoneId,
      // Cloudflare rejects Bot Fight Mode unless JavaScript detections are on too.
      enableJs: true,
      fightMode: true,
      aiSearch: "disabled",
      aiUser: "disabled",
      aiTraining: "block",
    });
    // Owns the zone's whole custom firewall phase.
    yield* Cloudflare.Ruleset.Ruleset(`${idPrefix}Firewall`, {
      zone,
      phase: "http_request_firewall_custom",
      rules: [scannerProbeRule],
    });
  }
);

/** The product's name until the September 18, 2026 rename; it only redirects now. */
export const formerDomain = "worshipadmin.com";
const formerHostnames = [formerDomain, `www.${formerDomain}`] as const;

/**
 * Permanently redirect every request for the former hostnames to the same path and query on
 * `canonicalOrigin`. HTTP 308 keeps the method and body, matching the redirect Vercel served.
 */
export const formerDomainRedirectRule = (
  canonicalOrigin: string
): Cloudflare.Ruleset.Rule => ({
  description: `Redirect ${formerDomain} to ${canonicalOrigin}`,
  expression: `http.host in {${formerHostnames.map((host) => `"${host}"`).join(" ")}}`,
  action: "redirect",
  actionParameters: {
    fromValue: {
      statusCode: 308,
      preserveQueryString: true,
      targetUrl: {
        expression: `concat("${canonicalOrigin}", http.request.uri.path)`,
      },
    },
  },
  enabled: true,
});

/**
 * The former domain's zone, answered entirely at Cloudflare's edge: proxied placeholder records
 * give the apex and www Universal SSL certificates, and a redirect rule answers every request
 * before any origin is consulted. The zone serves nothing until its nameservers point here.
 *
 * The zone is created by hand and adopted, never created here: creating a zone needs Zone Write
 * on every zone in the account, which the production deploy token deliberately lacks.
 */
export const formerDomainRedirect = Effect.fn("formerDomainRedirect")(
  function* formerDomainRedirect(canonicalOrigin: string) {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    yield* existingZoneId(accountId, formerDomain);
    const zone = yield* Cloudflare.Zone.Zone("FormerZone", {
      name: formerDomain,
      type: "full",
    }).pipe(adopt(true), RemovalPolicy.retain());
    yield* allowUniversalSslIssuers("Former", zone, formerDomain);
    yield* protectZoneEdge("Former", zone);
    for (const [id, hostname] of [
      ["FormerApex", formerHostnames[0]],
      ["FormerWww", formerHostnames[1]],
    ] as const) {
      yield* Cloudflare.DNS.Record(id, {
        zoneId: zone.zoneId,
        name: hostname,
        type: "AAAA",
        // Discard-prefix placeholder: the redirect rule answers, so no origin is ever contacted.
        content: "100::",
        proxied: true,
        comment: "Originless; the redirect rule answers every request.",
      });
    }
    // Owns the zone's whole dynamic redirect phase; nothing else redirects in this zone.
    yield* Cloudflare.Ruleset.Ruleset("FormerRedirect", {
      zone,
      phase: "http_request_dynamic_redirect",
      rules: [formerDomainRedirectRule(canonicalOrigin)],
    });
    return zone;
  }
);
