import * as fs from "fs";
import * as path from "path";

import { expect, test, type Page, type Response } from "@playwright/test";

type Phase0FixtureCase = {
    id: string;
    transport: "worker" | "local";
    devHostQsps: string;
    visualTestTitle: string;
    referenceImage: string;
};

type Phase0Fixture = {
    id: string;
    description: string;
    cases: Phase0FixtureCase[];
    futureForbiddenJsUrlPatterns: string[];
    futureZeroByteJsUrlPatterns?: string[];
};

type Phase0FixtureManifest = {
    description: string;
    fixtures: Phase0Fixture[];
};

type LottieSubEntry = "local" | "worker";

const FixtureManifestPath = path.resolve(__dirname, "../../../../dev/lottiePlayer/test/fixtures/phase0LottieFixtures.json");
const manifest = JSON.parse(fs.readFileSync(FixtureManifestPath, "utf8")) as Phase0FixtureManifest;

function buildDevHostUrl(baseUrl: string | undefined, qsp: string): string {
    const url = new URL(baseUrl ?? "http://localhost:1338");
    url.search = qsp.startsWith("?") ? qsp.substring(1) : qsp;
    return url.toString();
}

function getSubEntryForTransport(transport: Phase0FixtureCase["transport"]): LottieSubEntry {
    return transport === "worker" ? "worker" : "local";
}

function addSubEntryToQsp(qsp: string, entry: LottieSubEntry): string {
    const searchParams = new URLSearchParams(qsp.startsWith("?") ? qsp.substring(1) : qsp);
    searchParams.set("entry", entry);
    return searchParams.toString();
}

function isJavaScriptResponse(response: Response): boolean {
    const url = response.url();
    const resourceType = response.request().resourceType();
    const contentType = response.headers()["content-type"] ?? "";
    return resourceType === "script" || contentType.includes("javascript") || /(?:\.m?js|\.ts)(?:[?#]|$)/.test(url) || url.includes("__lottie-worker.js");
}

type FetchedJavaScriptResult = {
    totalBytes: number;
    urls: string[];
    entries: Array<{ url: string; bytes: number }>;
};

async function collectFetchedJavaScriptBytes(page: Page, run: () => Promise<void>): Promise<FetchedJavaScriptResult> {
    const urls: string[] = [];
    const entries: Array<{ url: string; bytes: number }> = [];
    const responseReads: Promise<void>[] = [];
    let totalBytes = 0;

    const onResponse = (response: Response) => {
        if (!isJavaScriptResponse(response)) {
            return;
        }

        responseReads.push(
            response
                .body()
                .then((body) => {
                    totalBytes += body.byteLength;
                    const url = response.url();
                    urls.push(url);
                    entries.push({ url, bytes: body.byteLength });
                })
                .catch(() => {
                    // Some browser/dev-server responses are not body-readable. Keep the harness resilient;
                    // later phases assert feature chunk presence/absence by URL, not exact byte ceilings.
                    const url = response.url();
                    urls.push(url);
                    entries.push({ url, bytes: 0 });
                })
        );
    };

    page.on("response", onResponse);
    try {
        await run();
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await Promise.allSettled(responseReads);
    } finally {
        page.off("response", onResponse);
    }

    return { totalBytes, urls, entries };
}

function getFetchedBytesForPattern(result: FetchedJavaScriptResult, pattern: string): number {
    return result.entries.reduce((sum, entry) => (entry.url.includes(pattern) ? sum + entry.bytes : sum), 0);
}

test.describe("Lottie Phase 0 fetched JavaScript baselines", () => {
    for (const fixture of manifest.fixtures) {
        for (const fixtureCase of fixture.cases) {
            test(`${fixture.id} (${fixtureCase.transport})`, async ({ page, baseURL }) => {
                const entry = getSubEntryForTransport(fixtureCase.transport);
                const url = buildDevHostUrl(baseURL, addSubEntryToQsp(fixtureCase.devHostQsps, entry));
                const result = await collectFetchedJavaScriptBytes(page, async () => {
                    await page.goto(url, { waitUntil: "load", timeout: 0 });
                    await page.waitForSelector("#lottie-ready", { state: "visible", timeout: 30000 });
                });

                for (const pattern of fixture.futureForbiddenJsUrlPatterns) {
                    expect(
                        result.urls.some((fetchedUrl) => fetchedUrl.includes(pattern)),
                        `${pattern} should not be fetched for ${fixtureCase.id}`
                    ).toBe(false);
                }

                for (const pattern of fixture.futureZeroByteJsUrlPatterns ?? []) {
                    expect(getFetchedBytesForPattern(result, pattern), `${pattern} should contribute zero fetched JavaScript bytes for ${fixtureCase.id}`).toBe(0);
                }

                if (entry === "local") {
                    expect(
                        result.urls.some((fetchedUrl) => fetchedUrl.includes("__lottie-worker.js") || fetchedUrl.toLowerCase().includes("workerentry")),
                        `${fixtureCase.id} should not fetch the worker script through the local sub-entry`
                    ).toBe(false);
                }

                expect(result.urls.length, `${fixtureCase.id} should fetch JavaScript`).toBeGreaterThan(0);
                expect(result.totalBytes, `${fixtureCase.id} should have measurable JavaScript bytes`).toBeGreaterThan(0);

                test.info().annotations.push({
                    type: "lottie-phase0-fetched-js",
                    description: JSON.stringify({
                        fixture: fixture.id,
                        case: fixtureCase.id,
                        transport: fixtureCase.transport,
                        entry,
                        totalBytes: result.totalBytes,
                        scripts: result.urls.length,
                    }),
                });
            });
        }
    }
});
