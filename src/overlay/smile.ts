import { _layout } from "blobatar/internal";

export interface Smile {
  /** In the avatar's own 100 by 100 frame. */
  path: string;
  /** The colour the library draws this avatar's eyes in. */
  ink: string;
}

/**
 * A smile for the avatar drawn from a name, laid out from where the library puts its face: centred
 * between the eyes, halfway down between them and the bottom of the face, no wider than the face is
 * at that height, in the eye colour the library computed for the name. The pose the library calls
 * happy is two flat bars at the size the overlay draws, which read as a straight face on their own.
 *
 * `_layout` is the library's own and underscored: its shape changes only with a major version,
 * which the dependency's range does not cross. Anything it does not return in the shape expected
 * gives no smile, and the pose, the hop and the tick say the rest.
 */
export function smileOf(name: string): Smile | null {
  try {
    const { eyes, face, palette } = _layout(name);
    if (!eyes?.length || !face || !palette?.eye) return null;
    const middle = eyes.reduce((sum, eye) => sum + eye.cx, 0) / eyes.length;
    const eyeBottom = Math.max(...eyes.map((eye) => eye.cy + eye.ry));
    const bottom = face.cy + face.ry;
    const y = eyeBottom + (bottom - eyeBottom) * 0.5;
    const across = (y - face.cy) / face.ry;
    const room = face.rx * Math.sqrt(Math.max(0, 1 - across * across));
    const spread = Math.max(...eyes.map((eye) => eye.cx)) - Math.min(...eyes.map((eye) => eye.cx));
    const half = Math.min(Math.max(spread * 0.4, 4), room * 0.6, 10);
    if (![middle, y, half].every(Number.isFinite) || half <= 0) return null;
    const f = (n: number) => n.toFixed(2);
    return {
      path: `M${f(middle - half)} ${f(y)} Q${f(middle)} ${f(y + half * 0.9)} ${f(middle + half)} ${f(y)}`,
      ink: palette.eye,
    };
  } catch {
    return null;
  }
}
