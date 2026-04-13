import React from 'react';

interface Fiducial {
  label: string;
  coord: [number, number];
}

interface CalibrationOverlayProps {
  fiducials: Fiducial[];
  /** One slot per fiducial; null = not yet placed. */
  calibPixels: ([number, number] | null)[];
  activeCalibIdx: number | null;
  onSelectFiducial: (idx: number) => void;
  onComplete: () => void;
  onCancel: () => void;
}

/** Circle-with-cross crosshair icon for fiducial buttons in the calibration banner. */
function CrosshairIcon({ placed, active, size = 20 }: { placed: boolean; active: boolean; size?: number }) {
  const color = placed ? '#22c55e' : active ? '#60a5fa' : '#6b7280';
  const c = size / 2;
  const r = c * 0.78;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      {/* Outer circle */}
      <circle cx={c} cy={c} r={r} stroke={color} strokeWidth="1.5" />
      {/* Horizontal line spanning diameter */}
      <line x1={c - r} y1={c} x2={c + r} y2={c} stroke={color} strokeWidth="1.5" />
      {/* Vertical line spanning diameter */}
      <line x1={c} y1={c - r} x2={c} y2={c + r} stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export default function CalibrationOverlay({
  fiducials,
  calibPixels,
  activeCalibIdx,
  onSelectFiducial,
  onComplete,
  onCancel,
}: CalibrationOverlayProps) {
  const placedCount = calibPixels.filter((p) => p !== null).length;
  const canComplete = placedCount >= 2;
  const allPlaced = fiducials.length > 0 && placedCount === fiducials.length;
  const activeFiducial = activeCalibIdx !== null ? fiducials[activeCalibIdx] : null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Top banner */}
      <div className="absolute top-0 left-0 right-0 bg-blue-950/90 border-b border-blue-700 px-4 py-2.5 pointer-events-auto select-none">
        <div className="flex items-center gap-4">
          {/* Title + instruction */}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white">Calibration Mode</div>
            {fiducials.length === 0 ? (
              <div className="text-xs text-yellow-300 mt-0.5">
                No Mark commands in this pattern — switch to a pattern with Mark commands.
              </div>
            ) : allPlaced ? (
              <div className="text-xs text-green-300 mt-0.5">
                All fiducials placed — click <span className="font-bold text-white">Complete</span> to apply calibration.
              </div>
            ) : activeFiducial ? (
              <div className="text-xs text-blue-200 mt-0.5">
                Click the image to place{' '}
                <span className="font-bold text-white">{activeFiducial.label}</span>
                <span className="ml-2 font-mono text-blue-300">
                  ({activeFiducial.coord[0].toFixed(3)}, {activeFiducial.coord[1].toFixed(3)})
                </span>
                {calibPixels[activeCalibIdx!] && (
                  <span className="ml-2 text-green-300">✓ placed — click again to reposition</span>
                )}
              </div>
            ) : (
              <div className="text-xs text-blue-200 mt-0.5">
                Select a fiducial below to place it on the image.
              </div>
            )}
          </div>

          {/* Fiducial buttons — one per mark */}
          {fiducials.length > 0 && (
            <div className="flex items-center gap-1.5">
              {fiducials.map((f, i) => {
                const placed = calibPixels[i] !== null;
                const active = activeCalibIdx === i;
                return (
                  <button
                    key={i}
                    onClick={() => onSelectFiducial(i)}
                    title={`${f.label} (${f.coord[0].toFixed(2)}, ${f.coord[1].toFixed(2)})${placed ? ' — placed' : ''}`}
                    className={[
                      'flex flex-col items-center gap-0.5 px-2 py-1 rounded transition-colors',
                      active
                        ? 'bg-blue-600/50 ring-1 ring-blue-400'
                        : placed
                        ? 'hover:bg-green-900/30'
                        : 'hover:bg-blue-900/40',
                    ].join(' ')}
                  >
                    <CrosshairIcon placed={placed} active={active} size={22} />
                    <span
                      className={`text-[9px] font-mono ${
                        placed ? 'text-green-400' : active ? 'text-blue-300' : 'text-gray-500'
                      }`}
                    >
                      {f.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Count + actions */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-blue-300 tabular-nums">
              {placedCount} / {fiducials.length}
            </span>
            {canComplete && (
              <button
                onClick={onComplete}
                className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-xs font-semibold text-white"
              >
                Complete
              </button>
            )}
            <button
              onClick={onCancel}
              className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Hint for crosshair interaction */}
        {placedCount > 0 && (
          <div className="text-[10px] text-blue-400/70 mt-1.5">
            Drag a crosshair to reposition it. Use the amber handles to resize it for visual alignment.
          </div>
        )}
      </div>

      {/* No fiducials fallback */}
      {fiducials.length === 0 && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-yellow-900/90 border border-yellow-600 rounded px-4 py-2 text-xs text-yellow-200 pointer-events-auto">
          No Mark commands found in the current pattern.
          <br />
          Switch to a pattern containing Mark commands to calibrate.
        </div>
      )}
    </div>
  );
}
