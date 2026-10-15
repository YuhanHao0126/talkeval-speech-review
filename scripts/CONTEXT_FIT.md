# Contextual expression review — first baseline

The browser and the offline build use the same deterministic module: `dist/context-fit.js`.
Run `node scripts/build_context_fit.cjs` to derive case artifacts in `dist/context-fit/` and `docs/context-fit/` from the existing timestamped case data. This is data processing, not training or benchmark evaluation.

## Inputs and outputs

- Inputs: aligned transcript span, point candidate, visible face coefficients, comparable hand motion, relative loudness windows, scene-change candidates and optional explicit delivery goal.
- Outputs: possible support, neutral candidate, possible conflict or insufficient evidence, separately for face and gesture. Each result contains text, time range, coverage, event peaks, rationale and limitations.
- Automatic context uses a small lexical rule set for welcome/thanks and emphasis. It is not semantic intent recognition. Quoted/negated cues disable automatic tone attribution. Conflict rules require an explicitly chosen restrained/solemn goal.
- At least three usable samples and 60% time coverage are required. Missing coefficients are unknown. The baseline's thresholds are uncalibrated; no accuracy, probability or causal effectiveness is implied.
- Existing cases remain at their original 1–2 second sampling intervals; precision is declared in each result. Camera changes suppress nearby hand displacement. Legacy motion remains in image coordinates, and its limitation is disclosed.

## Live data

- Camera analysis targets a 0.2 second interval. Actual sample intervals and visibility determine usable coverage.
- Hand movement uses shoulder-centred coordinates, aspect-ratio correction and shoulder-width units per second; occlusion, large scale changes and long gaps reset comparison.
- Full face coefficients are retained in the 120 second analysis window. The saved session keeps whole-session samples at roughly one-second intervals, all per-sentence candidate results, compact audio observations and the video.
- Archived face vectors use `session.visualSampling.coefficient_names` and each sample's `face.blendshape_values`; null means missing, never zero.
- Browser speech boundaries are approximate. No boundary, manual text or ambiguous point matching means insufficient evidence. Timestamp origin is reset when recording starts.
- `segment.contextFitIndex` indexes `session.contextFits`; there is no duplicated nested result in every segment.

## Future extraction / validation

The local Python extractor `src/talkeval/visual.py` now emits v3 observations and all face coefficients, and computes body-relative wrist speed. Its CLI default interval is 0.2 seconds; extraction is therefore slower. Existing public cases were not reprocessed.

Human labels remain separate from machine candidates in annotation exports. Next steps require contextual labels, speaker-disjoint evaluation, neutral/insufficient classes, temporal alignment ablations and confidence calibration. TCN/MulT are research candidates; neither has been trained or claimed as part of this release.

The GitHub site is static. Persistent cloud save/delete and recovery of older recordings still depend on access to the existing backend. This frontend release does not grant that access or replace the backend.
