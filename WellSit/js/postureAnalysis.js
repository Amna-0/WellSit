// Pure geometry helpers to turn MediaPipe Pose landmarks into ergonomic posture metrics.
// Landmark indices follow the standard 33-point MediaPipe Pose topology.
export const LM = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
};

// Default ergonomic thresholds in degrees. Loosely based on commonly cited
// ergonomic guidance that forward head tilt beyond ~15-20 degrees from
// vertical, or a visibly uneven shoulder line, indicates unhealthy sitting posture.
export const DEFAULT_THRESHOLDS = {
  neck: 20,
  shoulder: 8,
  spine: 25,
};

const VISIBILITY_MIN = 0.5;

function angleFromVertical(dx, dy) {
  // Angle (degrees) between vector (dx, dy) and the upward vertical axis.
  // Image coordinates have y increasing downward, so "up" is -y.
  return Math.atan2(Math.abs(dx), Math.abs(dy) || 1e-6) * (180 / Math.PI);
}

function isVisible(point) {
  return !!point && (point.visibility === undefined || point.visibility > VISIBILITY_MIN);
}

/**
 * Analyze a single frame's pose landmarks and return posture metrics.
 * Returns null if the essential upper-body landmarks (nose + both shoulders)
 * are not confidently detected.
 */
export function analyzePosture(landmarks, thresholds = DEFAULT_THRESHOLDS) {
  if (!landmarks || landmarks.length === 0) return null;

  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lEar = landmarks[LM.LEFT_EAR];
  const rEar = landmarks[LM.RIGHT_EAR];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  if (!isVisible(nose) || !isVisible(lShoulder) || !isVisible(rShoulder)) {
    return null;
  }

  const midShoulder = {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2,
  };

  const earsVisible = isVisible(lEar) && isVisible(rEar);
  const headPoint = earsVisible
    ? { x: (lEar.x + rEar.x) / 2, y: (lEar.y + rEar.y) / 2 }
    : nose;

  // Forward head posture: deviation of the shoulder->head line from vertical.
  const neckAngle = angleFromVertical(
    headPoint.x - midShoulder.x,
    midShoulder.y - headPoint.y
  );

  // Shoulder balance: deviation of the shoulder line from horizontal.
  const shoulderDx = rShoulder.x - lShoulder.x;
  const shoulderDy = rShoulder.y - lShoulder.y;
  const shoulderTilt =
    Math.atan2(Math.abs(shoulderDy), Math.abs(shoulderDx) || 1e-6) * (180 / Math.PI);

  // Spine curvature approximation: only available when hips are in frame.
  let spineAngle = null;
  let midHip = null;
  if (isVisible(lHip) && isVisible(rHip)) {
    midHip = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };
    spineAngle = angleFromVertical(midShoulder.x - midHip.x, midHip.y - midShoulder.y);
  }

  const flags = {
    neck: neckAngle > thresholds.neck,
    shoulder: shoulderTilt > thresholds.shoulder,
    spine: spineAngle !== null && spineAngle > thresholds.spine,
  };

  const isPoor = flags.neck || flags.shoulder || flags.spine;

  return {
    neckAngle,
    shoulderTilt,
    spineAngle,
    isPoor,
    flags,
    midShoulder,
    midHip,
    headPoint,
  };
}

/**
 * Rolling majority-vote smoother to avoid flickering between good/poor on
 * single noisy frames.
 */
export class StatusSmoother {
  constructor(windowSize = 8) {
    this.windowSize = windowSize;
    this.buffer = [];
  }

  push(isPoor) {
    this.buffer.push(isPoor);
    if (this.buffer.length > this.windowSize) this.buffer.shift();
  }

  reset() {
    this.buffer = [];
  }

  get status() {
    if (this.buffer.length === 0) return "none";
    const poorCount = this.buffer.filter(Boolean).length;
    return poorCount / this.buffer.length > 0.5 ? "poor" : "good";
  }
}
