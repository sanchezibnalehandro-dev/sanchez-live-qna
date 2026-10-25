# SANCHEZ LIVE Q&A — ARCHITECTURE DECISIONS

Updated: 2026-10-25 — added already-shipped Program v2 and Audience Choice boundaries; original 2026-10-06 decisions preserved.

This document records durable decisions that should not be casually changed during cleanup or visual polish.

## 1. Vanilla frontend is intentional

The frontend remains plain HTML, CSS and JavaScript.

Do not introduce React, Vue, state-management frameworks, build systems or heavy dependencies unless a real requirement makes them necessary.

This is a live-event control system. Reliability and fast debugging matter more than architectural fashion.

## 2. Single trusted authenticated operator model

The current backend assumes one trusted authenticated operator.

Authenticated access is intentionally broad enough for the present event workflow.

Do not introduce admin/mod role architecture until there is a real multi-user requirement.

## 3. Room modes are `speaker` and `panel`

`qna_rooms.mode` is the room-level behavior switch.

Supported values:

- `speaker`
- `panel`

Do not create separate applications or duplicate table sets for these modes.

## 4. Panel participants reuse `qna_speakers`

Panel mode does not have a separate participant table.

`qna_speakers` is reused for:

- speaker-mode speakers;
- panel participants.

In panel mode:

- active speaker is not used;
- participant cards are informational/editorial;
- general panel questions use `qna_questions.speaker_id = null`.

Do not encode the moderator as a fake speaker target.

## 5. Selected speaker/participant != live state

In Admin:

- clicking a speaker/participant selects them for editing;
- it must not automatically make a speaker active;
- selecting an event session in the session dropdown only opens that room for viewing/editing;
- it must not automatically make the session current.

Live state changes are always separate explicit actions.

## 6. Active speaker changes are atomic

Frontend call:

`setActiveSpeaker(roomId, speakerId)`

Backend RPC:

`set_active_qna_speaker(p_room_id, p_speaker_id)`

The RPC:

- validates room membership;
- rejects panel rooms;
- keeps `qna_speakers.is_active` and `qna_rooms.active_speaker_id` consistent;
- updates the state in one transaction.

Do not replace this with several client-side updates.

## 7. Speaker ordering is atomic

Frontend call:

`updateSpeakerOrder(roomId, speakers)`

Backend RPC:

`reorder_qna_speakers(p_room_id, p_order)`

The RPC validates the complete requested order and updates the room ordering atomically.

Do not restore per-speaker sequential updates.

## 8. Event rooms are grouped by `event_key`

Multiple rooms may belong to one event.

Event sequence uses `session_order`.

`is_current_session` identifies the live event session.

The event invariant is:

- zero or one current session;
- never more than one current session for one `event_key`.

A partial unique index enforces the single-current rule.

## 9. Viewed event session != current event session

The Admin session selector is a navigation/editing control.

Changing the dropdown:

- opens another room;
- allows preparation/editing;
- does not change live state.

A non-current room shows an explicit `Сделать текущей` action.

This separation is intentional live-event safety.

## 10. Current-session switching is atomic

Frontend call:

`setCurrentEventSession(roomId)`

Backend RPC:

`set_current_event_session(p_room_id)`

The RPC locks the event rooms in a stable order and atomically:

- clears current state from the previous room;
- closes intake in the previous event room;
- makes the selected room current.

Do not reproduce this with independent frontend updates.

## 11. Non-current event rooms cannot accept guest intake

Database invariant:

an event room may have `is_questions_open = true` only when that room is current.

This is enforced by a database constraint, not only by the UI.

Guest question submission also checks current-session state inside `submit_guest_question()`.

The Admin UI must keep intake controls unavailable for non-current event rooms.

## 12. Stable event routing belongs to Guest and Moderator

Admin normally works with a concrete room:

`?room=<slug>`

Guest and Moderator may use a stable event route:

`?event=<event_key>`

The stable route resolves the event's current room and follows current-session changes through Realtime.

QR for an event uses the stable event route.

Direct `?room=` routes remain valid for standalone rooms and targeted inspection.

## 13. Zero current session is valid

The architecture guarantees **at most one** current session, not exactly one.

If an event has zero current sessions:

- Guest/Moderator stable event routes must show a terminal “no current session” state;
- old room data must be cleared from the UI;
- the interface must not show a false live/connected content state.

Do not silently fall back to `sanchez-live`.

## 14. Guest question submission is RPC-only

Guest submission uses:

`submit_guest_question(...)`

The RPC validates:

- room existence;
- session ID;
- text limits;
- room intake;
- event current-session state;
- speaker-mode active speaker;
- panel-mode `speaker_id = null`;
- moderation status.

Do not restore anonymous direct INSERT into `qna_questions`.

## 15. Guest voting is RPC-only

Guest vote add:

`add_vote(p_question_id, p_session_id)`

Guest vote remove:

`remove_vote(p_question_id, p_session_id)`

Direct anonymous INSERT into `qna_question_votes` is intentionally disabled.

`add_vote()` guards:

- session ID validity;
- question existence;
- `open` status;
- current event session;
- duplicate vote;
- self-vote.

`remove_vote()` removes only the matching `(question_id, session_id)` vote.

## 16. Vote counters are maintained atomically

`qna_questions.votes_count` is maintained by trigger function:

`qna_adjust_votes_count()`

Insert increments by `+1`.

Delete decrements by `-1` with floor `0`.

Do not replace this with a `count(*)` recalculation inside concurrent vote triggers.

Before changing vote-counter mechanics, reconcile existing counters against `qna_question_votes`.

## 17. Moderator live mutations are room-aware

Moderator status/pin actions use:

- `moderate_qna_question_status(...)`
- `moderate_qna_question_pin(...)`

These RPCs include the expected room and reject mutations when an event room is no longer current.

This prevents a stale Moderator tab/request from changing the previous live session after an event switch.

Standalone `sanchez-live` remains valid because non-event rooms do not require current-session state.

## 18. Critical UI state waits for backend confirmation

For live-impacting actions:

1. operator clicks;
2. only the relevant control becomes pending/disabled;
3. backend request executes;
4. confirmed backend state is rendered;
5. error rolls back or refreshes from backend state.

Do not present live-state success before backend confirmation.

## 19. Async operations must remain scoped to their originating room

A pending guest submit or vote may complete after the event has switched rooms.

Before `await`, capture the originating:

- room ID;
- room slug;
- session ID;
- local storage set/reference.

A completion for room A must not:

- clear room B's draft;
- write room A's vote/question ID into room B storage;
- show success as if it belonged to room B.

## 20. Realtime readiness requires reconciliation

Realtime is functional infrastructure, not decoration.

Current implementation:

- waits for Postgres Changes readiness;
- performs reconciliation fetch after `SUBSCRIBED`;
- refreshes after recoverable timeout/error;
- scopes subscriptions to room/event.

Do not remove the reconciliation fetch.

## 21. Disposed Realtime callbacks must be inert

When switching rooms:

- mark the old subscription inactive;
- cancel its timers;
- remove the channel;
- ignore late status/change callbacks.

An old room channel must not overwrite the new room's connection state.

## 22. Realtime must not disturb the operator

Incoming questions can arrive while the operator is reading or acting lower in the feed.

Admin preserves the visible position and shows:

`↑ N новых вопросов`

Do not auto-jump the operator to the newest item.

## 23. Editor drafts are protected

Realtime refresh must not overwrite an unsaved speaker/participant draft.

Navigation to another event session is blocked while the editor draft is dirty.

Do not silently discard local draft state.

## 24. Bounded question rendering is intentional

Admin initially renders questions in batches of 50.

This avoids unbounded DOM growth without hiding older questions permanently.

Do not restore a hard hidden cutoff.

## 25. Confirmation patterns are deliberate

Dangerous actions use explicit inline/two-step confirmation:

- logout;
- clear all questions;
- delete speaker/participant.

Do not use browser `confirm()`.

Do not place the destructive confirmation directly under the original cursor in a way that makes a double-click destructive.

## 26. Branding is route-aware and selected before first paint

Default brand is SANCHEZ.

Route-aware Q&A presets currently cover TASIGO ESG, ELINA 28 and KDW in addition to the SANCHEZ default. The standalone `innostage.html` guest page has its own styling and is **not** a Q&A brand preset.

Brand stylesheet selection should occur before first paint to avoid a visible default → event-brand flash.

Do not globally replace the default brand to support one event.

## 27. Database state must be represented in the repository

Production database changes are incomplete until the repository represents them.

Current canonical snapshots:

- `schema.sql`
- `RLS-auth-next.sql`

They must remain aligned with production Q&A behavior.

## 28. Migration history is not currently a complete reconstruction source

The Supabase migration history predates some current event/audit-hardening changes.

Therefore:

- do not infer current production schema solely from `migration list`;
- do not claim a clean rebuild can be produced only by replaying the registered migrations;
- use the current repository schema/RLS snapshots plus production inspection until migration history is repaired.

For future DB work, do not worsen this gap.

## 29. Supabase advisories are review inputs, not commands

Known advisory categories include:

- intentional anonymous/authenticated execution of guarded `SECURITY DEFINER` guest RPCs;
- leaked-password protection disabled;
- unindexed-FK suggestions;
- unused-index observations.

Do not remove functions/indexes or redesign access solely to make an advisory disappear.

Evaluate actual reachability, workload and intent first.

## 30. Reliability beats visual polish

Priority for live surfaces:

1. reliability;
2. predictability;
3. speed;
4. visual polish.

Once mechanics are verified, visual work must not casually reopen backend/realtime architecture.

## 31. Timeweb is the canonical public frontend; Vercel is fallback

The accepted production frontend topology is:

`GitHub main → Timeweb static frontend → existing Supabase BLACK_Q_A`

Canonical public origin:

`https://qna.sanchez-ai.ru`

Vercel remains a fallback deployment of the same repository `main`:

`https://sanchez-live-qna.vercel.app`

This is a frontend-delivery decision only. It does not create a second backend or database.

Do not introduce CDN/proxy/multi-origin orchestration merely because two frontend hosts exist. The fallback is operational redundancy, not a new routing architecture.

## 32. Guest QR uses the canonical public origin, not the Admin host

Admin may be opened from Timeweb, Vercel fallback, preview or localhost. Generated guest QR links must nevertheless use the canonical public origin:

`https://qna.sanchez-ai.ru`

Route shape remains context-dependent:

- standalone room: `/ask.html?room=<slug>`;
- event: `/welcome.html?event=<event_key>`.

This keeps printed/screenshotted QR assets stable and prevents a fallback Admin session from sending guests back to a non-canonical host.

## 33. Program v2 is existing Q&A event-day compatibility, not a new product

The existing `qna_event_program_items` table and guest `program.html` / Admin Program editor are **already shipped**. They are part of the accepted Q&A event-day compatibility layer; do not expand them into generic People, Meetings, Messaging, AI, or a separate Event Companion platform without an explicit new decision.

Each Program item has `kind = session | service`:

- `session` references a Q&A room in the same event;
- `service` has no `room_id` and represents an event program block without live Q&A.

The same event can contain many Program items but at most **one current Program item**, and zero is valid. This marker is `qna_event_program_items.is_current` and is **distinct from** `qna_rooms.is_current_session`. A current `service` item can coexist with zero current Q&A rooms; that is valid and expected.

Do not infer automatic recalculation of all later Program blocks after changing the duration of one speech without checking the specific implementation.

## 34. Program cursor activation is explicit and atomic

The legacy session control's `set_current_event_session(p_room_id)` remains valid; when a Program `session` item is linked to that Q&A room, the backend also aligns the Program current item.

The **existing** Program v2 authenticated RPCs are:

- `set_current_event_program_item(p_program_item_id)`: set Program current; for `session` set linked Q&A room current; for `service` clear Q&A current and close event intake;
- `clear_current_event_program_item(p_event_key)`: clear Program current **and** Q&A current and close intake;
- `save_qna_event_program(...)`, `update_qna_event_program(...)`, and `create_qna_event_program_session(...)`: existing editing/session-creation operations, not implicit live activation.

These transitions are serialized on the backend. Admin selection/editing **must not** activate a session or Program block. Do not make multiple frontend updates instead of the guarded RPCs. An event with zero current Q&A rooms must produce an honest no-current-session guest/moderator state, not a fallback to `sanchez-live`.

## 35. ELINA Audience Choice is bounded and separate from Q&A voting

The ELINA 28 Audience Choice MVP uses `audience_choice_polls` and `audience_choice_votes` plus dedicated guest/operator surfaces in the **same** Supabase `BLACK_Q_A`. It does **not** reuse `qna_question_votes` and does not change the existing Q&A `add_vote()` / `remove_vote()` semantics.

The accepted 2026-10-18 decision: each guest self-declares their team and votes for **one other team**. Both UI and backend reject `own_team = team_no`; duplicate use of the same guest ID is rejected. Self-declaration does not verify team membership or guarantee a global one-person-one-vote rule across devices.

The audience vote's operational status and totals are volatile and belong in production reads; do not freeze a past `OPEN`/`CLOSED` result into this architecture file. Respect the accepted rule documented in `docs/decisions/2026-10-18-audience-choice-no-self-vote.md`.

## 36. INNOSTAGE guest page is not a Q&A event room

The 2026-10-29 INNOSTAGE private evening uses `/innostage.html`: a **standalone static landing page** with program, external Scramble link and Telegram. There is no INNOSTAGE Q&A room or Q&A event key for this page. Do not manufacture a `qna_rooms` row, `event_key`, Moderator Q&A route or Realtime flow for it.

The INNOSTAGE evening on October 29 and the KDW/INNOSTAGE stand activities on October 30 are **distinct**. Current scenario names and routes are catalogued in `docs/EVENT_REGISTRY.md`.

## 37. Durable decisions versus time-sensitive operational facts

Use:

- `docs/EVENT_REGISTRY.md` for **which scenarios** exist and their technical routes;
- `docs/PROJECT_STATE_2026-10-25.md` for the **dated** current operational snapshot and open issues;
- `SUPABASE_RUNTIME_CONTRACT_2026-10-13.md` (ChatGPT Project source) plus live production SQL for the **verified runtime contract**;
- GitHub `main` for code and schema snapshots; Timeweb for the actual canonical deployment; Vercel as fallback.

These decisions do **not** authorize a new database, event framework, production migration, or refactor. The stable Q&A v1 rollback reference is `013f94790b1a7c10b0120c1817d0838db23716f2` on `maintenance/qna-v1`; Git rollback does not roll back Supabase.
