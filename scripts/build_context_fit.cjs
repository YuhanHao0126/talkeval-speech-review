"use strict";
const fs = require("node:fs");
const path = require("node:path");
const site = path.resolve(__dirname, "..");
const fit = require(path.join(site, "dist", "context-fit.js"));
const caseDir = path.join(site, "dist", "data", "cases");
const summary = { version: fit.VERSION, cases: 0, points: 0, statuses: {} };
for (const name of fs.readdirSync(caseDir).filter(name => name.endsWith(".json")).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(caseDir, name), "utf8"));
  const results = (data.alignment?.decisions || []).map(decision => fit.forCase(data, decision));
  const payload = { schema_version: "talkeval_context_fit_v1", case_id: data.case_id, algorithm_version: fit.VERSION, configuration: fit.CONFIG, results, interpretation: "Rule candidates for human review; no calibrated accuracy claim." };
  for (const dir of ["dist", "docs"]) {
    const destination = path.join(site, dir, "context-fit");
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, `${data.case_id}.json`), JSON.stringify(payload, null, 2) + "\n");
  }
  summary.cases++; summary.points += results.length;
  for (const result of results) summary.statuses[result.status] = (summary.statuses[result.status] || 0) + 1;
}
console.log(JSON.stringify(summary));
