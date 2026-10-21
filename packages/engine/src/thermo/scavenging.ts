// Two-stroke scavenging helpers. "fresh" = fresh charge fraction by mass in the cylinder.

/**
 * Perfect mixing: inflow mixes instantly; outflow has the cylinder's (mixed) composition.
 * dmIn, dmOut >= 0 kg. Returns the new fresh fraction and the fresh fraction of the outflow.
 */
export function perfectMixingScavenging(mCyl: number, fresh: number, dmIn: number, dmOut: number): { fresh: number; outFresh: number } {
  const mFresh = mCyl * fresh + dmIn;
  const mTot = mCyl + dmIn;
  const f = mTot > 0 ? mFresh / mTot : 0;
  const out = Math.min(dmOut, mTot);
  return { fresh: (mFresh - out * f) / Math.max(mTot - out, 1e-30), outFresh: f };
}

export interface DisplacementState { mFresh: number; mResidual: number }

/**
 * Perfect displacement: fresh charge sits apart from residual; outflow is residual first,
 * fresh charge only leaves (short-circuits) once residual is exhausted.
 */
export function perfectDisplacement(s: DisplacementState, dmIn: number, dmOut: number): { state: DisplacementState; outFresh: number } {
  const mFresh = s.mFresh + dmIn;
  const fromRes = Math.min(dmOut, s.mResidual);
  const fromFresh = Math.min(dmOut - fromRes, mFresh);
  const out = fromRes + fromFresh;
  return {
    state: { mFresh: mFresh - fromFresh, mResidual: s.mResidual - fromRes },
    outFresh: out > 0 ? fromFresh / out : 0,
  };
}
