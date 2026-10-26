import { describe, expect, it } from "@effect/vitest";
import * as Stream from "effect/Stream";
import * as GitHubRest from "./GitHubRest.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubMediaFetch from "./gitHubMediaFetch.ts";

describe("GitHubMediaFetch", () => {
  it.effect("loads private media immediately after login with the GitHub credential", () => {
    let lookups = 0;
    const authorizations: Array<string | undefined> = [];
    return Effect.gen(function* () {
      const fetchMedia = yield* GitHubMediaFetch.make;
      const request = {
        url: "https://raw.githubusercontent.com/owner/repo/main/shot.png",
        headers: {},
      };
      expect((yield* fetchMedia(request))?.status).toBe(404);
      expect((yield* fetchMedia(request))?.status).toBe(200);
      expect((yield* fetchMedia(request))?.status).toBe(200);
      expect(lookups).toBe(3);
      expect(authorizations).toEqual([undefined, "Bearer signed-in", "Bearer signed-in"]);
    }).pipe(
      Effect.provide(
        Layer.mock(GitHubCredentials.GitHubCredentials)({
          get: (host) =>
            ++lookups === 1
              ? Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host }))
              : Effect.succeed({
                  host,
                  token: Redacted.make("signed-in"),
                  source: "gh" as const,
                  fingerprint: "fingerprint",
                }),
        }),
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          authorizations.push(request.headers.authorization);
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(null, {
                status: request.headers.authorization ? 200 : 404,
                headers: { "content-type": "image/png" },
              }),
            ),
          );
        }),
      ),
      Effect.provide(Layer.mock(GitHubRest.GitHubRest)({})),
      Effect.scoped,
    );
  });

  it.effect("keeps the credential off the object store a redirect hands the media to", () => {
    const authorizations: Array<[string, string | undefined]> = [];
    return Effect.gen(function* () {
      const fetchMedia = yield* GitHubMediaFetch.make;
      const response = yield* fetchMedia({
        url: "https://github.com/user-attachments/assets/1a1842fb",
        headers: { range: "bytes=0-1" },
      });
      expect(response?.status).toBe(200);
      expect(authorizations).toEqual([
        ["github.com", "Bearer signed-in"],
        ["objects.example.com", undefined],
      ]);
    }).pipe(
      Effect.provide(
        Layer.mock(GitHubCredentials.GitHubCredentials)({
          get: (host) =>
            Effect.succeed({
              host,
              token: Redacted.make("signed-in"),
              source: "gh" as const,
              fingerprint: "fingerprint",
            }),
        }),
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          const url = new URL(request.url);
          authorizations.push([url.hostname, request.headers.authorization]);
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              url.hostname === "github.com"
                ? new Response(null, {
                    status: 302,
                    headers: { location: "https://objects.example.com/signed" },
                  })
                : new Response(null, { status: 200 }),
            ),
          );
        }),
      ),
      Effect.provide(Layer.mock(GitHubRest.GitHubRest)({})),
      Effect.scoped,
    );
  });
});

const screenshotPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const githubMediaResponse = Effect.fn("test.githubMediaResponse")(function* (
  asset: { url: string; cwd: string; expiresAt: number; repositoryUrl?: string },
  headers: Record<string, string>,
) {
  const fetchMedia = yield* GitHubMediaFetch.make;
  return yield* fetchMedia({
    url: asset.url,
    headers,
    ...(asset.repositoryUrl === undefined ? {} : { repositoryUrl: asset.repositoryUrl }),
  });
});

describe("Personal contextual attachments", () => {
  it.effect("loads private media immediately after login with the GitHub credential", () => {
    let lookups = 0;
    const authorizations: Array<string | undefined> = [];
    return Effect.gen(function* () {
      const asset = {
        url: "https://raw.githubusercontent.com/owner/repo/main/shot.png",
        cwd: "/repo",
        expiresAt: Number.MAX_SAFE_INTEGER,
      };
      expect((yield* githubMediaResponse(asset, {}))?.status).toBe(404);
      expect((yield* githubMediaResponse(asset, {}))?.status).toBe(200);
      expect((yield* githubMediaResponse(asset, {}))?.status).toBe(200);
      expect(lookups).toBe(3);
      expect(authorizations).toEqual([undefined, "Bearer signed-in", "Bearer signed-in"]);
    }).pipe(
      Effect.provide(
        Layer.mock(GitHubCredentials.GitHubCredentials)({
          get: (host) =>
            ++lookups === 1
              ? Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host }))
              : Effect.succeed({
                  host,
                  token: Redacted.make("signed-in"),
                  source: "gh" as const,
                  fingerprint: "fingerprint",
                }),
        }),
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          authorizations.push(request.headers.authorization);
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(null, {
                status: request.headers.authorization ? 200 : 404,
                headers: { "content-type": "image/png" },
              }),
            ),
          );
        }),
      ),
      Effect.provide(Layer.mock(GitHubRest.GitHubRest)({})),
      Effect.scoped,
    );
  });

  it.effect.each([
    { name: "PNG", type: "image/png", bytes: screenshotPng, status: 200, headers: {} },
    {
      name: "MP4 range",
      type: "video/mp4",
      bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      status: 206,
      headers: { range: "bytes=0-7", "if-range": '"video-version"' },
    },
  ])("resolves canonical sign-in HTML to $name bytes in the displayed repository", (media) => {
    const canonical = "https://github.com/user-attachments/assets/example-attachment";
    const signed =
      "https://private-user-images.githubusercontent.com/123/example?fixture=one&part=two";
    const requests: string[] = [];
    let canonicalSignal: AbortSignal | undefined;
    return Effect.gen(function* () {
      const asset = {
        url: canonical,
        cwd: "/different-checkout",
        repositoryUrl: "https://github.com/displayed/repository",
        expiresAt: Number.MAX_SAFE_INTEGER,
      };
      const response = (yield* githubMediaResponse(asset, media.headers))!;
      expect(response.status).toBe(media.status);
      expect(response.headers["content-type"]).toBe(media.type);
      expect(
        new Uint8Array((yield* Stream.runCollect(response.stream)).flatMap((chunk) => [...chunk])),
      ).toEqual(media.bytes);
      if (media.status === 206) {
        expect(response.headers["content-range"]).toBe("bytes 0-7/100");
        expect(response.headers["accept-ranges"]).toBe("bytes");
        expect(response.headers.etag).toBe('"video-version"');
      }
      expect(requests).toEqual([canonical, signed]);
    }).pipe(
      Effect.provide([
        Layer.mock(GitHubRest.GitHubRest)({
          rest: (input) => {
            expect(canonicalSignal?.aborted).toBe(true);
            expect(input).toMatchObject({
              host: "github.com",
              method: "POST",
              path: "markdown",
              body: {
                mode: "gfm",
                text: `![](<${canonical}>)`,
                context: "displayed/repository",
              },
            });
            return Effect.succeed({
              status: 200,
              headers: {},
              truncated: false,
              invalidUtf8: false,
              body: `<p><a href="${canonical}"><img src="${signed.replaceAll("&", "&amp;")}" data-canonical-src="${canonical}"></a></p>`,
            });
          },
        }),
        Layer.mock(GitHubCredentials.GitHubCredentials)({
          get: (host) =>
            Effect.succeed({
              host,
              token: Redacted.make("api-token"),
              source: "gh",
              fingerprint: "test",
            }),
        }),
      ]),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request, _url, signal) => {
          requests.push(request.url);
          if (request.url === canonical) {
            canonicalSignal = signal;
            expect(request.headers.authorization).toBe("Bearer api-token");
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response("<html>Sign in</html>", {
                  headers: { "content-type": "text/html; charset=utf-8" },
                }),
              ),
            );
          }
          expect(request.url).toBe(signed);
          expect(request.headers.authorization).toBeUndefined();
          expect(request.headers.range).toBe(media.headers.range);
          expect(request.headers["if-range"]).toBe(media.headers["if-range"]);
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(media.bytes, {
                status: media.status,
                headers: {
                  "content-type": media.type,
                  "accept-ranges": "bytes",
                  "content-range": "bytes 0-7/100",
                  etag: '"video-version"',
                },
              }),
            ),
          );
        }),
      ),
      Effect.scoped,
    );
  });

  it.effect("rejects untrusted or incomplete Markdown media sources without fetching them", () =>
    Effect.gen(function* () {
      const canonical = "https://github.com/user-attachments/assets/example-attachment";
      for (const rendered of [
        { body: '<img src="https://unrelated.example/image.png">' },
        { body: '<img src="http://private-user-images.githubusercontent.com/image.png">' },
        {
          body: '<img src="https://credential@private-user-images.githubusercontent.com/image.png">',
        },
        { body: '<img src="https://private-user-images.githubusercontent.com:8443/image.png">' },
        { body: `<img src="${canonical}">` },
        { body: '<a href="https://private-user-images.githubusercontent.com/image.png">image</a>' },
        { body: '<img data-src="https://private-user-images.githubusercontent.com/image.png">' },
        {
          body: '<img src="https://private-user-images.githubusercontent.com/image.png">',
          truncated: true,
        },
        {
          body: '<img src="https://private-user-images.githubusercontent.com/image.png">',
          invalidUtf8: true,
        },
      ]) {
        const fetches: string[] = [];
        const response = yield* githubMediaResponse(
          {
            url: canonical,
            cwd: "/other-checkout",
            repositoryUrl: "https://github.com/displayed/repository",
            expiresAt: Number.MAX_SAFE_INTEGER,
          },
          {},
        ).pipe(
          Effect.provide([
            Layer.mock(GitHubRest.GitHubRest)({
              rest: () =>
                Effect.succeed({
                  status: 200,
                  headers: {},
                  truncated: false,
                  invalidUtf8: false,
                  ...rendered,
                }),
            }),
            Layer.mock(GitHubCredentials.GitHubCredentials)({
              get: (host) => Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host })),
            }),
          ]),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              fetches.push(request.url);
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response("<html>Sign in</html>", {
                    headers: { "content-type": "text/html" },
                  }),
                ),
              );
            }),
          ),
          Effect.scoped,
        );
        expect(response).toBeNull();
        expect(fetches).toEqual([canonical]);
      }
    }),
  );

  it.effect(
    "resolves only contextual attachment HTML and eligible errors, never a range refusal",
    () =>
      Effect.gen(function* () {
        const canonical = "https://github.com/user-attachments/assets/example-attachment";
        for (const scenario of [
          { url: canonical, status: 401, context: true, renders: 1, expected: 200 },
          { url: canonical, status: 403, context: true, renders: 1, expected: 200 },
          { url: canonical, status: 404, context: true, renders: 1, expected: 200 },
          { url: canonical, status: 416, context: true, renders: 0, expected: 416 },
          { url: canonical, status: 200, context: false, renders: 0, expected: 415 },
          {
            url: "https://raw.githubusercontent.com/owner/repo/main/image.png",
            status: 200,
            context: true,
            renders: 0,
            expected: 415,
          },
        ]) {
          let renders = 0;
          const response = yield* githubMediaResponse(
            {
              url: scenario.url,
              cwd: "/repo",
              ...(scenario.context
                ? { repositoryUrl: "https://github.com/displayed/repository" }
                : {}),
              expiresAt: Number.MAX_SAFE_INTEGER,
            },
            {},
          ).pipe(
            Effect.provide([
              Layer.mock(GitHubRest.GitHubRest)({
                rest: () => {
                  renders += 1;
                  return Effect.succeed({
                    status: 200,
                    headers: {},
                    truncated: false,
                    invalidUtf8: false,
                    body: '<img src="https://private-user-images.githubusercontent.com/image.png?one=1&#38;two=2">',
                  });
                },
              }),
              Layer.mock(GitHubCredentials.GitHubCredentials)({
                get: (host) => Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host })),
              }),
            ]),
            Effect.provideService(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    request.url === scenario.url
                      ? new Response("<html>Sign in</html>", {
                          status: scenario.status,
                          headers: { "content-type": "text/html" },
                        })
                      : new Response(screenshotPng, { headers: { "content-type": "image/png" } }),
                  ),
                ),
              ),
            ),
            Effect.scoped,
          );
          expect(response?.status).toBe(scenario.expected === 415 ? 200 : scenario.expected);
          expect(renders).toBe(scenario.renders);
        }
      }),
  );
});
