// Deterministic sine and cosine.
//
// Math.sin, Math.cos and Math.atan2 are not specified to the last bit: engines,
// and even versions of one engine, round them differently (Node 22 and current
// Chrome disagree on the ring mode's angles). A bouncing-ball run is chaotic,
// so one differing bit becomes a different winner within seconds. These use
// only + − × ÷ and Math.round, which IEEE 754 defines exactly, so a seed
// replays bit for bit in every browser and in Node.

const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

// Taylor series on |x| ≤ π/4. The first dropped term is below 5e-17, under
// one ulp of the result, so these are as accurate as Math.sin where it matters.
function sinPoly(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

function cosPoly(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 * (-1 / 2 + x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200)))))))
  );
}

/** Splits x into a quarter turn q (0..3) and a remainder in [-π/4, π/4]. */
function reduce(x: number): [q: number, y: number] {
  const r = x - TAU * Math.round(x / TAU);
  const q = Math.round(r / HALF_PI);
  return [(q + 4) % 4, r - q * HALF_PI];
}

export function dsin(x: number): number {
  const [q, y] = reduce(x);
  return q === 0 ? sinPoly(y) : q === 1 ? cosPoly(y) : q === 2 ? -sinPoly(y) : -cosPoly(y);
}

export function dcos(x: number): number {
  const [q, y] = reduce(x);
  return q === 0 ? cosPoly(y) : q === 1 ? -sinPoly(y) : q === 2 ? -cosPoly(y) : sinPoly(y);
}
