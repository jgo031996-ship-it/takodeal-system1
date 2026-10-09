# Local attendance camera files

Pinned face-api.js 0.22.2, upstream commit `8609b25a15f417398a4d2b95dc91985cd1e0c0c3`:
https://github.com/justadudewhohacks/face-api.js/tree/8609b25a15f417398a4d2b95dc91985cd1e0c0c3

The MIT license is included in `face-api.LICENSE`. Only the tiny face detector and tiny 68-point landmark models are used. No recognition embeddings are generated or enrolled. These files are served locally and included in the app's offline shell; model initialization still fails closed for Time In if they cannot load.

SHA-256:

| File | SHA-256 |
| --- | --- |
| face-api.min.js | 5d66ec95338d7fcc365ce15481b8599baf4b6e22c9a624b76d4ca821a669a659 |
| face-models/tiny_face_detector_model-weights_manifest.json | 14c60659a31b6b7b1320077171b8f8adcb24ef0e62dde62ce603bcb49a1b49b5 |
| face-models/tiny_face_detector_model-shard1 | b7503ce7df31039b1c43316a9b865cab6a70dd748cc602d3fa28b551503c3871 |
| face-models/face_landmark_68_tiny_model-weights_manifest.json | 3c63b8984302c187b218d9ef5aa149ed8c2c7fa3fe54db078614692bc48d153c |
| face-models/face_landmark_68_tiny_model-shard1 | b98e9f2f7da76f8a6dda9741a36ed485b224b889d552de2b2c1bb16217f67bfc |

The check requires one centered frontal face, usable light and image sharpness, and a fresh active video frame. It is a photo-quality check, not identity recognition or proof of liveness. PIN and existing authenticated session checks remain responsible for identity. Real device validation should include frontal, turned, poorly lit, blurred and two-person camera views.
