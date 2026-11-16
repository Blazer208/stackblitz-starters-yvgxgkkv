# Dispatch Pro six-language interface

Implemented for English, Spanish, Urdu, Arabic, Russian and Ukrainian. The Russian and Ukrainian choices are separate. Urdu and Arabic set document direction to RTL. Every published HTML page loads the shared same-origin assets. The selected language persists across pages and tabs.

## Interface behavior

- Native HTML homepage copy replaces the image-only marketing text; the original illustration remains decorative.
- Local catalog contains Spanish, Urdu, Arabic, Russian and Ukrainian columns, in that order. No external translation service receives any account or trip information.
- Original English text is retained for restoration and semantic planning/print checks. Dynamic UI updates, accessible labels, prompts, errors and print controls translate from that source.
- Lottery re-renders dates and schedules on language changes without another request or losing expanded history. Trip date views update independently of stored ISO values.
- Form values, implicit select values, facility names, addresses, trip data, navigation URLs and GPX generation remain intact. Auth, session and server protections remain in place; only the three language assets were added to the public allowlist.

## Verification

Run `npm ci` then `npm test`. Coverage includes all published pages, six-language switching and English restoration, preference persistence, RTL direction, dynamic text, lottery dates/history/request count, and a complete saved-trip build with navigation, print and byte-identical GPX across all six languages. Existing routing, OCR, security, session, stop selection and lottery regressions also run. CI installs the pinned test dependencies.

## Deployment gate

Repository: Blazer208/stackblitz-starters-yvgxgkkv, PR #5. Deploy only after the full suite and PR checks pass. Use the existing Railway service and verify terminal SUCCESS plus live language switching before announcing completion.

Production: https://route-stride-live-production-b6a0.up.railway.app/
Project: 4d353d16-87b8-471c-b516-d114b996c07f
Environment: 9d330f00-ff2e-417f-b9f6-9878e4b44ec6
Service: 4b77674c-778a-4f93-87ce-fa5fbac77dca
