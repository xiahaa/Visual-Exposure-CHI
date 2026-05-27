# Internal Pilot Checklist

Use this checklist before running a formal controlled study. The goal is to
confirm that participants understand the interface concepts and that the study
condition boundaries are clean.

## Before The Session

- Launch participant mode: `http://127.0.0.1:5174`
- Use facilitator mode only for setup: `http://127.0.0.1:5174?role=facilitator`
- Confirm C1 hides exposure, preference, planning, and route-editing controls.
- Confirm C2 shows route/UAV/frustum context but hides exposure, preference, planning, and route-editing controls.
- Confirm C3 shows exposure computation, preference drawing, privacy options, and log download.

## Participant Understanding Checks

- Ask whether the participant can explain the difference between camera footprint and estimated visual exposure.
- Ask whether they understand that `Show Preference-Weighted Exposure` reweights concern but does not modify the route.
- Ask whether they understand that `Generate Privacy Options` returns suggested alternatives, not a globally optimal plan.
- Ask whether exposure reduction, route length increase, and coverage loss are understandable trade-off metrics.
- Ask the participant or facilitator to export `Download Study Log` and confirm the JSONL file is saved.

## After The Session

- Check that the exported log includes condition switches, preference drawing, planning preview/apply events, and the active study role.
- Note any terms that participants misread or any controls they expected but could not find.
- Do not proceed to the formal study until the participant can distinguish notice, footprint, exposure, preference-weighted exposure, and suggested alternatives.
