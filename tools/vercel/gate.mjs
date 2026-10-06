// Vercel's ignore step (vercel.json "ignoreCommand"): exit 0 skips the deployment, exit 1 lets
// it go ahead. Nothing deploys unless every required check has passed on the code being
// deployed:
//   - a branch other than main never deploys (no preview of untested work);
//   - a commit on main deploys only when it came from a merged pull request whose head commit
//     passed ruff, pytest and the render audit (main is protected, strict and enforced for
//     admins, so the merge is that tested tree);
//   - anything the gate cannot confirm -- a direct push, an API failure -- is skipped.
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
  if (!r.ok) skip(`GitHub ${path} answered ${r.status}`);
  return r.json();
};
try {
  const pulls = await get(`/commits/${sha}/pulls`);
  const pr = pulls.find((p) => p.merged_at && p.base.ref === "main" && p.merge_commit_sha === sha);
  if (!pr) skip(`${sha.slice(0, 8)} is not the merge of a pull request`);
  const runs = (await get(`/commits/${pr.head.sha}/check-runs?per_page=100`)).check_runs;
  for (const name of REQUIRED) {
    const run = runs.filter((r) => r.name === name).sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""))[0];
    if (!run || run.conclusion !== "success") skip(`check "${name}" is ${run ? run.conclusion || run.status : "missing"} on #${pr.number}`);
  }
  console.log(`gate: deploying ${sha.slice(0, 8)} -- #${pr.number} passed ${REQUIRED.join(", ")}`);
  process.exit(1);
} catch (err) {
  skip(`gate error ${err}`);
}
