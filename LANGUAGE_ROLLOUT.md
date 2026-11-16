# Dispatch Pro language rollout — development checkpoint

Byron authorized adding the same English pages in Spanish, Urdu, Arabic,
Russian, and Ukrainian. English stays available. Russian and Ukrainian must
be separate choices. Arabic and Urdu need right-to-left layouts. He asked to
be updated when this is working; do not describe this checkpoint as deployed.

## Written so far

- `i18n.js`: shared six-language controls, local preference persistence,
  translation of text and accessible labels, dynamic DOM observation,
  original-English restoration, input/address exclusions and pre-print refresh.
- `i18n.css`: selector, right-to-left support and a native translated homepage
  layout. The existing homepage hero contains English text baked into an image.
- `i18n-messages.json`: initial five-language translations for common controls,
  planner fields, freight links and lottery labels. Columns are strictly
  `[Spanish, Urdu, Arabic, Russian, Ukrainian]`.
- The new resources are NOT yet injected into pages or the server allowlist.
  The live website continues to use the tested English interface.

## Finish the authorized feature

1. Read the current repository head and preserve unrelated changes. Complete
   translations for all relevant visible page text, labels, accessible names,
   guidance, status/error messages and generated plan/print text. Do not claim
   full coverage when long text is still English. Prioritize the homepage,
   planner, route import, freight links, sign-in/signup and lottery; continue
   through the other published app pages. Use correct native language text.
2. Wire the shared scripts/styles into HTML pages and expose only their public
   assets in index.js. Keep the server module and account storage private.
   Do not weaken sign-in, CSP or other access controls.
3. Provide an actual translated HTML homepage hero for non-English choices;
   switching a language cannot translate the words baked into the existing
   image. The CSS has hooks for `.translated-home` and
   `[data-localized-home-art]`; reuse the illustration as appropriate.
4. Localize dynamically refreshed lottery labels and dates on language changes
   without another source request or resetting open history lists. Preserve
   exact draw numbers, amounts and source links. Preserve all addresses,
   entered trip values, identifiers, navigation URLs and GPX content.
5. Test all six choices, English restoration, saved preference across pages,
   Arabic/Urdu direction, dynamic updates, safe select option values and
   unchanged trip entries. Run all existing tests (baseline: 51) and add
   meaningful language-switch tests. Review the MutationObserver for loops or
   behavior changes before integrating it.
6. Commit the completed feature to main only after checks pass, then deploy the
   existing Railway service and verify the actual live pages. Do not call a
   queued build deployed. If pushing main does not start a build, reconnect the
   existing service to the same repository and main branch with Railway's
   connect-service-source operation. Do not create a replacement service.
7. Tell Byron the verified outcome and any real remaining limitations. Do not
   claim that a status check alone finished implementation.

## Existing production context

- Repository: `Blazer208/stackblitz-starters-yvgxgkkv`
- App: `https://route-stride-live-production-b6a0.up.railway.app/`
- Railway project: `4d353d16-87b8-471c-b516-d114b996c07f`
- Production environment: `9d330f00-ff2e-417f-b9f6-9878e4b44ec6`
- Service: `4b77674c-778a-4f93-87ce-fa5fbac77dca`
- Last tested English release: `8f22f7adabf149784ae9fa004faa4830c6b5bdab`

Only public interface strings belong in translation resources. Do not send
account information, trip addresses, paperwork or driver details to an external
translation service. Browser sign-in, when needed, must use the secure sign-in
flow; never ask for a password in chat.
