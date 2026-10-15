# Contextual expression review — source-aligned revision

The browser and offline artifact builder share `dist/context-fit.js` (v2).
Run `node scripts/build_context_fit.cjs` after updating case observations.

## Source extraction

All 10 public cases and their 40 aligned core-point windows have been re-extracted from the original local videos at approximately 0.2-second intervals. This is inference on real footage, not synthetic data or an accuracy benchmark. Other timestamps retain the older overview observations.

The Python implementation is `src/talkeval/visual_refinement.py` in the local algorithm project. Run `python src/talkeval/visual_refinement.py --demo <demo-root>`; optional `--case` and `--beat` select a window. It checks the existing analysis permission record, resolves incoming video pointers and uses the original resolution. `visual.py` delegates future full-video analysis to the same detector (observations v4).

- MediaPipe 0.10.21 / Pose Full: independent IMAGE detection; full-frame, tracked-region and fallback tiles. Pose geometry rejects collapsed or horizontal diagram skeletons. These heuristics are intended for upright speaking footage and remain imperfect.
- Head crops at several scales recover small faces. Full-frame faces must agree with the detected speaker head; unassociated faces are not counted as speaker evidence.
- All returned face coefficients are retained. Wrists are compared in shoulder-width coordinates per second. Body-relative margins classify hand height. Camera-change candidates, missing tracking, scale jumps and long gaps reset movement comparison.
- `visual_refinement` stores exact video timestamps, frame size, source-video SHA-256, per-frame detector results, body landmarks and errors. Each window includes its first/middle/last source frame plus the detected person crop, when available. These thumbnails are original pixels, not generated illustrations.
- A failed detection is an unknown model result. It is never proof of an unclear face, occlusion or hands leaving the image.

## Context candidates and UI

Each card shows the aligned sentence, source-frame links, measured observations, candidate interpretation and evidence times. The image links seek the corresponding video timestamp. Reports include the measured observations as well as the interpretation.

Automatic context is a small lexical rule set for causes, contrasts, examples, questions, enumeration, emphasis and welcome/thanks. It is not a trained semantic-understanding model. Hand events and relative-loudness windows can suggest support; temporal co-occurrence is not precise word-level synchronization. Explicit solemn delivery goals can suggest conflict. Lack of conflict alone does not establish that a gesture is optimal.

At least three usable samples and 60% time coverage are required for a whole-window channel candidate. Lower coverage with usable samples is reported as partial. Face and gesture channels are gated separately. Thresholds remain uncalibrated; neither probabilities nor accuracy claims are reported. Small source faces may produce unstable coefficients even when detected.

## Live and saved sessions

The live camera uses independent IMAGE detection with Pose Full and person/head retry crops, targeting a 0.2-second interval; actual timing controls coverage. Missing observations do not penalize the speaker. The same context engine is used for live sentences and saved results. Browser ASR boundaries are approximate; manual text without reliable timing cannot be evaluated against the footage. Ambiguous point matching does not prevent evaluating a reliable current sentence, but its point association remains unconfirmed.

All face coefficients remain in the 120-second live window. Saved sessions retain approximately one-second samples, per-sentence results, audio observations and video according to the existing save/discard flow. Existing archived results are not silently presented as newly recomputed results. Their version is visible in the card.

Human labels remain separate from machine candidates. Contextual training labels, speaker-disjoint evaluation and confidence calibration are still future work; no TCN/MulT training is claimed.

GitHub Pages is static. Existing cloud persistence and deletion still depend on access to the existing backend.

Reference APIs: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/python and https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python
