import { existsSync, readFileSync, readdirSync } from "fs";
import * as path from "path";
import { performance } from "perf_hooks";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { ResolveFeatureConfiguration } from "../../src/animationConfiguration";
import { DetectLottieFeatures } from "../../src/load/detectFeatures";
import { type RawLottieAnimation } from "../../src/parsing/rawTypes";

// Phase B measurement baseline.
//
// Phase B's entire payoff is faster time-to-first-frame, NOT fewer bytes (it gives back none of
// Phase A's download savings). Its claimed mechanism is removing the serial `JSON.parse -> detect`
// hop (B1 precomputes the feature list at build time) and starting the feature-chunk fetch earlier /
// in parallel with the data download (B3). Before writing B1-B5 we must quantify the thing Phase B
// removes, so the go/no-go is driven by a number and not faith.
//
// This Node harness measures only the deterministic CPU stages of the startup chain:
//
//   download JSON -> JSON.parse -> detect -> import() chunks -> build -> pack -> rasterize -> first frame
//                    \__ parseMs __/\_ detectMs _/
//                                   ^^^^^^^^^^^^ exactly what B1 moves to build time
//
// Network fetch and GPU rasterization are intentionally out of scope here: they need a real browser
// (a devhost-based TTFF measurement) and cannot be measured faithfully in Node. What this harness can
// answer is "how big is the detect hop B1 deletes, relative to the parse it sits behind?" If detect is
// negligible next to parse, B1 alone is not worth it and any Phase B win must come from B3's parallel
// fetch instead — which this number tells us up front.
//
// As a bonus, the per-fixture detected feature set recorded here is precisely the manifest B1 would
// emit, so this test also acts as the correctness oracle for that future build artifact.

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDirectory, "../..");
const fixtureRoot = path.resolve(packageRoot, "../../tools/devHost/public/phase0");

// Large, real-world animations (110 KB - 1.3 MB) live here. The directory is gitignored, so it is
// present only on a developer machine that has copied the official assets in; the suite below skips
// itself when it is absent so CI stays green.
const officialFixtureRoot = path.resolve(packageRoot, "../../tools/devHost/public/localDev/official");

const knownFeatureIds = new Set(["solid", "shape", "text", "shape-gradient"]);

// Realistic single- and multi-feature animations shared with the Phase 0 fixture set / visual tests.
const fixtureFileNames = ["solidOnly", "shapeOnly", "textOnly", "noTextRealistic", "mixed"] as const;

interface StageMeasurement {
    fixture: string;
    bytes: number;
    parseMs: number;
    detectMs: number;
    // Share of the measured CPU prep (parse + detect) that B1 would remove. The honest Phase B signal.
    detectShareOfCpuPrep: number;
    features: string[];
}

// Median is more stable than mean for micro-benchmarks: it resists GC pauses and JIT warm-up outliers.
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Warms up first so JIT compilation and cold caches do not skew the early samples, then returns the
// median per-iteration duration in milliseconds.
function measure(fn: () => void, iterations: number): number {
    const warmUp = Math.min(iterations, 50);
    for (let i = 0; i < warmUp; i++) {
        fn();
    }

    const samples: number[] = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        fn();
        samples[i] = performance.now() - start;
    }

    return median(samples);
}

describe("startup CPU-stage measurement (Phase B baseline)", () => {
    const featureConfig = ResolveFeatureConfiguration({});
    const measurements: StageMeasurement[] = [];

    for (const fileName of fixtureFileNames) {
        it(`measures parse vs detect for ${fileName}`, () => {
            const filePath = path.join(fixtureRoot, `${fileName}.json`);
            const text = readFileSync(filePath, "utf8");
            const bytes = Buffer.byteLength(text, "utf8");

            // parse: a fresh JSON.parse each iteration (the runtime cost B1 cannot remove).
            const parseMs = measure(() => {
                JSON.parse(text);
            }, 200);

            // detect: parse once, then detect repeatedly (the serial hop B1 precomputes away).
            const raw = JSON.parse(text) as RawLottieAnimation;
            const detectMs = measure(() => {
                DetectLottieFeatures(raw, featureConfig);
            }, 2000);

            const features = DetectLottieFeatures(raw, featureConfig);
            const detectShareOfCpuPrep = parseMs + detectMs > 0 ? detectMs / (parseMs + detectMs) : 0;

            measurements.push({ fixture: fileName, bytes, parseMs, detectMs, detectShareOfCpuPrep, features });

            // Timing teeth: every stage must produce a finite, non-negative measurement so a broken
            // harness (NaN, negative, or absent timing) fails instead of silently reporting nothing.
            expect(Number.isFinite(parseMs)).toBe(true);
            expect(Number.isFinite(detectMs)).toBe(true);
            expect(parseMs).toBeGreaterThanOrEqual(0);
            expect(detectMs).toBeGreaterThanOrEqual(0);

            // Manifest-oracle teeth: every real animation needs at least one feature, and detection
            // must only ever return ids the registry can actually load. This is the correctness
            // contract a future B1 build manifest has to satisfy.
            expect(features.length).toBeGreaterThan(0);
            for (const id of features) {
                expect(knownFeatureIds.has(id)).toBe(true);
            }
        });
    }

    it("reports the parse/detect baseline so the Phase B decision is driven by numbers", () => {
        expect(measurements.length).toBe(fixtureFileNames.length);

        const rows = measurements.map((m) => ({
            fixture: m.fixture,
            bytes: m.bytes,
            "parse (ms)": Number(m.parseMs.toFixed(4)),
            "detect (ms)": Number(m.detectMs.toFixed(4)),
            "detect % of cpu prep": Number((m.detectShareOfCpuPrep * 100).toFixed(1)),
            features: m.features.join(", "),
        }));

        // eslint-disable-next-line no-console
        console.table(rows);

        const totalParse = measurements.reduce((sum, m) => sum + m.parseMs, 0);
        const totalDetect = measurements.reduce((sum, m) => sum + m.detectMs, 0);
        const aggregateDetectShare = totalParse + totalDetect > 0 ? (totalDetect / (totalParse + totalDetect)) * 100 : 0;

        // eslint-disable-next-line no-console
        console.log(
            `[Phase B baseline] aggregate detect share of CPU prep: ${aggregateDetectShare.toFixed(1)}% ` +
                `(detect ${totalDetect.toFixed(4)} ms vs parse ${totalParse.toFixed(4)} ms across ${measurements.length} fixtures). ` +
                `B1 precomputes the detect portion; if this share is small the Phase B win must come from B3 parallel fetch, not B1.`
        );

        expect(aggregateDetectShare).toBeGreaterThanOrEqual(0);
        expect(aggregateDetectShare).toBeLessThanOrEqual(100);
    });
});

// The tiny Phase 0 fixtures above are all under 5 KB, where both parse and detect are sub-millisecond
// and the parse/detect split could be dominated by fixed overhead. Real Lottie files shipped in
// products are 100 KB - 1.3 MB, so this suite re-runs the same measurement against the official assets
// to confirm the Phase B conclusion holds (or flips) at realistic sizes. It is skipped when the
// gitignored asset folder is not present.
const officialFixtureFiles = existsSync(officialFixtureRoot)
    ? readdirSync(officialFixtureRoot)
          .filter((name) => name.toLowerCase().endsWith(".json"))
          .sort()
    : [];

const describeOfficial = officialFixtureFiles.length > 0 ? describe : describe.skip;

describeOfficial("startup CPU-stage measurement on large real-world fixtures (Phase B baseline)", () => {
    const featureConfig = ResolveFeatureConfiguration({});
    const measurements: StageMeasurement[] = [];

    for (const fileName of officialFixtureFiles) {
        it(`measures parse vs detect for ${fileName}`, () => {
            const filePath = path.join(officialFixtureRoot, fileName);
            const text = readFileSync(filePath, "utf8");
            const bytes = Buffer.byteLength(text, "utf8");

            // Fewer iterations than the tiny fixtures: a single parse of a 1.3 MB file is milliseconds,
            // not microseconds, so a smaller sample still yields a stable median without bloating runtime.
            const parseMs = measure(() => {
                JSON.parse(text);
            }, 30);

            const raw = JSON.parse(text) as RawLottieAnimation;
            const detectMs = measure(() => {
                DetectLottieFeatures(raw, featureConfig);
            }, 200);

            const features = DetectLottieFeatures(raw, featureConfig);
            const detectShareOfCpuPrep = parseMs + detectMs > 0 ? detectMs / (parseMs + detectMs) : 0;

            measurements.push({ fixture: fileName, bytes, parseMs, detectMs, detectShareOfCpuPrep, features });

            expect(Number.isFinite(parseMs)).toBe(true);
            expect(Number.isFinite(detectMs)).toBe(true);
            expect(parseMs).toBeGreaterThanOrEqual(0);
            expect(detectMs).toBeGreaterThanOrEqual(0);

            expect(features.length).toBeGreaterThan(0);
            for (const id of features) {
                expect(knownFeatureIds.has(id)).toBe(true);
            }
        });
    }

    it("reports the parse/detect baseline at realistic file sizes", () => {
        expect(measurements.length).toBe(officialFixtureFiles.length);

        const rows = measurements.map((m) => ({
            fixture: m.fixture,
            KB: Number((m.bytes / 1024).toFixed(1)),
            "parse (ms)": Number(m.parseMs.toFixed(4)),
            "detect (ms)": Number(m.detectMs.toFixed(4)),
            "detect % of cpu prep": Number((m.detectShareOfCpuPrep * 100).toFixed(1)),
            features: m.features.join(", "),
        }));

        // eslint-disable-next-line no-console
        console.table(rows);

        const totalParse = measurements.reduce((sum, m) => sum + m.parseMs, 0);
        const totalDetect = measurements.reduce((sum, m) => sum + m.detectMs, 0);
        const aggregateDetectShare = totalParse + totalDetect > 0 ? (totalDetect / (totalParse + totalDetect)) * 100 : 0;

        // eslint-disable-next-line no-console
        console.log(
            `[Phase B baseline / large fixtures] aggregate detect share of CPU prep: ${aggregateDetectShare.toFixed(1)}% ` +
                `(detect ${totalDetect.toFixed(4)} ms vs parse ${totalParse.toFixed(4)} ms across ${measurements.length} fixtures, ` +
                `${(measurements.reduce((sum, m) => sum + m.bytes, 0) / 1024 / 1024).toFixed(2)} MB total). ` +
                `If detect stays small even here, B1 remains marginal and the Phase B win must come from B3 parallel fetch.`
        );

        expect(aggregateDetectShare).toBeGreaterThanOrEqual(0);
        expect(aggregateDetectShare).toBeLessThanOrEqual(100);
    });
});
