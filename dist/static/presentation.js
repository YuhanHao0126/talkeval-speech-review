// Display-only interpolation. These functions never alter exported forecasts.
export const clamp01 = value => Math.max(0, Math.min(1, value));
export function blendPose(a, b, amount) {
  if (!a) return b;
  if (!b) return a;
  const t = clamp01(amount);
  return b.map((point, j) => point.map((v, axis) => a[j][axis] + (v - a[j][axis]) * t));
}
export function sampleSequence(sequence, index) {
  if (!sequence?.length) return null;
  const at = Math.max(0, Math.min(sequence.length - 1, index));
  const lo = Math.floor(at), hi = Math.ceil(at);
  return lo === hi ? sequence[lo] : blendPose(sequence[lo], sequence[hi], at - lo);
}
export function sampleVisibility(sequence, index) {
  if (!sequence?.length) return null;
  const at = Math.max(0, Math.min(sequence.length - 1, index));
  const lo = sequence[Math.floor(at)], hi = sequence[Math.ceil(at)];
  // A missing joint must not become reliable just because frames are blended.
  return lo.map((value, j) => Math.min(value, hi[j]));
}
export function forecastPose(current, future, phase) {
  return sampleSequence([current, ...future], clamp01(phase) * future.length);
}
export function reviewFrame(dataset, row, phase) {
  const offset = clamp01(phase) * row.positions.length;
  const index = row.anchor + offset;
  return {
    left: sampleSequence(dataset.positions, index),
    right: forecastPose(dataset.positions[row.anchor], row.positions, phase),
    visibility: sampleVisibility(dataset.visibility, index),
    index, seconds: dataset.timestamps[row.anchor] + offset / dataset.fps,
  };
}
