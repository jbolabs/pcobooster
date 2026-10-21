export const githubReadRequest = (url: string, token: string): Request =>
  new Request(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "pcobooster-cloudflare-builds",
    },
    redirect: "manual",
  });

export const repositoryReadResult = (response: Response): Response => {
  if (response.status >= 300 && response.status < 400) {
    return new Response("Repository redirect refused", { status: 502 });
  }
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
