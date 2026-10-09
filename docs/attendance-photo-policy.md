Attendance photo policy, version `attendance-photo-v2`

Cashier and Staff Time In capture a photo from the current camera session. Face detection, model downloads, frontal-pose geometry, confidence, blur and lighting scores do not block attendance. PIN/account validation, location checks, HR restrictions, schedule evidence and duplicate-punch protections remain independent.

The camera preview is mirrored like a selfie. The JPEG saved with attendance keeps the camera’s original orientation. The audit field retains its existing `faceCheck` name for compatibility, but states `captureMode: camera-photo` and `faceDetectionRequired: false`; it makes no face-recognition, face-count or biometric-identity claim.

A decoded frame does not need a second advancing `currentTime` or optional frame callback. Paused playback is retried, with a 2.5-second bound for preview readiness. Missing/ended/disabled camera streams, hidden or closed Clock screens, replaced sessions, malformed photos and reused captures older than 15 seconds still fail clearly. `Restart camera` stops the old camera session and prevents its late completion from replacing the new stream. Staff’s location session is preserved during a camera-only restart.

Time Out continues to use a best-effort photo. Missing camera permission, unavailable playback or absent optional face models do not add a new Time Out gate.

The old exported face-analysis helpers and pinned model files remain for compatibility; they do not participate in the new attendance decision. Actual device camera/GPS behavior still requires tablet testing; mocked regressions verify the capture and restart lifecycle without writing attendance records.
