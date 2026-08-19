# Demo Script

## Perception Calibration Warm-Up

Create the session from the facilitator setup page:

```text
http://127.0.0.1:5174/setup
```

Enter participant ID, session ID, condition, language, and camera profile. Open
or copy the generated `/warmup` link. The generated URL keeps all session
parameters when the participant continues into the study.

1. Start with the resident viewpoint rendered from the Hong Kong OSM mesh and optional synthesized drone sound.
2. Ask the participant to estimate when visual exposure is highest and report confidence.
3. Reveal the synchronized resident and live UAV mesh-camera views.
4. Point out that the sound peak and estimated visual exposure peak occur at different times.
5. Continue to the study. The prediction, confidence, and prediction error are carried into the downloadable study log as `warmup_calibration_complete`.

Use the same warm-up for every experimental condition. The view is synthetic and must not be described as recorded drone footage.

## Condition Assignment

Participant mode keeps condition, language, route, and camera fixed. A complete
formal-study URL has this shape:

```text
http://127.0.0.1:5174/?condition=c3&lang=en&participant_id=P001&session_id=S001&scenario=hong_kong_mong_kok_01&camera=inspection_balanced
```

Use facilitator mode only for setup and internal demonstrations:

```text
http://127.0.0.1:5174/?role=facilitator&condition=c3
```

For C3, the interface enforces this order: flight briefing, automatically
computed baseline evidence, privacy concerns, preference-weighted evidence and
suggested alternatives, then final authorization. Applying an alternative
automatically recomputes the displayed evidence at full camera fidelity.

Exposure scores are relative geometric proxies. They are normalized to the
reference ray grid configured in `backend/config/backend.yaml`, so changing a
camera preset's ray grid changes numerical fidelity rather than the score scale.

## Launch

Start the backend:

```powershell
cd D:\CHI\backend
D:\CHI\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8011
```

Start the frontend:

```powershell
cd D:\CHI\frontend
npm run dev -- --port 5174
```

Open the facilitator session setup:

```text
http://127.0.0.1:5174/setup
```

Use participant mode for study sessions:

```text
http://127.0.0.1:5174
```

Use facilitator mode only for setup, route upload, and manual route debugging:

```text
http://127.0.0.1:5174?role=facilitator
```

## Method Note

The planning feature is a deterministic candidate-based response generator. It
does not claim to find a globally optimal path. It generates route, altitude,
and camera alternatives, evaluates them with the backend exposure engine, and
presents suggested alternatives for the participant or facilitator to inspect.

规划功能是确定性的候选方案生成器，并不声称找到全局最优路径。系统生成航线、高度和相机替代方案，用后端暴露估计引擎评估，再把建议方案呈现给参与者或研究人员选择。

## Guided Walkthrough

Formal sessions show exactly one facilitator-selected language.

1. `C1`: review the flight briefing, then record authorization and confidence.
2. `C2`: review the briefing, inspect route and camera footprint, then decide.
3. `C3`: review the briefing and continue. Baseline exposure computes automatically.
4. Scrub or play the route profile. Confirm that the UAV, frustum, exposure cursor,
   and `Synthetic visibility estimate` camera view move together.
5. Mark `Sensitive` or `Do Not Capture` polygons, or choose `No area concerns`.
6. Confirm concerns. The system computes preference-weighted evidence and
   generates deterministic suggested alternatives.
7. Preview alternatives on the shared comparison scale. Apply one only when the
   participant chooses it; full-fidelity exposure verification is automatic.
8. Record final authorization and confidence. Export JSONL from the final screen
   or facilitator drawer.

Use `?role=facilitator` only for pilot debugging. Route upload, manual waypoints,
camera profiles, layer controls, and log export live in its researcher drawer
and are never shown in the default participant interface.
