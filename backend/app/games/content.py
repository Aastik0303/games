"""Puzzle content. Answer keys live only on the server.

Bump ``CONTENT_VERSION`` whenever an item's text or answer changes: sessions
store the version and item ids they were dealt, so a session can be replayed
and audited against exactly the content it used.

Every item is reviewed for a 13+ audience (no violence beyond the mystery's
off-screen poisoning, no sexual content, no real people).
"""

from __future__ import annotations

from dataclasses import dataclass, field

CONTENT_VERSION = "2026.10.1"


@dataclass(frozen=True)
class TextItem:
    id: str
    difficulty: str
    answers: tuple[str, ...]
    hint: str
    # word puzzles
    prompt: str = ""
    template: str = ""
    # riddles
    text: str = ""


@dataclass(frozen=True)
class LogicItem:
    id: str
    difficulty: str
    givens: tuple[tuple[int | None, ...], ...]
    solution: tuple[tuple[int, ...], ...]


@dataclass(frozen=True)
class Clue:
    id: str
    title: str
    location: str
    detail: str


@dataclass(frozen=True)
class MysteryItem:
    id: str
    difficulty: str
    title: str
    briefing: str
    suspects: tuple[dict[str, str], ...]
    clues: tuple[Clue, ...]
    methods: tuple[str, ...]
    motives: tuple[str, ...]
    solution_suspect: str
    solution_method: str
    solution_motive: str
    explanation: str
    hints: tuple[str, ...] = field(default_factory=tuple)


def _w(id: str, difficulty: str, prompt: str, template: str, answers: tuple[str, ...], hint: str) -> TextItem:
    return TextItem(id=id, difficulty=difficulty, prompt=prompt, template=template, answers=answers, hint=hint)


def _r(id: str, difficulty: str, text: str, answers: tuple[str, ...], hint: str) -> TextItem:
    return TextItem(id=id, difficulty=difficulty, text=text, answers=answers, hint=hint)


WORD_ITEMS: tuple[TextItem, ...] = (
    _w(
        "w1",
        "easy",
        "Complete the proverb",
        "Actions speak louder than ___.",
        ("words",),
        "What you say, as opposed to what you do.",
    ),
    _w("w2", "easy", "Complete the proverb", "The early bird catches the ___.", ("worm",), "It lives in the soil."),
    _w("w3", "easy", "Complete the proverb", "Every cloud has a silver ___.", ("lining",), "The inside layer of a coat."),
    _w("w4", "easy", "Complete the saying", "Better late than ___.", ("never",), "The opposite of always."),
    _w(
        "w5", "easy", "Complete the proverb", "Don't count your chickens before they ___.", ("hatch",), "What eggs eventually do."
    ),
    _w(
        "w6",
        "medium",
        "Complete the proverb",
        "A rolling stone gathers no ___.",
        ("moss",),
        "It grows on the shady side of trees.",
    ),
    _w("w7", "medium", "Complete the saying", "The pen is mightier than the ___.", ("sword",), "A knight carries one."),
    _w("w8", "medium", "Complete the proverb", "Fortune favours the ___.", ("bold", "brave"), "Daring."),
    _w("w9", "medium", "Complete the proverb", "Necessity is the mother of ___.", ("invention",), "What a patent protects."),
    _w("w10", "medium", "Complete the proverb", "Still waters run ___.", ("deep",), "The opposite of shallow."),
)

RIDDLE_ITEMS: tuple[TextItem, ...] = (
    _r("r1", "easy", "What has keys but can't open locks?", ("piano", "keyboard"), "It usually has 88 of them."),
    _r(
        "r2",
        "easy",
        "The more of these you take, the more you leave behind. What are they?",
        ("footsteps", "footstep", "steps"),
        "Take a walk on a beach.",
    ),
    _r("r3", "easy", "What has to be broken before you can use it?", ("egg",), "Think breakfast."),
    _r("r4", "easy", "What gets wetter the more it dries?", ("towel",), "You'll find it in a bathroom."),
    _r("r5", "easy", "What has a neck but no head?", ("bottle",), "Messages travel in one at sea."),
    _r(
        "r6",
        "medium",
        "I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?",
        ("echo",),
        "Shout into a canyon.",
    ),
    _r(
        "r7",
        "medium",
        "What can travel around the world while staying in a corner?",
        ("stamp", "postage stamp"),
        "Look at an envelope.",
    ),
    _r(
        "r8",
        "medium",
        "I have cities but no houses, forests but no trees, and water but no fish. What am I?",
        ("map",),
        "Explorers fold it.",
    ),
    _r("r9", "medium", "What can you catch, but not throw?", ("cold",), "Achoo."),
    _r("r10", "medium", "What has a head and a tail but no body?", ("coin",), "Flip it."),
)

_ = None
LOGIC_ITEMS: tuple[LogicItem, ...] = (
    LogicItem(
        "g1",
        "easy",
        ((1, _, _, 4), (_, 4, 1, _), (2, _, _, 3), (_, 3, 2, _)),
        ((1, 2, 3, 4), (3, 4, 1, 2), (2, 1, 4, 3), (4, 3, 2, 1)),
    ),
    LogicItem(
        "g2",
        "easy",
        ((4, _, 2, _), (_, 1, _, 3), (3, _, 1, _), (_, 2, _, 4)),
        ((4, 3, 2, 1), (2, 1, 4, 3), (3, 4, 1, 2), (1, 2, 3, 4)),
    ),
    LogicItem(
        "g3",
        "medium",
        ((_, 1, _, _), (4, _, _, 1), (_, _, 3, _), (3, _, _, 4)),
        ((2, 1, 4, 3), (4, 3, 2, 1), (1, 4, 3, 2), (3, 2, 1, 4)),
    ),
    LogicItem(
        "g4",
        "medium",
        ((_, 3, _, _), (2, _, _, 3), (_, _, 1, _), (1, _, _, 2)),
        ((4, 3, 2, 1), (2, 1, 4, 3), (3, 2, 1, 4), (1, 4, 3, 2)),
    ),
    LogicItem(
        "g5",
        "hard",
        ((_, 4, 1, _), (_, _, 3, _), (_, 3, _, _), (2, _, _, 3)),
        ((3, 4, 1, 2), (1, 2, 3, 4), (4, 3, 2, 1), (2, 1, 4, 3)),
    ),
    LogicItem(
        "g6",
        "hard",
        ((_, 1, 4, _), (4, _, _, _), (1, 3, _, _), (_, _, _, 3)),
        ((3, 1, 4, 2), (4, 2, 3, 1), (1, 3, 2, 4), (2, 4, 1, 3)),
    ),
)

LOGIC_RULES = "Fill every cell with 1–4. Each row, column and 2×2 box contains each number exactly once."

WRENFIELD = MysteryItem(
    id="wrenfield",
    difficulty="medium",
    title="Death at Wrenfield Manor",
    briefing=(
        "At 9:40 pm, during a thunderstorm, the lights at Wrenfield Manor went out for two minutes. When they came "
        "back, the collector Augustin Wrenfield was found slumped over his desk in the study. The coroner confirms a "
        "fatal dose of digitalis taken with his evening tea. The study's French window was latched from the inside. "
        "Four people were in the house."
    ),
    suspects=(
        {
            "id": "margot",
            "name": "Margot Wrenfield",
            "role": "Niece and botanist",
            "statement": "I was in the greenhouse checking the seedlings when the lights failed. I grow foxglove, yes — "
            "half the county does.",
        },
        {
            "id": "hale",
            "name": "Dr. Felix Hale",
            "role": "Family physician",
            "statement": "I'd stopped by to check on Augustin's heart. I was reading in the library all evening.",
        },
        {
            "id": "iris",
            "name": "Iris Calloway",
            "role": "Housekeeper",
            "statement": "I brought his tea at half past nine, same as every night. I poured it from the pot myself.",
        },
        {
            "id": "tobias",
            "name": "Tobias Reed",
            "role": "Art dealer, house guest",
            "statement": "I was on the telephone in the hall. Ask anyone — I had to shout over the storm.",
        },
    ),
    clues=(
        Clue(
            "tray",
            "The tea tray",
            "Study",
            "The teapot tests clean. Digitalis is present in the cup and in a small jar of honey with a pharmacy "
            "label. Iris says the kitchen keeps no honey.",
        ),
        Clue(
            "label",
            "Honey jar label",
            "Study",
            "A neat handwritten label: “For A.W. — one spoonful nightly for the throat. F.H.”",
        ),
        Clue(
            "greenhouse",
            "Greenhouse beds",
            "Greenhouse",
            "Margot's foxglove beds are untouched and her cutting log is complete. Digitalis, however, is also sold "
            "as a prescription heart medicine.",
        ),
        Clue(
            "bag",
            "Physician's bag",
            "Library",
            "Dr. Hale's bag holds an empty vial labelled “digoxin” — a heart medicine derived from foxglove. He says "
            "he used it on a patient yesterday, but his visit book shows no such patient.",
        ),
        Clue(
            "letter",
            "Unfinished letter",
            "Study desk",
            "A draft from Augustin to the Medical Council: “…I can no longer stay silent about Dr. Hale's "
            "prescriptions to my late sister…”",
        ),
        Clue(
            "phone",
            "Telephone log",
            "Hall",
            "The exchange confirms a call from the manor's hall line from 9:35 to 9:52 pm. The butler heard Tobias "
            "shouting the whole time.",
        ),
        Clue(
            "notice",
            "Dismissal notice",
            "Housekeeper's room",
            "A notice dismissing Iris next month — but Augustin has written across it: “Reconsider. She deserves better.”",
        ),
        Clue(
            "will",
            "The will",
            "Solicitor's copy",
            "Margot inherits only the greenhouse. The rest of the estate goes to a hospital charity.",
        ),
    ),
    methods=("Poison in the teapot", "Poison in the honey jar", "Poison in the sugar bowl", "Poison added directly to the cup"),
    motives=(
        "To secure an inheritance",
        "To silence a report of malpractice",
        "Revenge for a dismissal",
        "A dispute over a forged painting",
    ),
    solution_suspect="hale",
    solution_method="Poison in the honey jar",
    solution_motive="To silence a report of malpractice",
    explanation=(
        "Dr. Hale gave Augustin a jar of 'throat honey' laced with digoxin from his own bag. The teapot was clean, "
        "the label is in Hale's hand, and Augustin's unfinished letter to the Medical Council gave Hale every reason "
        "to act. Tobias was on the phone; Iris's dismissal had been reconsidered; Margot gained only the greenhouse."
    ),
    hints=(
        "Ask who could have supplied whatever was poisoned — and whose handwriting is on it.",
        "Rule out anyone with a confirmed alibi during the blackout.",
        "A motive is strongest when someone was about to expose the culprit.",
    ),
)

MYSTERY_ITEMS: tuple[MysteryItem, ...] = (WRENFIELD,)
