import type {
  AdminOverview,
  AnswerResult,
  CommunityPulse,
  CreateRoomInput,
  Difficulty,
  FeatureFlag,
  FeatureFlagKey,
  FeatureFlags,
  GameId,
  GameSummary,
  MatchCriteria,
  MatchTicket,
  ModerationAction,
  ModerationReport,
  PrivacySettings,
  ProfileInput,
  PublicUser,
  PuzzleAnswer,
  ReportInput,
  ReportStatus,
  RevealedClue,
  Room,
  RoomId,
  Session,
  SoloSession,
  UserId,
} from "./types";

/** Every call accepts an AbortSignal so routes can cancel in-flight work. */
export interface RequestOptions {
  signal?: AbortSignal;
}

export interface RealtimeTicket {
  /** Fully-qualified socket URL including the single-use ticket. */
  url: string;
  expiresAt: string;
}

/**
 * The full surface the UI depends on. Both adapters implement it; components
 * only ever import `api` from `@/lib/api`, never an adapter directly.
 */
export interface PrismApi {
  readonly mode: "mock" | "http";

  session: {
    /** Returns null when there is no active session (not an error). */
    current(opts?: RequestOptions): Promise<Session | null>;
    create(profile: ProfileInput, opts?: RequestOptions): Promise<Session>;
    updateProfile(profile: ProfileInput, opts?: RequestOptions): Promise<Session>;
    refresh(opts?: RequestOptions): Promise<Session>;
    /** Ends the session and asks the server to delete session-scoped data. */
    destroy(opts?: RequestOptions): Promise<void>;
  };

  privacy: {
    get(opts?: RequestOptions): Promise<PrivacySettings>;
    update(settings: PrivacySettings, opts?: RequestOptions): Promise<PrivacySettings>;
  };

  config: {
    flags(opts?: RequestOptions): Promise<FeatureFlags>;
  };

  community: {
    pulse(opts?: RequestOptions): Promise<CommunityPulse>;
  };

  catalog: {
    list(opts?: RequestOptions): Promise<GameSummary[]>;
    get(gameId: GameId, opts?: RequestOptions): Promise<GameSummary>;
  };

  solo: {
    start(gameId: GameId, difficulty: Difficulty, opts?: RequestOptions): Promise<SoloSession>;
    submit(sessionId: string, answer: PuzzleAnswer, opts?: RequestOptions): Promise<AnswerResult>;
    hint(sessionId: string, opts?: RequestOptions): Promise<{ hint: string; hintsLeft: number }>;
    inspectClue(sessionId: string, clueId: string, opts?: RequestOptions): Promise<RevealedClue>;
    advance(sessionId: string, opts?: RequestOptions): Promise<SoloSession>;
  };

  rooms: {
    create(input: CreateRoomInput, opts?: RequestOptions): Promise<Room>;
    get(code: string, opts?: RequestOptions): Promise<Room>;
    join(code: string, opts?: RequestOptions): Promise<Room>;
    leave(roomId: RoomId, opts?: RequestOptions): Promise<void>;
  };

  matchmaking: {
    enqueue(criteria: MatchCriteria, opts?: RequestOptions): Promise<MatchTicket>;
    cancel(ticketId: string, opts?: RequestOptions): Promise<void>;
  };

  realtime: {
    ticket(opts?: RequestOptions): Promise<RealtimeTicket>;
  };

  moderation: {
    report(input: ReportInput, opts?: RequestOptions): Promise<{ reportId: string }>;
    block(userId: UserId, opts?: RequestOptions): Promise<void>;
    unblock(userId: UserId, opts?: RequestOptions): Promise<void>;
    blocked(opts?: RequestOptions): Promise<PublicUser[]>;
  };

  /** Authorization is enforced by the backend; these calls 403 for non-admins. */
  admin: {
    overview(opts?: RequestOptions): Promise<AdminOverview>;
    catalog(opts?: RequestOptions): Promise<GameSummary[]>;
    updateGame(gameId: GameId, patch: Partial<Pick<GameSummary, "enabled" | "difficulties">>, opts?: RequestOptions): Promise<GameSummary>;
    reports(status: ReportStatus, opts?: RequestOptions): Promise<ModerationReport[]>;
    resolveReport(reportId: string, action: ModerationAction, note: string, opts?: RequestOptions): Promise<ModerationReport>;
    flags(opts?: RequestOptions): Promise<FeatureFlag[]>;
    setFlag(key: FeatureFlagKey, enabled: boolean, opts?: RequestOptions): Promise<FeatureFlag>;
  };
}
