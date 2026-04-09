/**
 * Similarity (uniform scale + rotation + translation) affine transform.
 *
 *   worldX = a * px - b * py + tx
 *   worldY = b * px + a * py + ty
 *
 * where  a = scale * cos(θ),  b = scale * sin(θ).
 */
export interface AffineTransform {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export interface CalibPoint {
  imagePixel: [number, number];
  programCoord: [number, number];
}

/** Apply the transform to an image-pixel point, returning program (world) coords. */
export function applyAffine(t: AffineTransform, px: number, py: number): [number, number] {
  return [t.a * px - t.b * py + t.tx, t.b * px + t.a * py + t.ty];
}

/**
 * Compute a similarity affine transform from ≥2 calibration point pairs.
 * For exactly 2 points the system is solved exactly; for 3+ it is least-squares.
 */
export function computeAffine(points: CalibPoint[]): AffineTransform {
  if (points.length < 2) throw new Error('At least 2 calibration points required');

  // Build a 2n×4 matrix M and vector v such that M [a b tx ty]^T ≈ v.
  // For each pair (px,py) → (wx,wy):
  //   row 2i  : [px, -py, 1, 0]  → wx
  //   row 2i+1: [py,  px, 0, 1]  → wy
  const rows = points.length * 2;
  const M: number[][] = [];
  const v: number[] = [];

  for (const { imagePixel: [px, py], programCoord: [wx, wy] } of points) {
    M.push([px, -py, 1, 0]); v.push(wx);
    M.push([py,  px, 0, 1]); v.push(wy);
  }

  // Normal equations: (M^T M) x = M^T v  →  4×4 system
  const MtM: number[][] = Array.from({ length: 4 }, () => new Array(4).fill(0));
  const Mtv: number[] = new Array(4).fill(0);

  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 4; i++) {
      Mtv[i] += M[r][i] * v[r];
      for (let j = 0; j < 4; j++) MtM[i][j] += M[r][i] * M[r][j];
    }
  }

  const [a, b, tx, ty] = solve4x4(MtM, Mtv);
  return { a, b, tx, ty };
}

/** 4×4 Gaussian elimination with partial pivoting. */
function solve4x4(A: number[][], b: number[]): [number, number, number, number] {
  const n = 4;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    if (Math.abs(aug[col][col]) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / aug[col][col];
      for (let k = col; k <= n; k++) aug[row][k] -= f * aug[col][k];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] /= aug[i][i];
  }

  return x as [number, number, number, number];
}
