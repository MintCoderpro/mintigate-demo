// Synthetic fixture for the Mintigate demo. Written for this kit, not taken from any real site.
// It stands for a sensitive interaction module that the task declares as protected.
// The demo never runs this file; it only reads it and computes its hash.

export const STEPS = Object.freeze([
  { id: "intro", position: 25 },
  { id: "middle", position: 50 },
  { id: "end", position: 100 },
]);

export function stepFor(position) {
  return STEPS.find((step) => position <= step.position) ?? STEPS[STEPS.length - 1];
}
