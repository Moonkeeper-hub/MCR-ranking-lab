# v0.28.3 — method-specific validation

CSV parsing now validates only the shared structural schema. Rating-specific eligibility is handled inside each engine.

## MCR-2026

The normative default remains strict. If a tournament participant count is absent from the KT_ЧУТ table, that tournament is skipped and the default MCR calculation is explicitly marked **incomplete** instead of aborting every method. The laboratory exposes alternative non-canonical policies: nearest lower row, nearest row, linear interpolation, or explicit skip. These alternatives belong in user presets, not in MCR-2026 default.

## RR

RR is calculated independently from MCR. Tournament eligibility currently enforces the mathematical/data rules available in the browser schema: at least 16 players; from 2018 onward at least 4 hanchans/sessions. Accreditation and open-registration requirements are not enforceable unless those fields are added to CSV, so they remain an input-data responsibility.

## Comparison

A dataset can therefore be valid for RR and only partially compatible with MCR. The comparison page shows a separate validation card for each method, including skipped-tournament counts and grouped reasons.
