# Truck-routing integration preparation

The server-only Trimble adapter is prepared, with mocked regression tests. It is not connected to the public planner and is not production-ready. The existing public planner still uses its original distance-estimation service. No live Trimble request has been tested.

## Account setup still needed

Register at https://developer.trimblemaps.com/get-an-api-key/na/ . Basic trial access does not establish Trip Management or Places access. Confirm commercial subscription-app licensing, truck-stop coverage, permitted exports, quotas, and prices before purchase.

Set TRIMBLE_API_KEY as a private server environment variable; never place it in HTML or commit it. Configure TRIMBLE_TRUCK_PROFILE only after confirming the named provider profile matches actual truck and trailer dimensions, gross weight, axles, and any hazmat restrictions. No vehicle dimensions are silently assumed.

## Remaining work

- Confirm provider profile and permissions and run live route report tests.
- Normalize provider errors, warnings, mileage, timing, and geometry; reject unusable results.
- Connect truck-stop discovery, company fuel filters, HOS-aware daily balancing, and receiver staging.
- Respect dispatcher waypoints and reject unverified corridors.
- Add authenticated, rate-limited server endpoints before allowing paid API calls.
- Connect the UI, verify PDFs and ordered Garmin exports on multiple new trips.
- Add accounts, billing webhooks, trial entitlement and cancellation handling.

## Verification

Run `node --test tests/truck-routing.test.js`. Missing credentials, invalid stops, provider failures, ordered request payloads, and key isolation are covered. Tests use fake provider responses and establish no real-world routing accuracy.

Reliability fixes also prevent changed endpoints selecting the sample trip, missing stops being omitted from GPX, stale plans remaining after a new generation attempt, and non-public server files being downloaded. Changes have not been deployed.
