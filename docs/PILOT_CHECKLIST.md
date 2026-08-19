# Internal Pilot Checklist

Use this checklist before running a formal controlled study. The goal is to
confirm that participants understand the interface concepts and that the study
condition boundaries are clean.

## Before The Session

- Create the participant link from `http://127.0.0.1:5174/setup` and confirm it
  includes condition, language, participant ID, session ID, scenario, and camera.
- Launch the assigned participant condition with `?condition=c1`,
  `?condition=c2`, or `?condition=c3`. Participant mode must not expose the
  condition selector or internal C1/C2/C3 label.
- Use facilitator mode only for setup:
  `http://127.0.0.1:5174/?role=facilitator&condition=c3`.
- Confirm C1 hides exposure, preference, planning, and route-editing controls.
- Confirm C2 shows route/UAV/frustum context but hides exposure, preference, planning, and route-editing controls.
- Confirm C3 shows baseline exposure computation, preference drawing,
  preference-weighted evidence, privacy options, and the final decision task.
- Confirm the session uses only its assigned language and that participant mode
  exposes no language, condition, route, or camera configuration controls.
- At 1280x720 and 390x844, confirm the current task, map, timeline, and evidence
  drawer do not overlap or clip their controls.

## Participant Understanding Checks

- Ask whether the participant can explain the difference between camera footprint and estimated visual exposure.
- Ask whether they understand that `Show Preference-Weighted Exposure` reweights concern but does not modify the route.
- Ask whether they understand that `Generate Privacy Options` returns suggested alternatives, not a globally optimal plan.
- Ask whether exposure reduction, route length increase, and coverage loss are understandable trade-off metrics.
- Ask whether the route exposure profile, selected UAV pose, frustum, and
  synthetic camera view are understood as synchronized estimates.
- Confirm the camera viewport label `Synthetic visibility estimate` is noticed
  and is not interpreted as recorded footage.
- Ask the participant to record a final authorization decision and confidence.
- Ask the facilitator to export `Download Study Log` and confirm the JSONL file is saved.

## After The Session

- Check that the exported log includes preference drawing, planning
  preview/apply events, pose/surface inspection, final decision, confidence,
  active step, step duration, participant/session IDs, language, and role.
- Refresh once during an internal pilot and confirm the same session's JSONL
  events are restored without importing a different session's warm-up response.
- Confirm camera presets with different ray grids remain on the configured
  reference exposure scale; ray density should affect fidelity, not score scale.
- Note any terms that participants misread or any controls they expected but could not find.
- Do not proceed to the formal study until the participant can distinguish notice, footprint, exposure, preference-weighted exposure, and suggested alternatives.
