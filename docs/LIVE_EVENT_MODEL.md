# SANCHEZ LIVE Q&A — LIVE EVENT MODEL

Updated: 2026-10-25 — clarified against existing Program v2 runtime (13.10 contract); original session-control safety model preserved.

## Why this document exists

The system supports a full event made of several Q&A sessions.

This document defines the operator-facing model so future changes do not accidentally collapse:

- “which session I am editing”
- and
- “which session is live”

into the same action.

## Core concepts

### Room

A `qna_rooms` row.

A room contains its own:

- title;
- moderator metadata;
- participants/speakers;
- questions;
- moderation setting;
- intake setting;
- live mode.

A room may be standalone or belong to an event.

### Event

A group of rooms sharing the same `event_key`.

Example technical key:

`tasigo-esg-2026`

### Selected/viewed session

The event room currently open in Admin.

This answers:

> Which session am I editing right now?

It does **not** mean that room is live.

### Current session

The event room whose:

`is_current_session = true`

This answers:

> Which session is currently in the live guest/moderator flow?

At most one room may be current for an event.

Zero current rooms is allowed.

### Current Program item (Program v2)

A row in `qna_event_program_items` with `is_current = true`.

This is **not** the same field as `qna_rooms.is_current_session`.

- `kind = session` references a Q&A room, and activating this Program item makes that room the current Q&A session.
- `kind = service` is an event block without a Q&A room. Activating it clears the event's current Q&A session and closes event-room intake.
- A Program event may have **zero** current Program items. Zero current Q&A sessions is also valid.

Program v2 is an existing event-day Q&A compatibility layer, **not** a general event-platform design or a separate backend.

## Admin session control

The Admin event-session control has two separate actions.

### Dropdown

The dropdown:

- navigates to another event room;
- opens it for editing/preparation;
- does not change the live event.

This allows future sessions to be prepared safely.

### `Сделать текущей`

This is the explicit live activation action.

It calls:

`set_current_event_session()`

This action changes which Q&A session is current from the session control.

**Program v2 also has explicit authenticated live-cursor actions:** `set_current_event_program_item()` (select a `session` or `service` item) and `clear_current_event_program_item()` (clear both Program and Q&A current state, and close event intake). Selecting a Program item *for editing* is not activation.

The backend's `set_current_event_session()` also synchronizes the Program current marker when the selected Q&A room has a linked `session` Program item. Both live-cursor paths are explicit; neither is a side effect of opening the dropdown.

## Why activation is explicit

A live operator can easily mis-click a dropdown.

Changing the live event merely by selecting an option is too risky.

Therefore:

- navigation is low-risk;
- activation is separate;
- backend confirmation is required before UI reports success.

## What happens when session B becomes current

Assume:

- A is current;
- B is being prepared.

Operator opens B through the dropdown.

At this point:

- B is visible/editable in Admin;
- B is still “not live”;
- B cannot open intake;
- Guest/Moderator stable event links still show A.

Operator presses:

`Сделать текущей`

Backend atomically:

1. locks the event rooms;
2. removes current state from A;
3. closes intake in A;
4. marks B current.

Then:

- Admin refreshes B current state;
- Guest stable event route moves to B;
- Moderator stable event route moves to B;
- Realtime subscriptions move to the new room;
- A remains historical/non-current.

## Program v2 service transitions

When the authenticated operator explicitly selects a current `service` item through `set_current_event_program_item()`:

1. the selected Program item becomes current and the previous Program current item is cleared;
2. every Q&A room in that event is made non-current and its intake is closed;
3. Guest/Moderator event Q&A views show the appropriate no-current-session state; they **must not** fall back to `sanchez-live`.

A later explicit `session` Program activation makes its linked Q&A room current; **opening intake remains a separate operator action**. `clear_current_event_program_item()` clears both current markers and closes intake. These are serialized backend actions, not client-side multi-update sequences.

## Intake after activation

Making B current does **not** automatically imply that questions must be open.

Intake remains an independent operator control.

Recommended event flow:

1. make B current;
2. visually confirm B is current;
3. verify moderator/participants;
4. enable question intake when ready.

This avoids opening questions before the stage is ready.

## Stable event links

For an event:

Guest event entry / printed QR:

`welcome.html?event=<event_key>`

Guest Q&A view within the event:

`ask.html?event=<event_key>`

Moderator:

`mod-auth.html?event=<event_key>`

These links are stable for the whole event. Guest QR links always use the canonical origin `https://qna.sanchez-ai.ru`, even when Admin is open on Vercel fallback or localhost.

They resolve whichever room is current.

This means:

- QR does not need to change for every session;
- moderator link does not need to change for every session;
- guests already on the page follow session changes through Realtime.

## Admin links

Admin normally uses a concrete room:

`admin-auth.html?room=<slug>`

This is intentional.

Admin needs to inspect and prepare a specific room, including future non-current rooms.

## Direct room links

Direct `?room=` links remain useful for:

- standalone `sanchez-live`;
- targeted room inspection;
- event-room editing.

A direct non-current event room must not behave as live:

- guest intake is closed;
- moderator live mutations are rejected/read-only by backend safeguards;
- UI should clearly represent non-live state.

## Zero current session

An event may temporarily have no current session.

Stable Guest/Moderator event routes must then show a terminal state such as:

- session not selected;
- no active session.

They must not:

- silently fall back to `sanchez-live`;
- keep showing stale content from the previous room;
- claim intake is open;
- show a false live state.

## Invalid event

An invalid `event_key` is different from an existing event with zero current session.

UI should report:

- event not found

rather than:

- session not yet selected.

## Panel mode

Panel participants use `qna_speakers`.

Guest behavior:

- no participant target selector;
- question is general to moderator/session;
- `speaker_id = null`.

Admin behavior:

- participants can be edited and reordered;
- no active-speaker action;
- participant selection is editing only.

Moderator behavior:

- sees the whole room question flow;
- current event session is required for live mutation.

## Speaker mode

Speaker mode keeps the existing model:

- one active speaker maximum;
- active speaker is explicit;
- guest question targets current active speaker;
- selected speaker in Admin is not automatically active.

## Realtime session following

Guest and Moderator use two subscription scopes:

- event-level subscription for current-session change;
- room-level subscription for room/questions/speakers.

After a current-session switch:

1. event change is observed;
2. route resolves new current room;
3. old room subscription is disposed;
4. new room subscription is created;
5. reconciliation fetch refreshes actual state.

Old room callbacks must not overwrite new room UI.

## Pending guest action during switch

A guest action belongs to the room where it started.

If a submit/vote starts in A and the event switches to B before the HTTP response returns:

- the backend result still belongs to A;
- A storage state is updated;
- B draft/storage must not be modified;
- B UI must not be cleared by A completion.

## Pending moderator action during switch

Moderator live mutations include expected room/current-session validation.

If A stops being current before the mutation completes:

- backend rejects the stale action;
- historical A is not silently modified as if it were current;
- Moderator refreshes to the actual live room.

## Question/vote boundaries

Non-current event rooms must reject:

- guest question submit;
- guest vote add;
- opening question intake.

Vote removal remains session-scoped so a guest can undo their own prior vote safely.

## Preparing future sessions

Safe preparation flow:

1. Admin opens future room from session dropdown;
2. edits participants/moderator/content;
3. confirms room remains “not live”;
4. intake stays unavailable;
5. when the program reaches that block, press `Сделать текущей`;
6. confirm current status;
7. enable intake when ready.

This is the intended event-day workflow.

## Recommended transition checklist

For every A → B transition:

- B content/participants verified;
- no unsaved Admin editor draft;
- press `Сделать текущей`;
- confirm B shows current;
- confirm previous A intake closed;
- confirm Moderator moved to B;
- confirm Guest moved to B;
- confirm Realtime reconnected;
- enable B intake only when stage is ready.

## Failure handling principle

When state is ambiguous:

- prefer closed intake;
- prefer explicit “not live” / “no current session” state;
- prefer backend rejection over optimistic UI success;
- never guess the current room on behalf of the operator.

Reliability and predictability are more important than removing one click.
## Dedicated event extensions remain bounded

Audience Choice for ELINA 28 is separate from Q&A question votes. Its `audience_choice_polls` and `audience_choice_votes` tables exist in the **same** production Supabase. The accepted 2026-10-18 rule rejects votes for the guest's self-declared own team; that self-declaration is not proof of actual identity. Do not confuse it with `add_vote()` / `remove_vote()` for audience Q&A questions.

INNOSTAGE's private evening on 2026-10-29 uses `/innostage.html` as a static guest landing page (program, Scramble link, Telegram), **not** a Q&A room or Q&A `event_key`. Its evening is distinct from stand activities on 2026-10-30. Do not create a Q&A room to represent the static landing page.

For specific event keys, dates and routes, see `docs/EVENT_REGISTRY.md`. For verified SQL/RPC behavior, use `SUPABASE_RUNTIME_CONTRACT_2026-10-13.md` and the production runtime. Do not store current session flags or live intake status as durable rules in this document.
