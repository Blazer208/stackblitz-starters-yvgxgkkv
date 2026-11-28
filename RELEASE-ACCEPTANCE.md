# Route Stride controlled client testing — release gate

Status: HOLD broader rollout. Existing invitation-only testers may continue. Do not treat successful Railway deployment or regression tests as release approval.

## Required acceptance trip: 126746

- Pickup / yard: 3916 W 65th S, Idaho Falls, ID 83402
- Delivery: 9950 S Reinhart Dr, Oak Creek, WI 53154
- Planning speed: 55 mph; available cycle: 52.5 hours; daily driving limit: 9 hours (also check 8 and 11 hours from earlier reproduction attempts).
- Truck profile: 75 ft combination, 102 in width, 162 in height, 80,000 lb gross, 53 ft trailer.
- Use a valid departure/appointment pair for a new test or retain the historical date for a clearly labeled historical replay.
- Company route: US-20 / ID-87 / MT-87 / US-287 / MT-84 / US-191 / I-90 / I-94 / I-694 / I-94 / I-41 / WI-100, subject to dispatcher confirmation. Remove duplicated route text only if confirmed.

## Required evidence before lifting the hold

- [ ] Authenticated production planner generates a complete trip from the actual pickup to the actual delivery, with no stop-selection error.
- [ ] Fuel/break locations and overnight stops are real, ordered, and reachable within the entered limits; review truck access and parking independently.
- [ ] Entered driving and cycle limits are preserved; no fabricated stops or route mileage.
- [ ] Driver can change a stop after generation and recalculate successfully.
- [ ] PDF preview and saved PDF contain all days and stop addresses.
- [ ] Apple Maps, Google Maps and QR navigation targets match every intended stop.
- [ ] Garmin GPX downloads, parses, and includes ordered locations.
- [ ] Latest application commit passes automated regression and planner/PDF workflows, and production deployment succeeds.
- [ ] Owner reviews live acceptance evidence and authorizes broader rollout.

Current evidence: commit c8d3b29 deployed successfully and both automated workflows passed. Exact authenticated live Trip 126746 acceptance and export checks are still pending. Road-network estimates are not certified commercial-truck routing. Do not mark these pending items passed without actual evidence.
