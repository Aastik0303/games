# Route and component map

| Route | Page file | Main components | Needs profile |
|---|---|---|---|
| `/` | `app/page.tsx` | `CommunityPulse`, mode cards | – |
| `/profile` | `app/profile/page.tsx` | `ProfileScreen` → `ProfileForm` (`profile-validation.ts`) | – |
| `/solo` | `app/solo/page.tsx` | `GameLibrary` → `GameCard` | – |
| `/solo/[gameId]` | `app/solo/[gameId]/page.tsx` | `SoloPlayer` → `PuzzleView` → `TextAnswerEngine` / `LogicGridEngine` / `MysteryEngine` | ✓ |
| `/play` | `app/play/page.tsx` | `MatchmakingFlow` (`match-reducer.ts`) | ✓ |
| `/rooms` | `app/rooms/page.tsx` | links to create/join | – |
| `/rooms/new` (`?activity=watch`) | `app/rooms/new/page.tsx` | `CreateRoomForm` | ✓ |
| `/rooms/join` | `app/rooms/join/page.tsx` | `JoinRoomForm` | – (room page gates) |
| `/rooms/[code]` | `app/rooms/[code]/page.tsx` | `RoomScreen` → `Lobby` / `LiveGame` / `WatchStage`, `ChatPanel`, `ParticipantList`, `ModerationDialog`, `ReactionBar` | ✓ |
| `/watch` | `app/watch/page.tsx` | Watch Together intro and content rules | – |
| `/admin` | `app/admin/page.tsx` | `AdminShell` → `AdminOverview`, `MatchesChart` | ✓ + role (server-enforced) |
| `/admin/reports` | `app/admin/reports/page.tsx` | `ReportsQueue` | ✓ + role |
| `/admin/catalog` | `app/admin/catalog/page.tsx` | `CatalogManager` | ✓ + role |
| `/admin/flags` | `app/admin/flags/page.tsx` | `FlagsPanel` | ✓ + role |
| `/guidelines`, `/privacy` | static pages | – | – |
| 404 / errors | `not-found.tsx`, `error.tsx`, `global-error.tsx`, `loading.tsx` | `EmptyState`, `ErrorState` | – |

## Global UI (in `app/layout.tsx`)

- `AppProviders`: `ToastProvider` → `SessionProvider` (load, expiry refresh, "session ended" dialog) → `FlagsProvider` → device-settings effect.
- `AppHeader`: navigation, a **Mock data** badge in mock mode, profile chip, and `SettingsPanel`. The settings panel covers audio, notifications, accessibility, privacy, blocked players, leaving the room, deleting the session, and dev tools in mock mode.
- `NetworkBanner`: shown while the browser is offline. Inside a room, `RoomScreen` has its own reconnecting / connection-lost banner.

## Directory layout

```
src/
  app/                    routes (thin server components)
  components/
    ui/                   design system: Button, Panel, Badge, Field/Input/Select/Segmented/ChipGroup,
                          Switch, Dialog (center + side sheet), Toast, Avatar, Skeleton + state screens
    layout/               header, settings panel, banners, RequireSession, FreshOnNavigate, page header
    providers/            session, flags, app providers
    home/  profile/  games/  matchmaking/  room/  watch/  admin/
  lib/
    api/                  PrismApi contract, types, errors, HTTP adapter, session events
      mock-runtime.ts     dev-only entry, aliased to mock-runtime.disabled.ts in http builds
      mock/               ⚠ mock server, adapter and fixtures (dev only)
    realtime/             typed WS protocol, reconnecting connection, backoff, dedupe
    games/sudoku.ts       public rules for assistive highlighting
    room-code.ts  settings.ts  cues.ts  active-room.ts  use-api-query.ts  config.ts
```
