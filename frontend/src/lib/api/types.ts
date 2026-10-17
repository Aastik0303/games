/**
 * Typed API contract shared by the HTTP adapter and the mock adapter.
 *
 * The backend is the source of truth for every value here. In particular:
 * - puzzle payloads never include answers; grading happens server-side,
 * - scores, room membership and host status are always server-derived,
 * - `isMinor` is derived by the server from the age band, never set by the client.
 */

export type ISODateString = string;
export type UserId = string;
export type RoomId = string;
export type GameId = string;

/* ----------------------------------------------------------------------------
 * Profile & session
 * ------------------------------------------------------------------------- */

/** Age band, not birth date. Under-13 is handled by the form and never sent. */
export const AGE_BANDS = ["13_15", "16_17", "18_24", "25_34", "35_49", "50_plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "hi", label: "हिन्दी" },
  { code: "pt", label: "Português" },
  { code: "ja", label: "日本語" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const INTERESTS = [
  "wordplay",
  "riddles",
  "logic",
  "mysteries",
  "trivia",
  "films",
  "anime",
  "music",
  "science",
  "history",
] as const;
export type Interest = (typeof INTERESTS)[number];

export interface AccessibilityPrefs {
  captions: boolean;
  screenReaderOptimized: boolean;
  colorSafePalette: boolean;
  extendedTimers: boolean;
}

export type PlayStyle = "casual" | "competitive" | "any";

export interface MatchingPrefs {
  preferSharedInterests: boolean;
  preferSameLanguage: boolean;
  playStyle: PlayStyle;
}

export interface ProfileInput {
  displayName: string;
  ageBand: AgeBand;
  language: LanguageCode;
  interests: Interest[];
  accessibility: AccessibilityPrefs;
  matching: MatchingPrefs;
  consent: {
    guidelinesAccepted: true;
    /** Opt-in: interests are only used for matching when this is true. */
    useInterestsForMatching: boolean;
  };
}

export interface Profile extends ProfileInput {
  id: UserId;
  /** Server-derived from ageBand; drives safety defaults. */
  isMinor: boolean;
  createdAt: ISODateString;
}

export type Role = "player" | "admin" | "moderator";

/** The only user shape other participants ever see. No age, location or contact data. */
export interface PublicUser {
  id: UserId;
  displayName: string;
  /** Deterministic hue for avatar rendering. */
  avatarHue: number;
  /** Fixture/bot users are labelled so they are never mistaken for real people. */
  isBot?: boolean;
}

export interface Session {
  user: PublicUser & { roles: Role[] };
  profile: Profile;
  expiresAt: ISODateString;
}

export type InvitePolicy = "anyone_with_code" | "matched_only";

export interface PrivacySettings {
  showOnlineStatus: boolean;
  invitePolicy: InvitePolicy;
  /** Minors are forced to "strict" by the server regardless of this value. */
  chatFilter: "standard" | "strict";
}

/* ----------------------------------------------------------------------------
 * Catalog & puzzles
 * ------------------------------------------------------------------------- */

export type GameKind = "word" | "riddle" | "logic" | "mystery";
export type ActivityKind = GameKind | "watch";
export type Difficulty = "easy" | "medium" | "hard";
export type GameCategory = "Word" | "Riddle" | "Logic" | "Mystery";
export type PlayMode = "solo" | "multiplayer";

export interface GameSummary {
  id: GameId;
  kind: GameKind;
  title: string;
  tagline: string;
  category: GameCategory;
  difficulties: Difficulty[];
  modes: PlayMode[];
  /** Multiplayer turn structure, if multiplayer is supported. */
  turnMode?: "simultaneous" | "turns";
  minPlayers: number;
  maxPlayers: number;
  estMinutes: number;
  enabled: boolean;
}

export interface Suspect {
  id: string;
  name: string;
  role: string;
  statement: string;
}

export interface ClueStub {
  id: string;
  title: string;
  location: string;
}

export interface RevealedClue extends ClueStub {
  detail: string;
}

/** Puzzle payloads as delivered to the browser — never containing solutions. */
export type PublicPuzzle =
  | { kind: "word"; id: string; prompt: string; /** sentence with a single "___" */ template: string; letters: number }
  | { kind: "riddle"; id: string; text: string }
  | { kind: "logic"; id: string; size: 4; givens: (number | null)[][]; rules: string }
  | {
      kind: "mystery";
      id: string;
      title: string;
      briefing: string;
      suspects: Suspect[];
      clues: ClueStub[];
      methods: string[];
      motives: string[];
    };

export type PuzzleAnswer =
  | { kind: "word"; text: string }
  | { kind: "riddle"; text: string }
  | { kind: "logic"; grid: number[][] }
  | { kind: "mystery"; suspectId: string; method: string; motive: string };

export interface AnswerResult {
  correct: boolean;
  feedback: string;
  scoreDelta: number;
  totalScore: number;
  attemptsLeft: number;
  /** Present once the puzzle is closed (solved or out of attempts). */
  solution?: string;
  closed: boolean;
}

export interface SoloSession {
  id: string;
  gameId: GameId;
  difficulty: Difficulty;
  index: number;
  total: number;
  score: number;
  status: "active" | "complete";
  puzzle: PublicPuzzle;
  hintsLeft: number;
  /** Clues already revealed in this session (mystery only). */
  revealedClues: RevealedClue[];
}

/* ----------------------------------------------------------------------------
 * Community, rooms, matchmaking
 * ------------------------------------------------------------------------- */

export interface CommunityPulse {
  /** Coarse band so the UI never has to invent precision. */
  activity: "quiet" | "steady" | "busy";
  playersOnline: number | null;
  activeRooms: number | null;
  trending: { gameId: GameId; title: string; liveRooms: number }[];
  generatedAt: ISODateString;
}

export type RoomPrivacy = "private" | "open";
export type RoomPhase = "lobby" | "playing" | "watching" | "closed";
export type ConnectionState = "online" | "reconnecting" | "offline";

export interface Participant {
  user: PublicUser;
  role: "host" | "player";
  ready: boolean;
  connection: ConnectionState;
  joinedAt: ISODateString;
}

export interface RoomActivity {
  kind: ActivityKind;
  gameId?: GameId;
  difficulty?: Difficulty;
}

export interface Room {
  id: RoomId;
  /** 8 chars from an unambiguous 31-symbol alphabet (~39.6 bits); server generated. */
  code: string;
  hostId: UserId;
  activity: RoomActivity;
  capacity: number;
  privacy: RoomPrivacy;
  phase: RoomPhase;
  participants: Participant[];
  createdAt: ISODateString;
  /** Monotonic room version for conflict detection. */
  version: number;
}

export interface CreateRoomInput {
  activity: RoomActivity;
  capacity: number;
  privacy: RoomPrivacy;
}

export interface MatchCriteria {
  gameId: GameId;
  groupSize: number;
  difficulty: Difficulty;
  language: LanguageCode;
  interests: Interest[];
}

export interface MatchTicket {
  ticketId: string;
  criteria: MatchCriteria;
  createdAt: ISODateString;
}

/** Qualitative status only — the server does not promise wait times. */
export type MatchPhase = "queued" | "searching" | "widening" | "matched" | "expired" | "cancelled";

/* ----------------------------------------------------------------------------
 * Live state carried over the realtime channel
 * ------------------------------------------------------------------------- */

export interface ChatMessage {
  id: string;
  clientMsgId?: string;
  roomId: RoomId;
  author: PublicUser;
  text: string;
  sentAt: ISODateString;
  /** "system" messages are generated by the server (joins, starts, moderation). */
  kind: "user" | "system";
}

export interface GameState {
  gameId: GameId;
  kind: GameKind;
  title: string;
  round: number;
  totalRounds: number;
  phase: "countdown" | "answering" | "reveal" | "finished";
  puzzle: PublicPuzzle | null;
  turn: { mode: "simultaneous" } | { mode: "turns"; activeUserId: UserId };
  /** Server time at which the current phase ends. */
  endsAt: ISODateString | null;
  scores: Record<UserId, number>;
  /** Users who have answered correctly this round. */
  solvedBy: UserId[];
  lastReveal?: { solution: string; correctUserIds: UserId[] };
}

export interface WatchSource {
  kind: "url";
  url: string;
  title: string;
}

export interface WatchState {
  source: WatchSource | null;
  status: "idle" | "playing" | "paused" | "ended";
  /** Playback position at `updatedAt`. */
  positionSec: number;
  rate: number;
  /** Server time when positionSec was measured. */
  updatedAt: ISODateString;
  controlPolicy: "host" | "everyone";
}

/* ----------------------------------------------------------------------------
 * Moderation & admin
 * ------------------------------------------------------------------------- */

export const REPORT_REASONS = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate or discrimination" },
  { value: "sexual", label: "Sexual content" },
  { value: "minor_safety", label: "Child safety concern" },
  { value: "spam", label: "Spam or scams" },
  { value: "personal_info", label: "Sharing personal information" },
  { value: "cheating", label: "Cheating or griefing" },
  { value: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export interface ReportInput {
  targetUserId: UserId;
  roomId?: RoomId;
  messageId?: string;
  reason: ReportReason;
  details?: string;
}

export type ReportStatus = "open" | "actioned" | "dismissed";
export type ModerationAction = "dismiss" | "warn" | "remove_content" | "suspend";

export interface ModerationReport {
  id: string;
  reason: ReportReason;
  details?: string;
  target: PublicUser;
  reporterId: UserId;
  roomCode?: string;
  messageExcerpt?: string;
  status: ReportStatus;
  priority: "normal" | "high";
  createdAt: ISODateString;
  resolution?: { action: ModerationAction; note: string; at: ISODateString };
}

export interface RoomHealth {
  roomId: RoomId;
  code: string;
  activity: ActivityKind;
  participants: number;
  capacity: number;
  phase: RoomPhase;
  ageSeconds: number;
  reconnectsLastHour: number;
  issues: ("stale_host" | "high_reconnects" | "near_capacity")[];
}

export interface QueueHealth {
  gameId: GameId;
  title: string;
  waiting: number;
  medianWaitSeconds: number | null;
  matchesLastHour: number;
}

export interface AdminOverview {
  generatedAt: ISODateString;
  metrics: {
    activeUsers: number;
    activeRooms: number;
    playersInQueue: number;
    matchesLastHour: number;
    openReports: number;
    reconnectRate: number; // 0..1
  };
  hourlyMatches: { hour: string; matches: number }[];
  rooms: RoomHealth[];
  queues: QueueHealth[];
}

export type FeatureFlagKey = "multiplayer" | "watchTogether" | "screenShare" | "reactions" | "chat";

export interface FeatureFlag {
  key: FeatureFlagKey;
  description: string;
  enabled: boolean;
  updatedAt: ISODateString;
}

export type FeatureFlags = Record<FeatureFlagKey, boolean>;
