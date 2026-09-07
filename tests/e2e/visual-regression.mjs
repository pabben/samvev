import { chromium, expect } from "@playwright/test";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = process.env.VISUAL_CANDIDATE_DIR ?? "docs/implementation/artifacts/qa-candidates";
const baselineRoot = "docs/implementation/artifacts/qa-approved-baselines";
const mode = process.env.QA_VISUAL_MODE ?? "compare";
const approvedCandidate = {
  executedAt: "2026-09-07T02:46:05.751Z",
  manifestSha256: "255eef840bfe78431a62a5791f788aad8a1e1cd43e1c8b9e6648b66e098ca71f",
};
const profiles = [["mobile", 390, 844], ["shared", 1920, 1080], ["shelly-xl", 1280, 752]];
const names = profiles.flatMap(([profile]) => ["en", "nb"].flatMap((locale) => ["light", "dark"].map((theme) => `display-${profile}-${locale}-${theme}.png`)));
const results = [];

async function pngSize(path) {
  const value = await readFile(path);
  expect(value.subarray(1, 4).toString()).toBe("PNG");
  return { width: value.readUInt32BE(16), height: value.readUInt32BE(20), sha256: createHash("sha256").update(value).digest("hex") };
}

async function diff(page, baseline, actual, masks) {
  await page.goto("file:///workspace/tests/e2e/visual-compare.html");
  return page.evaluate(async ({ baseline, actual, masks }) => {
    const load = (src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
    const [a, b] = await Promise.all([load(baseline), load(actual)]);
    if (a.width !== b.width || a.height !== b.height) return { changedOutsideMask: -1, dimensions: [[a.width, a.height], [b.width, b.height]] };
    const canvas = document.createElement("canvas"); canvas.width = a.width; canvas.height = a.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(a, 0, 0); const first = context.getImageData(0, 0, a.width, a.height).data;
    context.clearRect(0, 0, a.width, a.height); context.drawImage(b, 0, 0); const second = context.getImageData(0, 0, a.width, a.height).data;
    let changedOutsideMask = 0;
    const samples = [];
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      if (masks.some((mask) => x >= mask.x && x < mask.x + mask.width && y >= mask.y && y < mask.y + mask.height)) continue;
      const i = (y * a.width + x) * 4;
      if (first[i] !== second[i] || first[i + 1] !== second[i + 1] || first[i + 2] !== second[i + 2] || first[i + 3] !== second[i + 3]) {
        changedOutsideMask++;
        if (samples.length < 24) samples.push({ x, y });
      }
    }
    return { changedOutsideMask, samples, dimensions: [[a.width, a.height], [b.width, b.height]] };
  }, { baseline: `file:///workspace/${baseline}`, actual: `file:///workspace/${actual}`, masks });
}

try {
  const smoke = JSON.parse(await readFile(`${root}/smoke-results.json`, "utf8"));
  const dynamicMasks = smoke.dynamicMasks;
  expect(dynamicMasks).toBeTruthy();
  for (const [profile, width, height] of profiles) for (const locale of ["en", "nb"]) for (const theme of ["light", "dark"]) {
    const name = `display-${profile}-${locale}-${theme}.png`;
    const actual = `${root}/${name}`;
    await access(actual);
    const dimensions = await pngSize(actual);
    expect([dimensions.width, dimensions.height], name).toEqual([width, height]);
    const masks = dynamicMasks[name.replace(/\.png$/, "")];
    expect(Array.isArray(masks) && masks.length > 0, `${name} requires recorded dynamic text bounds`).toBeTruthy();
    results.push({ name, ...dimensions, masks });
  }
  if (mode === "candidate") {
    await writeFile(`${root}/visual-candidate-manifest.json`, JSON.stringify({ executedAt: new Date().toISOString(), mode, dynamicTextMasks: "exact smoke-recorded rectangles for header date/time, card publication, expiry and footer update text; smoke separately asserts their Oslo/locale semantics", results }, null, 2) + "\n");
  } else if (mode === "approve") {
    const manifestPath = `${root}/visual-candidate-manifest.json`;
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes);
    expect(process.env.QA_APPROVED_CANDIDATE_SHA256).toBe(approvedCandidate.manifestSha256);
    expect(createHash("sha256").update(manifestBytes).digest("hex")).toBe(approvedCandidate.manifestSha256);
    expect(manifest.executedAt).toBe(approvedCandidate.executedAt);
    expect(manifest.results).toEqual(results);
    try {
      await access(`${baselineRoot}/visual-mask-manifest.json`);
      throw new Error("Approved visual baseline already exists; promotion is one-time only");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(baselineRoot, { recursive: true });
    for (const name of names) await copyFile(`${root}/${name}`, `${baselineRoot}/${name}`);
    await writeFile(`${baselineRoot}/visual-mask-manifest.json`, JSON.stringify({ source: root, approvedCandidate, masks: Object.fromEntries(results.map(({ name, masks }) => [name, masks])) }, null, 2) + "\n");
    await writeFile(`${root}/visual-approval-manifest.json`, JSON.stringify({ executedAt: new Date().toISOString(), mode, source: root, approvedCandidate, names }, null, 2) + "\n");
  } else if (mode === "compare") {
    const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
    try {
      const page = await browser.newPage();
      const baselineMasks = JSON.parse(await readFile(`${baselineRoot}/visual-mask-manifest.json`, "utf8")).masks;
      const failures = [];
      for (const name of names) {
        const outcome = await diff(page, `${baselineRoot}/${name}`, `${root}/${name}`, baselineMasks[name]);
        results.find((result) => result.name === name).comparison = outcome;
        if (outcome.changedOutsideMask !== 0) failures.push({ name, ...outcome });
      }
      expect(failures, `visual differences outside approved masks: ${JSON.stringify(failures)}`).toEqual([]);
    } finally { await browser.close(); }
    await writeFile(`${root}/visual-comparison.json`, JSON.stringify({ executedAt: new Date().toISOString(), mode, dynamicTextMasks: "approved baseline rectangles only", results }, null, 2) + "\n");
  } else throw new Error(`Unknown QA_VISUAL_MODE: ${mode}`);
} catch (error) {
  await writeFile(`${root}/visual-${mode}-failure.json`, JSON.stringify({ executedAt: new Date().toISOString(), mode, results, error: String(error?.stack ?? error) }, null, 2) + "\n");
  throw error;
}
