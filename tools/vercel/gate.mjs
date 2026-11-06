// Vercel's ignore step (vercel.json "ignoreCommand"): exit 0 skips the deployment, exit 1 lets
// it go ahead. Nothing deploys unless every required check has passed on the code being
// deployed:
//   - a branch other than main never deploys (no preview of untested work);
//   - a commit on main deploys only when it came from a merged pull request whose head commit
//     passed ruff, pytest and the render audit (main is protected, strict and enforced for
//     admins, so the merge is that tested tree);
//   - anything the gate cannot confirm -- a direct push, an API failure -- is skipped.
// GitHub links a merge commit to its pull request a little after the merge, and Vercel asks
// straight away. So while the pull request is not yet found, a required check has not yet
// finished, or GitHub answers busy (403, 429, 5xx), the gate asks again every GATE_POLL_S
// seconds (default 20) for up to GATE_WAIT_S (default 180): few enough asks for GitHub's
// anonymous rate limit. A check that finished and did not pass is never waited on.
// GitHub is asked without a token (the repository is public); set GITHUB_TOKEN in the Vercel
// project to lift the anonymous rate limit.
const REQUIRED = ["ruff", "pytest", "render audit vs baseline"];
const REPO = "patstallone1-prog/Spatial-data-mapping";
const ref = process.env.VERCEL_GIT_COMMIT_REF || "";
const sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
const skip = (why) => { console.log(`gate: not deploying -- ${why}`); process.exit(0); };
if (ref !== "main") skip(`branch ${ref || "(none)"} is not main`);
if (!/^[0-9a-f]{40}$/.test(sha)) skip("no commit sha");
const headers = { Accept: "application/vnd.github+json", "User-Agent": "kerbside-vercel-gate" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const get = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers });
  // A rate limit or a server error may pass; anything else GitHub refuses is final.
  if (r.status === 403 || r.status === 429 || r.status >= 500) throw new Busy(`GitHub ${path} answered ${r.status}`);
  if (!r.ok) skip(`GitHub ${path} answered ${r.status}`);
  return r.json();
};
class Busy extends Error {}
const WAIT_S = Number(process.env.GATE_WAIT_S ?? 180);
const POLL_S = Number(process.env.GATE_POLL_S ?? 20);
const sleep = (s) => new Promise((done) => setTimeout(done, s * 1000));

// One look at GitHub: {deploy: pr}, {skip: why} (final), or {wait: why} (ask again later).
async function look() {
  const pulls = await get(`/commits/${sha}/pulls`);
  const pr = pulls.find((p) => p.merged_at && p.base.ref === "main" && p.merge_commit_sha === sha);
  if (!pr) return { wait: `${sha.slice(0, 8)} is not (yet) the merge of a pull request` };
  const runs = (await get(`/commits/${pr.head.sha}/check-runs?per_page=100`)).check_runs;
  for (const name of REQUIRED) {
    const run = runs.filter((r) => r.name === name).sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""))[0];
    if (!run || run.status !== "completed") return { wait: `check "${name}" is ${run ? run.status : "missing"} on #${pr.number}` };
    if (run.conclusion !== "success") return { skip: `check "${name}" is ${run.conclusion} on #${pr.number}` };
  }
  return { deploy: pr };
}

try {
  const deadline = Date.now() + WAIT_S * 1000;
  for (;;) {
    const seen = await look().catch((err) => { if (err instanceof Busy) return { wait: err.message }; throw err; });
    if (seen.deploy) {
      console.log(`gate: deploying ${sha.slice(0, 8)} -- #${seen.deploy.number} passed ${REQUIRED.join(", ")}`);
      process.exit(1);
    }
    if (seen.skip) skip(seen.skip);
    if (Date.now() + POLL_S * 1000 > deadline) skip(seen.wait);
    console.log(`gate: waiting -- ${seen.wait}`);
    await sleep(POLL_S);
  }
} catch (err) {
  skip(`gate error ${err}`);
}
