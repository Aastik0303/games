/**
 * ⚠️ DEVELOPMENT FIXTURES — only reachable through the mock adapter.
 * Nothing here is real user data. Solutions live here because the mock
 * adapter plays the role of the server; the UI never imports this file.
 */
import type {
  Difficulty,
  FeatureFlag,
  GameSummary,
  ModerationReport,
  PublicUser,
  Suspect,
  ClueStub,
  WatchSource,
} from "../types";

export const FIXTURE_NOTICE = "Mock data — not connected to a Prism server.";

export const CATALOG: GameSummary[] = [
  {
    id: "missing-word",
    kind: "word",
    title: "Missing Word",
    tagline: "Fill the gap in famous sayings before anyone else.",
    category: "Word",
    difficulties: ["easy", "medium"],
    modes: ["solo", "multiplayer"],
    turnMode: "simultaneous",
    minPlayers: 2,
    maxPlayers: 8,
    estMinutes: 5,
    enabled: true,
  },
  {
    id: "riddle-relay",
    kind: "riddle",
    title: "Riddle Relay",
    tagline: "Take turns cracking riddles while the room watches.",
    category: "Riddle",
    difficulties: ["easy", "medium"],
    modes: ["solo", "multiplayer"],
    turnMode: "turns",
    minPlayers: 2,
    maxPlayers: 6,
    estMinutes: 8,
    enabled: true,
  },
  {
    id: "mini-grid",
    kind: "logic",
    title: "Mini Grid",
    tagline: "A 4×4 number logic puzzle. Calm, clean deduction.",
    category: "Logic",
    difficulties: ["easy", "medium", "hard"],
    modes: ["solo"],
    minPlayers: 1,
    maxPlayers: 1,
    estMinutes: 4,
    enabled: true,
  },
  {
    id: "wrenfield-manor",
    kind: "mystery",
    title: "Death at Wrenfield Manor",
    tagline: "A blackout, a cup of tea, four suspects. Inspect clues and name the culprit.",
    category: "Mystery",
    difficulties: ["medium"],
    modes: ["solo"],
    minPlayers: 1,
    maxPlayers: 1,
    estMinutes: 12,
    enabled: true,
  },
];

export interface TextPuzzleFixture {
  id: string;
  difficulty: Difficulty;
  answers: string[];
  hint: string;
}

export interface WordFixture extends TextPuzzleFixture {
  prompt: string;
  template: string;
}

export interface RiddleFixture extends TextPuzzleFixture {
  text: string;
}

export const WORD_PUZZLES: WordFixture[] = [
  { id: "w1", difficulty: "easy", prompt: "Complete the proverb", template: "Actions speak louder than ___.", answers: ["words"], hint: "What you say, as opposed to what you do." },
  { id: "w2", difficulty: "easy", prompt: "Complete the proverb", template: "The early bird catches the ___.", answers: ["worm"], hint: "It lives in the soil." },
  { id: "w3", difficulty: "easy", prompt: "Complete the proverb", template: "Every cloud has a silver ___.", answers: ["lining"], hint: "The inside layer of a coat." },
  { id: "w4", difficulty: "easy", prompt: "Complete the saying", template: "Better late than ___.", answers: ["never"], hint: "The opposite of always." },
  { id: "w5", difficulty: "easy", prompt: "Complete the proverb", template: "Don't count your chickens before they ___.", answers: ["hatch"], hint: "What eggs eventually do." },
  { id: "w6", difficulty: "medium", prompt: "Complete the proverb", template: "A rolling stone gathers no ___.", answers: ["moss"], hint: "It grows on the shady side of trees." },
  { id: "w7", difficulty: "medium", prompt: "Complete the saying", template: "The pen is mightier than the ___.", answers: ["sword"], hint: "A knight carries one." },
  { id: "w8", difficulty: "medium", prompt: "Complete the proverb", template: "Fortune favours the ___.", answers: ["bold", "brave"], hint: "Daring." },
  { id: "w9", difficulty: "medium", prompt: "Complete the proverb", template: "Necessity is the mother of ___.", answers: ["invention"], hint: "What a patent protects." },
  { id: "w10", difficulty: "medium", prompt: "Complete the proverb", template: "Still waters run ___.", answers: ["deep"], hint: "The opposite of shallow." },
];

export const RIDDLES: RiddleFixture[] = [
  { id: "r1", difficulty: "easy", text: "What has keys but can't open locks?", answers: ["piano", "keyboard"], hint: "It usually has 88 of them." },
  { id: "r2", difficulty: "easy", text: "The more of these you take, the more you leave behind. What are they?", answers: ["footsteps", "footstep", "steps"], hint: "Take a walk on a beach." },
  { id: "r3", difficulty: "easy", text: "What has to be broken before you can use it?", answers: ["egg"], hint: "Think breakfast." },
  { id: "r4", difficulty: "easy", text: "What gets wetter the more it dries?", answers: ["towel"], hint: "You'll find it in a bathroom." },
  { id: "r5", difficulty: "easy", text: "What has a neck but no head?", answers: ["bottle"], hint: "Messages travel in one at sea." },
  { id: "r6", difficulty: "medium", text: "I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?", answers: ["echo"], hint: "Shout into a canyon." },
  { id: "r7", difficulty: "medium", text: "What can travel around the world while staying in a corner?", answers: ["stamp", "postage stamp"], hint: "Look at an envelope." },
  { id: "r8", difficulty: "medium", text: "I have cities but no houses, forests but no trees, and water but no fish. What am I?", answers: ["map"], hint: "Explorers fold it." },
  { id: "r9", difficulty: "medium", text: "What can you catch, but not throw?", answers: ["cold"], hint: "Achoo." },
  { id: "r10", difficulty: "medium", text: "What has a head and a tail but no body?", answers: ["coin"], hint: "Flip it." },
];

export interface LogicFixture {
  id: string;
  difficulty: Difficulty;
  givens: (number | null)[][];
  solution: number[][];
}

const _ = null;

export const LOGIC_PUZZLES: LogicFixture[] = [
  {
    id: "g1", difficulty: "easy",
    givens: [[1, _, _, 4], [_, 4, 1, _], [2, _, _, 3], [_, 3, 2, _]],
    solution: [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]],
  },
  {
    id: "g2", difficulty: "easy",
    givens: [[4, _, 2, _], [_, 1, _, 3], [3, _, 1, _], [_, 2, _, 4]],
    solution: [[4, 3, 2, 1], [2, 1, 4, 3], [3, 4, 1, 2], [1, 2, 3, 4]],
  },
  {
    id: "g3", difficulty: "medium",
    givens: [[_, 1, _, _], [4, _, _, 1], [_, _, 3, _], [3, _, _, 4]],
    solution: [[2, 1, 4, 3], [4, 3, 2, 1], [1, 4, 3, 2], [3, 2, 1, 4]],
  },
  {
    id: "g4", difficulty: "medium",
    givens: [[_, 3, _, _], [2, _, _, 3], [_, _, 1, _], [1, _, _, 2]],
    solution: [[4, 3, 2, 1], [2, 1, 4, 3], [3, 2, 1, 4], [1, 4, 3, 2]],
  },
  {
    id: "g5", difficulty: "hard",
    givens: [[_, 4, _, _], [_, _, 3, _], [_, 3, _, _], [_, _, _, 3]],
    solution: [[3, 4, 1, 2], [1, 2, 3, 4], [4, 3, 2, 1], [2, 1, 4, 3]],
  },
  {
    id: "g6", difficulty: "hard",
    givens: [[_, _, 4, _], [4, _, _, _], [_, 3, _, _], [_, _, _, 3]],
    solution: [[3, 1, 4, 2], [4, 2, 3, 1], [1, 3, 2, 4], [2, 4, 1, 3]],
  },
];

export interface MysteryFixture {
  id: string;
  title: string;
  briefing: string;
  suspects: Suspect[];
  clues: (ClueStub & { detail: string })[];
  methods: string[];
  motives: string[];
  solution: { suspectId: string; method: string; motive: string; explanation: string };
}

export const MYSTERY: MysteryFixture = {
  id: "wrenfield",
  title: "Death at Wrenfield Manor",
  briefing:
    "At 9:40 pm, during a thunderstorm, the lights at Wrenfield Manor went out for two minutes. When they came back, the collector Augustin Wrenfield was found slumped over his desk in the study. The coroner confirms a fatal dose of digitalis taken with his evening tea. The study's French window was latched from the inside. Four people were in the house.",
  suspects: [
    { id: "margot", name: "Margot Wrenfield", role: "Niece and botanist", statement: "I was in the greenhouse checking the seedlings when the lights failed. I grow foxglove, yes — half the county does." },
    { id: "hale", name: "Dr. Felix Hale", role: "Family physician", statement: "I'd stopped by to check on Augustin's heart. I was reading in the library all evening." },
    { id: "iris", name: "Iris Calloway", role: "Housekeeper", statement: "I brought his tea at half past nine, same as every night. I poured it from the pot myself." },
    { id: "tobias", name: "Tobias Reed", role: "Art dealer, house guest", statement: "I was on the telephone in the hall. Ask anyone — I had to shout over the storm." },
  ],
  clues: [
    { id: "tray", title: "The tea tray", location: "Study", detail: "The teapot tests clean. Digitalis is present in the cup and in a small jar of honey with a pharmacy label. Iris says the kitchen keeps no honey." },
    { id: "label", title: "Honey jar label", location: "Study", detail: "A neat handwritten label: “For A.W. — one spoonful nightly for the throat. F.H.”" },
    { id: "greenhouse", title: "Greenhouse beds", location: "Greenhouse", detail: "Margot's foxglove beds are untouched and her cutting log is complete. Digitalis, however, is also sold as a prescription heart medicine." },
    { id: "bag", title: "Physician's bag", location: "Library", detail: "Dr. Hale's bag holds an empty vial labelled “digoxin” — a heart medicine derived from foxglove. He says he used it on a patient yesterday, but his visit book shows no such patient." },
    { id: "letter", title: "Unfinished letter", location: "Study desk", detail: "A draft from Augustin to the Medical Council: “…I can no longer stay silent about Dr. Hale's prescriptions to my late sister…”" },
    { id: "phone", title: "Telephone log", location: "Hall", detail: "The exchange confirms a call from the manor's hall line from 9:35 to 9:52 pm. The butler heard Tobias shouting the whole time." },
    { id: "notice", title: "Dismissal notice", location: "Housekeeper's room", detail: "A notice dismissing Iris next month — but Augustin has written across it: “Reconsider. She deserves better.”" },
    { id: "will", title: "The will", location: "Solicitor's copy", detail: "Margot inherits only the greenhouse. The rest of the estate goes to a hospital charity." },
  ],
  methods: ["Poison in the teapot", "Poison in the honey jar", "Poison in the sugar bowl", "Poison added directly to the cup"],
  motives: ["To secure an inheritance", "To silence a report of malpractice", "Revenge for a dismissal", "A dispute over a forged painting"],
  solution: {
    suspectId: "hale",
    method: "Poison in the honey jar",
    motive: "To silence a report of malpractice",
    explanation:
      "Dr. Hale gave Augustin a jar of 'throat honey' laced with digoxin from his own bag. The teapot was clean, the label is in Hale's hand, and Augustin's unfinished letter to the Medical Council gave Hale every reason to act. Tobias was on the phone; Iris's dismissal had been reconsidered; Margot gained only the greenhouse.",
  },
};

export const BOTS: PublicUser[] = [
  { id: "bot-nova", displayName: "Nova", avatarHue: 268, isBot: true },
  { id: "bot-quill", displayName: "Quill", avatarHue: 190, isBot: true },
  { id: "bot-orbit", displayName: "Orbit", avatarHue: 320, isBot: true },
  { id: "bot-juniper", displayName: "Juniper", avatarHue: 150, isBot: true },
  { id: "bot-pixel", displayName: "Pixel", avatarHue: 40, isBot: true },
];

export const BOT_LINES = ["hi all 👋", "ready when you are", "good luck!", "ooh this one's tricky", "nice one!", "gg"];

/**
 * External sample media (Big Buck Bunny, © Blender Foundation, CC BY 3.0, via
 * Wikimedia Commons). The URL is third-party and may become unavailable; the player handles that.
 */
export const SAMPLE_WATCH_SOURCES: WatchSource[] = [
  {
    kind: "url",
    title: "Big Buck Bunny — Blender Foundation (CC BY 3.0)",
    url: "https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.480p.vp9.webm",
  },
];

export function initialFlags(now: string): FeatureFlag[] {
  return [
    { key: "multiplayer", description: "Matchmaking and multiplayer game rooms", enabled: true, updatedAt: now },
    { key: "watchTogether", description: "Synchronized Watch Together rooms", enabled: true, updatedAt: now },
    { key: "screenShare", description: "Browser screen-share capture (local preview until media server exists)", enabled: true, updatedAt: now },
    { key: "reactions", description: "Emoji reactions in rooms", enabled: true, updatedAt: now },
    { key: "chat", description: "Text chat in rooms", enabled: true, updatedAt: now },
  ];
}

export function initialReports(now: number): ModerationReport[] {
  const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  return [
    {
      id: "rep-1001", reason: "harassment", status: "open", priority: "high",
      target: { id: "u-fixture-1", displayName: "SampleUserA", avatarHue: 10 },
      reporterId: "u-fixture-2", roomCode: "QWRT7K3M", messageExcerpt: "[fixture message excerpt]",
      details: "Repeated insults after losing a round.", createdAt: iso(12),
    },
    {
      id: "rep-1002", reason: "spam", status: "open", priority: "normal",
      target: { id: "u-fixture-3", displayName: "SampleUserB", avatarHue: 200 },
      reporterId: "u-fixture-4", roomCode: "HNZP4XV8", messageExcerpt: "[fixture link spam]",
      createdAt: iso(47),
    },
    {
      id: "rep-1003", reason: "personal_info", status: "open", priority: "high",
      target: { id: "u-fixture-5", displayName: "SampleUserC", avatarHue: 120 },
      reporterId: "u-fixture-6", roomCode: "BC8DFG2H",
      details: "Asked a younger player for their school name.", createdAt: iso(95),
    },
    {
      id: "rep-0997", reason: "cheating", status: "dismissed", priority: "normal",
      target: { id: "u-fixture-7", displayName: "SampleUserD", avatarHue: 300 },
      reporterId: "u-fixture-8", createdAt: iso(600),
      resolution: { action: "dismiss", note: "No evidence in round logs.", at: iso(540) },
    },
  ];
}
