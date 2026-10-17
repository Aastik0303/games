/**
 * ⚠️ MOCK SERVER — development only.
 *
 * An in-memory stand-in for the Prism backend so the UI can be built and
 * exercised without one. It mirrors the server-authoritative rules the real
 * backend must enforce (membership, host rights, turn order, grading, rate
 * limits) so the UI is built against realistic constraints — but it is not a
 * security boundary: it runs in the browser.
 *
 * State is per-tab. Rooms reset on reload; the session persists in
 * sessionStorage so a refresh doesn't drop the profile.
 */
import { ApiError } from "../errors";
import type {
  AdminOverview,
  AnswerResult,
  ChatMessage,
  CommunityPulse,
  CreateRoomInput,
  Difficulty,
  FeatureFlag,
  FeatureFlagKey,
  FeatureFlags,
  GameState,
  GameSummary,
  MatchCriteria,
  MatchPhase,
  MatchTicket,
  ModerationAction,
  ModerationReport,
  Participant,
  PrivacySettings,
  ProfileInput,
  PublicPuzzle,
  PublicUser,
  PuzzleAnswer,
  ReportInput,
  ReportStatus,
  RevealedClue,
  Room,
  RoomHealth,
  Session,
  SoloSession,
  UserId,
  WatchSource,
  WatchState,
} from "../types";
import type { ClientCommand, ServerEvent, ServerEventMap, ServerEventType, AckError } from "@/lib/realtime/events";
import type { SocketLike } from "@/lib/realtime/connection";
import { generateRoomCode, normalizeRoomCode } from "@/lib/room-code";
import { isSolved } from "@/lib/games/sudoku";
import { matchesAnswer } from "./grading";
import {
  BOT_LINES,
  BOTS,
  CATALOG,
  initialFlags,
  initialReports,
  LOGIC_PUZZLES,
  MYSTERY,
  RIDDLES,
  WORD_PUZZLES,
  type LogicFixture,
  type RiddleFixture,
  type WordFixture,
} from "./fixtures";

const SESSION_KEY = "prism.mock.session.v1";
const BLOCKED_KEY = "prism.mock.blocked.v1";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const ROUNDS = 5;
const ROUND_MS = 30_000;
const REVEAL_MS = 4_000;
const COUNTDOWN_MS = 3_000;
const MAX_ATTEMPTS = 3;

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const nowIso = () => new Date().toISOString();
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const fail = (code: ConstructorParameters<typeof ApiError>[0], message: string, status = 400): never => {
  throw new ApiError(code, message, { status });
};

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ */

type TextFixture = WordFixture | RiddleFixture;
type RoundFixture = TextFixture;

interface GameRuntime {
  state: GameState;
  fixtures: RoundFixture[];
  attempts: Map<UserId, number>;
  turnOrder: UserId[];
}

interface RoomRuntime {
  room: Room;
  chat: ChatMessage[];
  game: GameRuntime | null;
  watch: WatchState | null;
  seq: number;
  timers: Set<ReturnType<typeof setTimeout>>;
  rate: Map<string, number[]>;
}

interface SoloRuntime {
  id: string;
  gameId: string;
  kind: GameSummary["kind"];
  difficulty: Difficulty;
  items: (WordFixture | RiddleFixture | LogicFixture | typeof MYSTERY)[];
  index: number;
  score: number;
  attemptsLeft: number;
  hintsLeft: number;
  hintsThisPuzzle: number;
  closed: boolean;
  revealed: Map<string, RevealedClue>;
  status: "active" | "complete";
}

type AckResult = { ok: true; data?: unknown } | { ok: false; error: AckError };

interface TicketRuntime {
  ticket: MatchTicket;
  phase: MatchPhase;
  roomCode?: string;
  timers: ReturnType<typeof setTimeout>[];
}

class MockSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  readonly rooms = new Set<string>();
  readonly tickets = new Set<string>();

  constructor(private readonly server: MockServer) {
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.({});
    }, 120);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("socket not open");
    setTimeout(() => this.server.handleFrame(this, data), 30);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.server.detach(this);
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }

  deliver(event: ServerEvent): void {
    if (this.readyState !== 1) return;
    const frame = JSON.stringify(event);
    setTimeout(() => this.onmessage?.({ data: frame }), 15);
  }
}

export class MockServer {
  private session: Session | null = null;
  private privacy: PrivacySettings = { showOnlineStatus: true, invitePolicy: "anyone_with_code", chatFilter: "standard" };
  private blocked: PublicUser[] = [];
  private flags: FeatureFlag[] = initialFlags(nowIso());
  private catalog: GameSummary[] = structuredClone(CATALOG);
  private reports: ModerationReport[] = initialReports(Date.now());
  private readonly solo = new Map<string, SoloRuntime>();
  private readonly rooms = new Map<string, RoomRuntime>();
  private readonly codes = new Map<string, string>();
  private readonly tickets = new Map<string, TicketRuntime>();
  private readonly sockets = new Set<MockSocket>();

  constructor() {
    const store = safeStorage();
    try {
      const raw = store?.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Session;
        if (Date.parse(parsed.expiresAt) > Date.now()) this.session = parsed;
      }
      const blocked = store?.getItem(BLOCKED_KEY);
      if (blocked) this.blocked = JSON.parse(blocked) as PublicUser[];
    } catch {
      /* corrupt storage — start fresh */
    }
  }

  /* =============================== session =============================== */

  private persist(): void {
    const store = safeStorage();
    try {
      if (this.session) store?.setItem(SESSION_KEY, JSON.stringify(this.session));
      else store?.removeItem(SESSION_KEY);
      store?.setItem(BLOCKED_KEY, JSON.stringify(this.blocked));
    } catch {
      /* storage unavailable — session is in-memory only */
    }
  }

  private requireSession(): Session {
    if (!this.session || Date.parse(this.session.expiresAt) <= Date.now()) {
      this.session = null;
      this.persist();
      return fail("session_expired", "Session expired", 401);
    }
    return this.session;
  }

  private me(): PublicUser {
    const { id, displayName, avatarHue } = this.requireSession().user;
    return { id, displayName, avatarHue };
  }

  currentSession(): Session | null {
    if (this.session && Date.parse(this.session.expiresAt) <= Date.now()) {
      this.session = null;
      this.persist();
    }
    return this.session;
  }

  createSession(profile: ProfileInput): Session {
    this.validateProfile(profile);
    const id = this.session?.user.id ?? uid("u");
    const isMinor = profile.ageBand === "13_15" || profile.ageBand === "16_17";
    this.session = {
      user: { id, displayName: profile.displayName.trim(), avatarHue: hueFor(id), roles: this.session?.user.roles ?? ["player"] },
      profile: { ...profile, displayName: profile.displayName.trim(), id, isMinor, createdAt: this.session?.profile.createdAt ?? nowIso() },
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    if (isMinor) {
      // Safety defaults the server enforces for minors.
      this.privacy = { ...this.privacy, invitePolicy: "matched_only", chatFilter: "strict" };
    }
    this.persist();
    return this.session;
  }

  updateProfile(profile: ProfileInput): Session {
    this.requireSession();
    return this.createSession(profile);
  }

  refreshSession(): Session {
    const s = this.requireSession();
    this.session = { ...s, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
    this.persist();
    return this.session;
  }

  destroySession(): void {
    for (const rt of this.rooms.values()) this.closeRoom(rt, "host_left");
    this.session = null;
    this.blocked = [];
    this.persist();
  }

  private validateProfile(p: ProfileInput): void {
    const name = p.displayName?.trim() ?? "";
    if (name.length < 2 || name.length > 24) fail("validation", "Display name must be 2–24 characters.", 422);
    if (!p.consent?.guidelinesAccepted) fail("validation", "You need to accept the community guidelines.", 422);
  }

  /** DEV ONLY: lets a developer view the admin UI in mock mode. */
  devSetAdmin(enabled: boolean): Session {
    const s = this.requireSession();
    const roles = new Set(s.user.roles);
    if (enabled) roles.add("admin");
    else roles.delete("admin");
    this.session = { ...s, user: { ...s.user, roles: [...roles] } };
    this.persist();
    return this.session;
  }

  /** DEV ONLY: forces the session to expire to exercise expiry handling. */
  devExpireSession(): void {
    if (this.session) this.session = { ...this.session, expiresAt: new Date(Date.now() - 1000).toISOString() };
    this.persist();
  }

  /** DEV ONLY: drops all sockets to exercise reconnect handling. */
  devDropConnections(): void {
    for (const socket of [...this.sockets]) {
      socket.readyState = 3;
      this.detach(socket);
      setTimeout(() => socket.onclose?.({ code: 1006, reason: "simulated drop" }), 0);
    }
  }

  getPrivacy(): PrivacySettings {
    this.requireSession();
    return this.privacy;
  }

  setPrivacy(next: PrivacySettings): PrivacySettings {
    const s = this.requireSession();
    this.privacy = s.profile.isMinor ? { ...next, chatFilter: "strict" } : next;
    return this.privacy;
  }

  /* ============================ catalog & pulse =========================== */

  featureFlags(): FeatureFlags {
    return Object.fromEntries(this.flags.map((f) => [f.key, f.enabled])) as FeatureFlags;
  }

  private flagOn(key: FeatureFlagKey): boolean {
    return this.flags.find((f) => f.key === key)?.enabled ?? false;
  }

  listGames(): GameSummary[] {
    return this.catalog.filter((g) => g.enabled);
  }

  getGame(id: string): GameSummary {
    const game = this.catalog.find((g) => g.id === id && g.enabled);
    return game ?? fail("not_found", "That game isn't available.", 404);
  }

  pulse(): CommunityPulse {
    const jitter = Math.round(rand(-25, 25));
    return {
      activity: "steady",
      playersOnline: 1284 + jitter,
      activeRooms: 212 + Math.round(jitter / 5) + this.rooms.size,
      trending: [
        { gameId: "missing-word", title: "Missing Word", liveRooms: 64 },
        { gameId: "riddle-relay", title: "Riddle Relay", liveRooms: 41 },
        { gameId: "wrenfield-manor", title: "Death at Wrenfield Manor", liveRooms: 0 },
      ],
      generatedAt: nowIso(),
    };
  }

  /* ================================= solo ================================= */

  startSolo(gameId: string, difficulty: Difficulty): SoloSession {
    this.requireSession();
    const game = this.getGame(gameId);
    if (!game.modes.includes("solo")) fail("validation", "This game is multiplayer only.", 422);
    if (!game.difficulties.includes(difficulty)) fail("validation", "Difficulty not available for this game.", 422);
    let items: SoloRuntime["items"];
    switch (game.kind) {
      case "word": items = shuffle(WORD_PUZZLES.filter((p) => p.difficulty === difficulty)).slice(0, 5); break;
      case "riddle": items = shuffle(RIDDLES.filter((p) => p.difficulty === difficulty)).slice(0, 5); break;
      case "logic": items = shuffle(LOGIC_PUZZLES.filter((p) => p.difficulty === difficulty)).slice(0, 2); break;
      case "mystery": items = [MYSTERY]; break;
    }
    const rt: SoloRuntime = {
      id: uid("solo"), gameId, kind: game.kind, difficulty, items, index: 0, score: 0,
      attemptsLeft: this.attemptsFor(game.kind), hintsLeft: 3, hintsThisPuzzle: 0, closed: false,
      revealed: new Map(), status: "active",
    };
    this.solo.set(rt.id, rt);
    return this.soloView(rt);
  }

  private attemptsFor(kind: GameSummary["kind"]): number {
    return kind === "mystery" ? 1 : kind === "logic" ? 5 : MAX_ATTEMPTS;
  }

  private soloRuntime(id: string): SoloRuntime {
    this.requireSession();
    return this.solo.get(id) ?? fail("not_found", "That game session has ended.", 404);
  }

  private soloView(rt: SoloRuntime): SoloSession {
    return {
      id: rt.id, gameId: rt.gameId, difficulty: rt.difficulty, index: rt.index, total: rt.items.length,
      score: rt.score, status: rt.status, puzzle: toPublic(rt.items[rt.index]), hintsLeft: rt.hintsLeft,
      revealedClues: [...rt.revealed.values()],
    };
  }

  submitSolo(id: string, answer: PuzzleAnswer): AnswerResult {
    const rt = this.soloRuntime(id);
    if (rt.status === "complete" || rt.closed) fail("conflict", "This puzzle is already closed.", 409);
    const item = rt.items[rt.index];
    if (answer.kind !== rt.kind) fail("validation", "Answer doesn't match this puzzle.", 422);

    let correct = false;
    let delta = 0;
    let feedback = "";
    let solution: string | undefined;

    if ((answer.kind === "word" || answer.kind === "riddle") && "answers" in item) {
      if (answer.text.trim().length === 0 || answer.text.length > 60) fail("validation", "Enter an answer.", 422);
      correct = matchesAnswer(answer.text, item.answers);
      const attemptNo = this.attemptsFor(rt.kind) - rt.attemptsLeft + 1;
      if (correct) {
        delta = Math.max(10, [100, 70, 40][attemptNo - 1] - rt.hintsThisPuzzle * 20);
        feedback = attemptNo === 1 ? "Perfect — first try!" : "Got it!";
      } else feedback = "Not quite.";
      solution = item.answers[0];
    } else if (answer.kind === "logic" && "solution" in item && "givens" in item) {
      const grid = answer.grid;
      const shapeOk = Array.isArray(grid) && grid.length === 4 && grid.every((r) => Array.isArray(r) && r.length === 4);
      if (!shapeOk) fail("validation", "The grid must be 4×4.", 422);
      correct = isSolved(grid, item.givens);
      const wrong = this.attemptsFor(rt.kind) - rt.attemptsLeft;
      delta = correct ? Math.max(20, 150 - wrong * 20 - rt.hintsThisPuzzle * 30) : 0;
      feedback = correct ? "Solved. Every row, column and box checks out." : "Not solved yet — check for repeats or empty cells.";
      solution = item.solution.map((r) => r.join(" ")).join(" / ");
    } else if (answer.kind === "mystery" && "suspects" in item) {
      const s = item.solution;
      const suspectRight = answer.suspectId === s.suspectId;
      const methodRight = answer.method === s.method;
      const motiveRight = answer.motive === s.motive;
      correct = suspectRight && methodRight && motiveRight;
      delta = Math.max(0, (suspectRight ? 60 : 0) + (methodRight ? 20 : 0) + (motiveRight ? 20 : 0) - Math.max(0, rt.revealed.size - 5) * 5);
      const parts = [suspectRight ? "the culprit" : null, methodRight ? "the method" : null, motiveRight ? "the motive" : null].filter(Boolean);
      feedback = correct
        ? "Case closed. You named the culprit, the method and the motive."
        : parts.length
          ? `You got ${parts.join(" and ")} right.`
          : "The real culprit walks free.";
      solution = s.explanation;
    } else {
      fail("validation", "Unsupported answer.", 422);
    }

    rt.attemptsLeft -= 1;
    if (correct || rt.attemptsLeft <= 0) rt.closed = true;
    rt.score += delta;
    return {
      correct, feedback, scoreDelta: delta, totalScore: rt.score, attemptsLeft: rt.attemptsLeft,
      closed: rt.closed, solution: rt.closed ? solution : undefined,
    };
  }

  soloHint(id: string): { hint: string; hintsLeft: number } {
    const rt = this.soloRuntime(id);
    if (rt.closed) fail("conflict", "This puzzle is already closed.", 409);
    if (rt.hintsLeft <= 0) fail("conflict", "No hints left in this session.", 409);
    const item = rt.items[rt.index];
    let hint = "";
    if ("hint" in item) hint = item.hint;
    else if ("solution" in item && "givens" in item) {
      const empties: [number, number][] = [];
      item.givens.forEach((row, r) => row.forEach((v, c) => v == null && empties.push([r, c])));
      const [r, c] = empties[rt.hintsThisPuzzle % empties.length];
      hint = `Row ${r + 1}, column ${c + 1} is ${item.solution[r][c]}.`;
    } else {
      hint = [
        "Ask who could have supplied whatever was poisoned — and whose handwriting is on it.",
        "Rule out anyone with a confirmed alibi during the blackout.",
        "A motive is strongest when someone was about to expose the culprit.",
      ][Math.min(rt.hintsThisPuzzle, 2)];
    }
    rt.hintsLeft -= 1;
    rt.hintsThisPuzzle += 1;
    return { hint, hintsLeft: rt.hintsLeft };
  }

  inspectClue(id: string, clueId: string): RevealedClue {
    const rt = this.soloRuntime(id);
    const item = rt.items[rt.index];
    if (!("clues" in item)) fail("validation", "This puzzle has no clues.", 422);
    const mystery = item as typeof MYSTERY;
    const clue = mystery.clues.find((c) => c.id === clueId) ?? fail("not_found", "Unknown clue.", 404);
    const revealed: RevealedClue = { id: clue.id, title: clue.title, location: clue.location, detail: clue.detail };
    rt.revealed.set(clue.id, revealed);
    return revealed;
  }

  advanceSolo(id: string): SoloSession {
    const rt = this.soloRuntime(id);
    if (rt.status === "complete") return this.soloView(rt);
    if (rt.index + 1 >= rt.items.length) {
      rt.status = "complete";
      rt.closed = true;
      return this.soloView(rt);
    }
    rt.index += 1;
    rt.attemptsLeft = this.attemptsFor(rt.kind);
    rt.hintsThisPuzzle = 0;
    rt.closed = false;
    rt.revealed.clear();
    return this.soloView(rt);
  }

  /* ================================= rooms ================================ */

  private participant(user: PublicUser, role: Participant["role"], ready = false): Participant {
    return { user, role, ready, connection: "online", joinedAt: nowIso() };
  }

  private validateActivity(activity: CreateRoomInput["activity"], capacity: number): void {
    if (activity.kind === "watch") {
      if (!this.flagOn("watchTogether")) fail("forbidden", "Watch Together is currently disabled.", 403);
      if (capacity < 2 || capacity > 8) fail("validation", "Watch rooms hold 2–8 people.", 422);
      return;
    }
    if (!this.flagOn("multiplayer")) fail("forbidden", "Multiplayer is currently disabled.", 403);
    const game = this.getGame(activity.gameId ?? "");
    if (!game.modes.includes("multiplayer")) fail("validation", `${game.title} is solo only for now.`, 422);
    if (capacity < game.minPlayers || capacity > game.maxPlayers)
      fail("validation", `${game.title} supports ${game.minPlayers}–${game.maxPlayers} players.`, 422);
    if (activity.difficulty && !game.difficulties.includes(activity.difficulty)) fail("validation", "Difficulty not available.", 422);
  }

  createRoom(input: CreateRoomInput, opts: { bots?: PublicUser[] } = {}): Room {
    const me = this.me();
    this.validateActivity(input.activity, input.capacity);
    let code = generateRoomCode();
    while (this.codes.has(code)) code = generateRoomCode();
    const room: Room = {
      id: uid("room"), code, hostId: me.id,
      activity: { ...input.activity, difficulty: input.activity.kind === "watch" ? undefined : input.activity.difficulty ?? "easy" },
      capacity: input.capacity, privacy: input.privacy, phase: "lobby",
      participants: [this.participant(me, "host", true), ...(opts.bots ?? []).map((b) => this.participant(b, "player", true))],
      createdAt: nowIso(), version: 1,
    };
    const rt: RoomRuntime = { room, chat: [], game: null, watch: null, seq: 0, timers: new Set(), rate: new Map() };
    this.rooms.set(room.id, rt);
    this.codes.set(code, room.id);
    this.systemMessage(rt, `${me.displayName} created the room.`, false);
    if (room.privacy === "open" && !opts.bots) this.trickleBots(rt);
    return room;
  }

  private runtimeByCode(code: string): RoomRuntime {
    const id = this.codes.get(normalizeRoomCode(code));
    const rt = id ? this.rooms.get(id) : undefined;
    if (!rt || rt.room.phase === "closed")
      return fail("not_found", "No room with that code. Codes are case-insensitive — check for typos.", 404);
    return rt;
  }

  getRoom(code: string): Room {
    this.requireSession();
    return this.runtimeByCode(code).room;
  }

  joinRoom(code: string): Room {
    const me = this.me();
    const rt = this.runtimeByCode(code);
    if (rt.room.participants.some((p) => p.user.id === me.id)) return rt.room;
    if (rt.room.participants.length >= rt.room.capacity) fail("room_full", "That room is full.", 409);
    rt.room.participants.push(this.participant(me, "player"));
    this.bump(rt);
    this.systemMessage(rt, `${me.displayName} joined.`);
    return rt.room;
  }

  leaveRoom(roomId: string): void {
    const me = this.me();
    const rt = this.rooms.get(roomId);
    if (!rt) return;
    if (rt.room.hostId === me.id) {
      this.closeRoom(rt, "host_left");
      return;
    }
    rt.room.participants = rt.room.participants.filter((p) => p.user.id !== me.id);
    this.bump(rt);
  }

  /** DEV ONLY: add a labelled bot so private rooms can be tested solo. */
  devAddBot(roomId: string): void {
    const rt = this.rooms.get(roomId) ?? fail("not_found", "Room not found", 404);
    if (rt.room.participants.length >= rt.room.capacity) fail("room_full", "Room is full.", 409);
    const bot = BOTS.find((b) => !rt.room.participants.some((p) => p.user.id === b.id));
    if (!bot) fail("conflict", "No more mock players available.", 409);
    this.addBot(rt, bot!);
  }

  private addBot(rt: RoomRuntime, bot: PublicUser): void {
    if (rt.room.phase === "closed" || rt.room.participants.length >= rt.room.capacity) return;
    rt.room.participants.push(this.participant(bot, "player"));
    this.bump(rt);
    this.systemMessage(rt, `${bot.displayName} joined.`);
    this.later(rt, rand(1200, 2600), () => this.botReady(rt, bot.id));
    if (Math.random() < 0.6) this.later(rt, rand(1500, 4000), () => this.botChat(rt, bot));
  }

  private trickleBots(rt: RoomRuntime): void {
    const want = Math.min(rt.room.capacity - 1, 2);
    BOTS.slice(0, want).forEach((bot, i) => this.later(rt, 2500 + i * 2200, () => this.addBot(rt, bot)));
  }

  private botReady(rt: RoomRuntime, botId: string): void {
    const p = rt.room.participants.find((x) => x.user.id === botId);
    if (!p || rt.room.phase !== "lobby" || p.ready) return;
    p.ready = true;
    this.bump(rt);
  }

  private botChat(rt: RoomRuntime, bot: PublicUser): void {
    if (!rt.room.participants.some((p) => p.user.id === bot.id)) return;
    const message: ChatMessage = {
      id: uid("msg"), roomId: rt.room.id, author: bot, kind: "user", sentAt: nowIso(),
      text: BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)],
    };
    this.pushChat(rt, message);
  }

  private closeRoom(rt: RoomRuntime, reason: ServerEventMap["room.closed"]["reason"]): void {
    for (const t of rt.timers) clearTimeout(t);
    rt.timers.clear();
    rt.room.phase = "closed";
    this.broadcast(rt, "room.closed", { roomId: rt.room.id, reason });
    this.rooms.delete(rt.room.id);
    this.codes.delete(rt.room.code);
  }

  private later(rt: RoomRuntime, ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      rt.timers.delete(t);
      if (this.rooms.has(rt.room.id)) fn();
    }, ms);
    rt.timers.add(t);
  }

  private bump(rt: RoomRuntime): void {
    rt.room.version += 1;
    this.broadcast(rt, "room.updated", { room: rt.room });
  }

  private systemMessage(rt: RoomRuntime, text: string, broadcast = true): void {
    const message: ChatMessage = {
      id: uid("sys"), roomId: rt.room.id, kind: "system", sentAt: nowIso(), text,
      author: { id: "system", displayName: "Prism", avatarHue: 270 },
    };
    if (broadcast) this.pushChat(rt, message);
    else rt.chat.push(message);
  }

  private pushChat(rt: RoomRuntime, message: ChatMessage): void {
    rt.chat.push(message);
    if (rt.chat.length > 200) rt.chat.shift();
    if (this.blocked.some((b) => b.id === message.author.id)) return;
    this.broadcast(rt, "chat.message", { message });
  }

  /* ============================== matchmaking ============================= */

  enqueue(criteria: MatchCriteria): MatchTicket {
    this.requireSession();
    if (!this.flagOn("multiplayer")) fail("forbidden", "Matchmaking is currently disabled.", 403);
    const game = this.getGame(criteria.gameId);
    if (!game.modes.includes("multiplayer")) fail("validation", "Choose a multiplayer activity.", 422);
    if (criteria.groupSize < Math.max(2, game.minPlayers) || criteria.groupSize > Math.min(4, game.maxPlayers))
      fail("validation", "Group size must be between 2 and 4.", 422);
    for (const t of this.tickets.values()) if (t.phase === "queued" || t.phase === "searching" || t.phase === "widening") this.cancelTicket(t.ticket.ticketId);

    const ticket: MatchTicket = { ticketId: uid("tkt"), criteria, createdAt: nowIso() };
    const rt: TicketRuntime = { ticket, phase: "queued", timers: [] };
    this.tickets.set(ticket.ticketId, rt);
    const step = (ms: number, fn: () => void) => rt.timers.push(setTimeout(fn, ms));
    step(1200, () => this.setTicketPhase(rt, "searching"));
    const matchAt = rand(4500, 9000);
    if (matchAt > 6500) step(6500, () => this.setTicketPhase(rt, "widening"));
    step(matchAt, () => {
      if (rt.phase === "cancelled") return;
      const bots = shuffle(BOTS).slice(0, criteria.groupSize - 1);
      const room = this.createRoom(
        { activity: { kind: game.kind, gameId: game.id, difficulty: criteria.difficulty }, capacity: criteria.groupSize, privacy: "open" },
        { bots },
      );
      rt.roomCode = room.code;
      rt.phase = "matched";
      this.emitTicket(rt, "matchmaking.matched", { ticketId: ticket.ticketId, roomCode: room.code });
    });
    step(120_000, () => rt.phase !== "matched" && this.setTicketPhase(rt, "expired"));
    return ticket;
  }

  cancelTicket(ticketId: string): void {
    const rt = this.tickets.get(ticketId);
    if (!rt) return;
    rt.timers.forEach(clearTimeout);
    if (rt.phase !== "matched") this.setTicketPhase(rt, "cancelled");
    this.tickets.delete(ticketId);
  }

  private setTicketPhase(rt: TicketRuntime, phase: MatchPhase): void {
    if (rt.phase === "matched" || rt.phase === "cancelled") return;
    rt.phase = phase;
    this.emitTicket(rt, "matchmaking.status", { ticketId: rt.ticket.ticketId, phase });
  }

  private emitTicket<K extends "matchmaking.status" | "matchmaking.matched">(rt: TicketRuntime, type: K, payload: ServerEventMap[K]): void {
    for (const s of this.sockets) if (s.tickets.has(rt.ticket.ticketId)) s.deliver(this.envelope(type, payload));
  }

  /* ============================== moderation ============================== */

  report(input: ReportInput): { reportId: string } {
    this.requireSession();
    if (input.details && input.details.length > 500) fail("validation", "Keep details under 500 characters.", 422);
    const target = this.findUser(input.targetUserId) ?? { id: input.targetUserId, displayName: "Unknown player", avatarHue: 0 };
    const rt = input.roomId ? this.rooms.get(input.roomId) : undefined;
    const message = rt?.chat.find((m) => m.id === input.messageId);
    const report: ModerationReport = {
      id: uid("rep"), reason: input.reason, details: input.details, target, reporterId: this.me().id,
      roomCode: rt?.room.code, messageExcerpt: message?.text.slice(0, 140), status: "open",
      priority: input.reason === "minor_safety" || input.reason === "personal_info" ? "high" : "normal",
      createdAt: nowIso(),
    };
    this.reports.unshift(report);
    return { reportId: report.id };
  }

  block(userId: string): void {
    this.requireSession();
    if (this.blocked.some((b) => b.id === userId)) return;
    const user = this.findUser(userId);
    if (!user) fail("not_found", "Player not found.", 404);
    this.blocked.push(user!);
    this.persist();
  }

  unblock(userId: string): void {
    this.requireSession();
    this.blocked = this.blocked.filter((b) => b.id !== userId);
    this.persist();
  }

  listBlocked(): PublicUser[] {
    this.requireSession();
    return this.blocked;
  }

  private findUser(id: string): PublicUser | undefined {
    for (const rt of this.rooms.values()) {
      const p = rt.room.participants.find((x) => x.user.id === id);
      if (p) return p.user;
      const m = rt.chat.find((x) => x.author.id === id);
      if (m) return m.author;
    }
    return BOTS.find((b) => b.id === id);
  }

  /* ================================= admin ================================ */

  private requireAdmin(): void {
    const s = this.requireSession();
    if (!s.user.roles.includes("admin")) fail("forbidden", "Admin access required.", 403);
  }

  adminOverview(): AdminOverview {
    this.requireAdmin();
    const now = Date.now();
    const liveRooms: RoomHealth[] = [...this.rooms.values()].map((rt) => ({
      roomId: rt.room.id, code: rt.room.code, activity: rt.room.activity.kind,
      participants: rt.room.participants.length, capacity: rt.room.capacity, phase: rt.room.phase,
      ageSeconds: Math.round((now - Date.parse(rt.room.createdAt)) / 1000), reconnectsLastHour: 0,
      issues: rt.room.participants.length >= rt.room.capacity ? ["near_capacity"] : [],
    }));
    const fixtureRooms: RoomHealth[] = [
      { roomId: "fx-1", code: "QWRT7K3M", activity: "word", participants: 4, capacity: 4, phase: "playing", ageSeconds: 1260, reconnectsLastHour: 1, issues: ["near_capacity"] },
      { roomId: "fx-2", code: "HNZP4XV8", activity: "watch", participants: 5, capacity: 8, phase: "watching", ageSeconds: 3400, reconnectsLastHour: 9, issues: ["high_reconnects"] },
      { roomId: "fx-3", code: "BC8DFG2H", activity: "riddle", participants: 2, capacity: 6, phase: "lobby", ageSeconds: 5400, reconnectsLastHour: 0, issues: ["stale_host"] },
    ];
    return {
      generatedAt: nowIso(),
      metrics: {
        activeUsers: 1284, activeRooms: 212 + this.rooms.size, playersInQueue: 37, matchesLastHour: 318,
        openReports: this.reports.filter((r) => r.status === "open").length, reconnectRate: 0.034,
      },
      hourlyMatches: Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now - (11 - i) * 3_600_000);
        return { hour: `${String(d.getHours()).padStart(2, "0")}:00`, matches: Math.round(180 + 140 * Math.sin((i / 11) * Math.PI) + (i % 3) * 12) };
      }),
      rooms: [...liveRooms, ...fixtureRooms],
      queues: [
        { gameId: "missing-word", title: "Missing Word", waiting: 21, medianWaitSeconds: 18, matchesLastHour: 190 },
        { gameId: "riddle-relay", title: "Riddle Relay", waiting: 16, medianWaitSeconds: 31, matchesLastHour: 128 },
      ],
    };
  }

  adminCatalog(): GameSummary[] {
    this.requireAdmin();
    return this.catalog;
  }

  adminUpdateGame(id: string, patch: Partial<Pick<GameSummary, "enabled" | "difficulties">>): GameSummary {
    this.requireAdmin();
    const game = this.catalog.find((g) => g.id === id) ?? fail("not_found", "Game not found.", 404);
    if (patch.difficulties && patch.difficulties.length === 0) fail("validation", "Keep at least one difficulty.", 422);
    Object.assign(game, patch);
    return game;
  }

  adminReports(status: ReportStatus): ModerationReport[] {
    this.requireAdmin();
    return this.reports.filter((r) => (status === "open" ? r.status === "open" : r.status !== "open"));
  }

  adminResolve(id: string, action: ModerationAction, note: string): ModerationReport {
    this.requireAdmin();
    const report = this.reports.find((r) => r.id === id) ?? fail("not_found", "Report not found.", 404);
    if (report.status !== "open") fail("conflict", "This report was already resolved.", 409);
    report.status = action === "dismiss" ? "dismissed" : "actioned";
    report.resolution = { action, note: note.trim(), at: nowIso() };
    return report;
  }

  adminFlags(): FeatureFlag[] {
    this.requireAdmin();
    return this.flags;
  }

  adminSetFlag(key: FeatureFlagKey, enabled: boolean): FeatureFlag {
    this.requireAdmin();
    const flag = this.flags.find((f) => f.key === key) ?? fail("not_found", "Unknown flag.", 404);
    flag.enabled = enabled;
    flag.updatedAt = nowIso();
    return flag;
  }

  /* =============================== realtime =============================== */

  connect(): SocketLike {
    this.requireSession();
    const socket = new MockSocket(this);
    this.sockets.add(socket);
    return socket;
  }

  detach(socket: MockSocket): void {
    this.sockets.delete(socket);
    const me = this.session?.user.id;
    for (const roomId of socket.rooms) {
      const rt = this.rooms.get(roomId);
      const p = rt?.room.participants.find((x) => x.user.id === me);
      if (rt && p && ![...this.sockets].some((s) => s.rooms.has(roomId))) {
        p.connection = "reconnecting";
        this.broadcast(rt, "presence.changed", { roomId, userId: p.user.id, connection: "reconnecting" });
      }
    }
  }

  private envelope<K extends ServerEventType>(type: K, payload: ServerEventMap[K], rt?: RoomRuntime): ServerEvent {
    return {
      id: crypto.randomUUID(), type, ts: nowIso(), payload,
      ...(rt ? { roomId: rt.room.id, seq: ++rt.seq } : {}),
    } as ServerEvent;
  }

  private broadcast<K extends ServerEventType>(rt: RoomRuntime, type: K, payload: ServerEventMap[K]): void {
    // structuredClone so later mutation of server state can't leak into
    // already-delivered events (as JSON over a wire would guarantee).
    const event = this.envelope(type, structuredClone(payload), rt);
    for (const s of this.sockets) if (s.rooms.has(rt.room.id)) s.deliver(event);
  }

  private ack(socket: MockSocket, replyTo: string, result: AckResult): void {
    socket.deliver(this.envelope("ack", { replyTo, ...result } as ServerEventMap["ack"]));
  }

  private rateLimited(rt: RoomRuntime, key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const hits = (rt.rate.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      rt.rate.set(key, hits);
      return true;
    }
    hits.push(now);
    rt.rate.set(key, hits);
    return false;
  }

  handleFrame(socket: MockSocket, data: string): void {
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(data) as ClientCommand;
    } catch {
      return;
    }
    const reply = (result: AckResult) => this.ack(socket, cmd.id, result);
    const err = (code: AckError["code"], message: string) => reply({ ok: false, error: { code, message } });
    let me: PublicUser;
    try {
      me = this.me();
    } catch {
      socket.close(4401, "session expired");
      return;
    }

    if (cmd.type === "matchmaking.watch") {
      const t = this.tickets.get(cmd.payload.ticketId);
      if (!t) return err("not_found", "Ticket not found");
      socket.tickets.add(t.ticket.ticketId);
      reply({ ok: true });
      if (t.phase === "matched" && t.roomCode) socket.deliver(this.envelope("matchmaking.matched", { ticketId: t.ticket.ticketId, roomCode: t.roomCode }));
      else socket.deliver(this.envelope("matchmaking.status", { ticketId: t.ticket.ticketId, phase: t.phase }));
      return;
    }

    const rt = this.rooms.get(cmd.payload.roomId);
    if (!rt) return err("not_found", "Room not found");
    const self = rt.room.participants.find((p) => p.user.id === me.id);
    if (!self) return err("forbidden", "You're not in this room");
    const isHost = rt.room.hostId === me.id;
    const room = rt.room;

    switch (cmd.type) {
      case "room.subscribe": {
        socket.rooms.add(room.id);
        reply({ ok: true });
        if (self.connection !== "online") {
          self.connection = "online";
          this.broadcast(rt, "presence.changed", { roomId: room.id, userId: me.id, connection: "online" });
        }
        const chat = rt.chat.filter((m) => !this.blocked.some((b) => b.id === m.author.id));
        // The snapshot carries the room's current seq; later broadcasts continue from it.
        socket.deliver({
          ...this.envelope("room.snapshot", structuredClone({ room, chat, game: rt.game?.state ?? null, watch: rt.watch })),
          roomId: room.id,
          seq: rt.seq,
        } as ServerEvent);
        return;
      }
      case "room.unsubscribe":
        socket.rooms.delete(room.id);
        return reply({ ok: true });
      case "room.set_ready":
        if (room.phase !== "lobby") return err("conflict", "You can only change ready status in the lobby");
        self.ready = cmd.payload.ready;
        reply({ ok: true });
        return this.bump(rt);
      case "room.update_settings": {
        if (!isHost) return err("forbidden", "Only the host can change room settings");
        if (room.phase !== "lobby") return err("conflict", "Return to the lobby to change settings");
        const capacity = cmd.payload.capacity ?? room.capacity;
        const activity = cmd.payload.activity ?? room.activity;
        if (capacity < room.participants.length) return err("validation", "Capacity can't be below the current number of people");
        try {
          this.validateActivity(activity, capacity);
        } catch (e) {
          return err("validation", e instanceof Error ? e.message : "Invalid settings");
        }
        const activityChanged = JSON.stringify(activity) !== JSON.stringify(room.activity);
        room.activity = activity;
        room.capacity = capacity;
        room.privacy = cmd.payload.privacy ?? room.privacy;
        if (activityChanged) {
          for (const p of room.participants) p.ready = p.role === "host";
          for (const p of room.participants) if (p.user.isBot) this.later(rt, rand(1000, 2500), () => this.botReady(rt, p.user.id));
        }
        reply({ ok: true });
        return this.bump(rt);
      }
      case "room.kick": {
        if (!isHost) return err("forbidden", "Only the host can remove people");
        if (cmd.payload.userId === me.id) return err("validation", "You can't remove yourself");
        const target = room.participants.find((p) => p.user.id === cmd.payload.userId);
        if (!target) return err("not_found", "That person already left");
        room.participants = room.participants.filter((p) => p !== target);
        reply({ ok: true });
        this.systemMessage(rt, `${target.user.displayName} was removed by the host.`);
        return this.bump(rt);
      }
      case "room.start": {
        if (!isHost) return err("forbidden", "Only the host can start");
        const replay = room.phase === "playing" && rt.game?.state.phase === "finished";
        if (room.phase !== "lobby" && !replay) return err("conflict", "An activity is already running");
        if (room.activity.kind === "watch") {
          room.phase = "watching";
          rt.watch = rt.watch ?? { source: null, status: "idle", positionSec: 0, rate: 1, updatedAt: nowIso(), controlPolicy: "host" };
          reply({ ok: true });
          this.bump(rt);
          this.broadcast(rt, "watch.state", { roomId: room.id, state: rt.watch });
          return this.systemMessage(rt, "Watch Together started.");
        }
        const game = this.catalog.find((g) => g.id === room.activity.gameId);
        if (!game || !game.enabled) return err("validation", "This game is unavailable");
        if (room.participants.length < game.minPlayers) return err("validation", `Need at least ${game.minPlayers} players`);
        if (!replay && room.participants.some((p) => p.role !== "host" && !p.ready)) return err("conflict", "Everyone needs to be ready");
        reply({ ok: true });
        return this.startGame(rt, game);
      }
      case "room.end_activity": {
        if (!isHost) return err("forbidden", "Only the host can end the activity");
        for (const t of rt.timers) clearTimeout(t);
        rt.timers.clear();
        room.phase = "lobby";
        rt.game = null;
        if (rt.watch) rt.watch = { ...rt.watch, status: "paused", updatedAt: nowIso() };
        for (const p of room.participants) p.ready = p.role === "host";
        for (const p of room.participants) if (p.user.isBot) this.later(rt, rand(1000, 2500), () => this.botReady(rt, p.user.id));
        reply({ ok: true });
        this.systemMessage(rt, "Back to the lobby.");
        return this.bump(rt);
      }
      case "chat.send": {
        if (!this.flagOn("chat")) return err("forbidden", "Chat is disabled");
        const existing = rt.chat.find((m) => m.clientMsgId === cmd.payload.clientMsgId && m.author.id === me.id);
        if (existing) return reply({ ok: true, data: { messageId: existing.id } }); // idempotent retry
        const raw = String(cmd.payload.text ?? "").trim();
        if (!raw || raw.length > 300) return err("validation", "Messages must be 1–300 characters");
        if (this.rateLimited(rt, `chat:${me.id}`, 5, 10_000)) return err("rate_limited", "Slow down — you can send 5 messages every 10 seconds");
        const text = this.privacy.chatFilter === "strict" ? raw.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link removed]") : raw;
        const message: ChatMessage = { id: uid("msg"), clientMsgId: cmd.payload.clientMsgId, roomId: room.id, author: me, kind: "user", text, sentAt: nowIso() };
        reply({ ok: true, data: { messageId: message.id } });
        return this.pushChat(rt, message);
      }
      case "reaction.send":
        if (!this.flagOn("reactions")) return err("forbidden", "Reactions are disabled");
        if (this.rateLimited(rt, `react:${me.id}`, 8, 10_000)) return err("rate_limited", "Easy there — too many reactions");
        reply({ ok: true });
        return this.broadcast(rt, "reaction", { roomId: room.id, userId: me.id, reaction: cmd.payload.reaction });
      case "game.submit": {
        const result = this.gradeRound(rt, me.id, cmd.payload.round, cmd.payload.answer);
        if ("error" in result) return err(result.error.code, result.error.message);
        return reply({ ok: true, data: result });
      }
      case "watch.set_source":
      case "watch.control": {
        if (room.phase !== "watching" || !rt.watch) return err("conflict", "Watch Together isn't running");
        if (rt.watch.controlPolicy === "host" && !isHost) return err("forbidden", "Only the host controls playback");
        if (cmd.type === "watch.set_source") {
          const source = this.validateSource(cmd.payload.source);
          if (!source) return err("validation", "Use an https:// link to a video file you're allowed to share");
          rt.watch = { ...rt.watch, source, status: "paused", positionSec: 0, updatedAt: nowIso() };
          this.systemMessage(rt, `${me.displayName} loaded “${source.title}”.`);
        } else {
          const pos = Math.max(0, Number(cmd.payload.positionSec) || 0);
          if (!rt.watch.source) return err("conflict", "Choose something to watch first");
          const status = cmd.payload.action === "play" ? "playing" : cmd.payload.action === "pause" ? "paused" : rt.watch.status;
          rt.watch = { ...rt.watch, status, positionSec: pos, updatedAt: nowIso() };
        }
        reply({ ok: true });
        return this.broadcast(rt, "watch.state", { roomId: room.id, state: rt.watch });
      }
    }
  }

  private validateSource(source: WatchSource): WatchSource | null {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:") return null;
      const title = (source.title || url.pathname.split("/").pop() || "Shared video").slice(0, 120);
      return { kind: "url", url: url.toString(), title };
    } catch {
      return null;
    }
  }

  /* ============================== live games ============================== */

  private startGame(rt: RoomRuntime, game: GameSummary): void {
    for (const t of rt.timers) clearTimeout(t);
    rt.timers.clear();
    const difficulty = rt.room.activity.difficulty ?? "easy";
    const pool: RoundFixture[] = game.kind === "word" ? WORD_PUZZLES : RIDDLES;
    const fixtures = shuffle(pool.filter((p) => p.difficulty === difficulty)).slice(0, ROUNDS);
    const turnOrder = rt.room.participants.map((p) => p.user.id);
    rt.room.phase = "playing";
    rt.game = {
      fixtures, turnOrder, attempts: new Map(),
      state: {
        gameId: game.id, kind: game.kind, title: game.title, round: 0, totalRounds: fixtures.length,
        phase: "countdown", puzzle: null, turn: { mode: "simultaneous" },
        endsAt: new Date(Date.now() + COUNTDOWN_MS).toISOString(),
        scores: Object.fromEntries(turnOrder.map((id) => [id, 0])), solvedBy: [],
      },
    };
    this.bump(rt);
    this.systemMessage(rt, `${game.title} is starting!`);
    this.pushGame(rt);
    this.later(rt, COUNTDOWN_MS, () => this.startRound(rt, 1));
  }

  private roundMs(): number {
    return this.session?.profile.accessibility.extendedTimers ? ROUND_MS * 1.5 : ROUND_MS;
  }

  private startRound(rt: RoomRuntime, round: number): void {
    const g = rt.game;
    if (!g) return;
    const fixture = g.fixtures[round - 1];
    const present = rt.room.participants.map((p) => p.user.id);
    g.turnOrder = g.turnOrder.filter((id) => present.includes(id));
    const isTurns = this.catalog.find((c) => c.id === g.state.gameId)?.turnMode === "turns";
    const activeUserId = g.turnOrder[(round - 1) % Math.max(1, g.turnOrder.length)];
    g.attempts = new Map();
    g.state = {
      ...g.state, round, phase: "answering", puzzle: toPublic(fixture), solvedBy: [], lastReveal: undefined,
      turn: isTurns && activeUserId ? { mode: "turns", activeUserId } : { mode: "simultaneous" },
      endsAt: new Date(Date.now() + this.roundMs()).toISOString(),
    };
    this.pushGame(rt);
    this.later(rt, this.roundMs(), () => this.reveal(rt, round));

    for (const p of rt.room.participants) {
      if (!p.user.isBot) continue;
      if (g.state.turn.mode === "turns" && g.state.turn.activeUserId !== p.user.id) continue;
      const delay = g.state.turn.mode === "turns" ? rand(3000, 8000) : rand(4000, 14000);
      this.later(rt, delay, () => {
        if (!rt.game || rt.game.state.round !== round || rt.game.state.phase !== "answering") return;
        const turns = g.state.turn.mode === "turns";
        const correct = Math.random() < (turns ? 0.65 : 0.6);
        // A bot that misses on its turn passes, so the round doesn't stall.
        if (turns && !correct) g.attempts.set(p.user.id, MAX_ATTEMPTS - 1);
        this.gradeRound(rt, p.user.id, round, { kind: g.state.kind as "word" | "riddle", text: correct ? fixture.answers[0] : "?" });
      });
    }
  }

  private gradeRound(rt: RoomRuntime, userId: UserId, round: number, answer: PuzzleAnswer):
    { correct: boolean; attemptsLeft: number } | { error: AckError } {
    const g = rt.game;
    if (rt.room.phase !== "playing" || !g) return { error: { code: "conflict", message: "No game is running" } };
    if (g.state.phase !== "answering" || g.state.round !== round) return { error: { code: "conflict", message: "That round has ended" } };
    if (g.state.turn.mode === "turns" && g.state.turn.activeUserId !== userId) return { error: { code: "not_your_turn", message: "Wait for your turn" } };
    if (g.state.solvedBy.includes(userId)) return { error: { code: "conflict", message: "You already solved this round" } };
    if (answer.kind !== "word" && answer.kind !== "riddle") return { error: { code: "validation", message: "Wrong answer type" } };
    if (!answer.text.trim() || answer.text.length > 60) return { error: { code: "validation", message: "Enter an answer" } };
    const used = g.attempts.get(userId) ?? 0;
    if (used >= MAX_ATTEMPTS) return { error: { code: "conflict", message: "No attempts left this round" } };
    g.attempts.set(userId, used + 1);

    const fixture = g.fixtures[round - 1];
    const correct = matchesAnswer(answer.text, fixture.answers);
    if (correct) {
      const order = g.state.solvedBy.length;
      const points = g.state.turn.mode === "turns" ? 100 : [100, 70][order] ?? 50;
      g.state = { ...g.state, solvedBy: [...g.state.solvedBy, userId], scores: { ...g.state.scores, [userId]: (g.state.scores[userId] ?? 0) + points } };
      this.pushGame(rt);
    }
    const attemptsLeft = MAX_ATTEMPTS - (used + 1);
    const everyoneDone =
      g.state.turn.mode === "turns"
        ? correct || attemptsLeft === 0
        : rt.room.participants.every((p) => g.state.solvedBy.includes(p.user.id) || (g.attempts.get(p.user.id) ?? 0) >= MAX_ATTEMPTS);
    if (everyoneDone) this.later(rt, 600, () => this.reveal(rt, round));
    return { correct, attemptsLeft };
  }

  private reveal(rt: RoomRuntime, round: number): void {
    const g = rt.game;
    if (!g || g.state.round !== round || g.state.phase !== "answering") return;
    const fixture = g.fixtures[round - 1];
    const last = round >= g.state.totalRounds;
    g.state = {
      ...g.state, phase: "reveal", lastReveal: { solution: fixture.answers[0], correctUserIds: g.state.solvedBy },
      endsAt: new Date(Date.now() + REVEAL_MS).toISOString(),
    };
    this.pushGame(rt);
    this.later(rt, REVEAL_MS, () => {
      if (!rt.game) return;
      if (last) {
        rt.game.state = { ...rt.game.state, phase: "finished", endsAt: null, puzzle: null };
        this.pushGame(rt);
        this.systemMessage(rt, "Game over — check the scoreboard!");
      } else this.startRound(rt, round + 1);
    });
  }

  private pushGame(rt: RoomRuntime): void {
    if (rt.game) this.broadcast(rt, "game.state", { roomId: rt.room.id, state: rt.game.state });
  }
}

/** Strips solutions before anything reaches the client. */
function toPublic(item: SoloRuntime["items"][number] | undefined): PublicPuzzle {
  if (!item) throw new ApiError("server", "Missing puzzle");
  if ("template" in item) return { kind: "word", id: item.id, prompt: item.prompt, template: item.template, letters: item.answers[0].length };
  if ("text" in item) return { kind: "riddle", id: item.id, text: item.text };
  if ("givens" in item) return { kind: "logic", id: item.id, size: 4, givens: item.givens, rules: "Fill every cell with 1–4. Each row, column and 2×2 box contains each number exactly once." };
  return {
    kind: "mystery", id: item.id, title: item.title, briefing: item.briefing, suspects: item.suspects,
    clues: item.clues.map(({ id, title, location }) => ({ id, title, location })),
    methods: item.methods, motives: item.motives,
  };
}
