from sdlib import QUALITY, NEG_MODEL, NEG_POLICY

PERSON = ("1girl, solo, safe, (adult woman)1.2, mature female, 25 years old, tall, slender, medium breasts, long legs, "
          "dark brown hair, medium hair, straight hair, side-swept bangs, hair behind ear, shiny hair, brown eyes, "
          "beautiful detailed eyes, long eyelashes, beautiful face, light blush, small mole under eye")
POSE = "looking at viewer, standing, full body, straight-on, facing viewer, arms at sides, simple background, (white background)1.2"
SHOES = "beige flat shoes"
TAIL = "game cg, anime coloring, newest, " + QUALITY

CLOTHES = {
 0: "(navy blue beret)1.15, (red scarf)1.1, (beige trench coat)1.3, (open coat)1.1, belted coat, (dark blue blazer)1.15, white blouse, collared shirt, (grey pleated skirt)1.2, (knee-length skirt)1.1",
 1: "no headwear, beige trench coat, open coat, belted coat, (dark blue blazer)1.3, white blouse, collared shirt, (grey pleated skirt)1.2, knee-length skirt",
 2: "(dark blue blazer)1.3, open blazer, white blouse, collared shirt, (grey pleated skirt)1.2, knee-length skirt",
 3: "white blouse, collared shirt, long sleeves, (grey pleated skirt)1.2, knee-length skirt",
 4: "(navy blue bikini)1.2, (polka dot bikini)1.2, white polka dots, (frilled bikini)1.3, white frills, white trim, halterneck, (side-tie bikini bottom)1.1, white bow, bikini top, bikini bottom, swimsuit, bare arms, bare legs, bare shoulders, navel",
}
NEG_STAGE = {
 0: "", 1: "hat, beret, scarf, headwear", 2: "coat, trench coat, scarf, hat",
 3: "blazer, jacket, coat, scarf, hat, vest",
 4: "nude, nipples, areola, see-through, micro bikini, sling bikini, thong, highleg, underboob, sideboob, nsfw, cleavage, blouse, skirt, shirt, jacket, sarong, one-piece swimsuit",
}
EXPR = {
 "normal": ("smile, closed mouth", ""),
 "happy": ("(happy)1.2, (closed eyes)1.2, ^_^, (smile)1.2, open mouth, :d, laughing, eyelashes", "crying, frown, tears, sad"),
 "shy": ("(blush)1.3, nose blush, embarrassed, shy, (looking to the side)1.3, (looking away)1.2, light smile, closed mouth", "open mouth, laughing, looking at viewer"),
 "sad": ("(sad)1.3, (frown)1.2, furrowed brow, (worried)1.2, downturned eyes, closed mouth, troubled eyebrows", "smile, tears, crying, open mouth, happy"),
 "pout": ("(pout)1.3, :t, (puffed cheeks)1.2, annoyed, slight blush, closed mouth, furrowed brow", "smile, open mouth, happy"),
}
NEG_EXTRA = "star-shaped pupils, symbol-shaped pupils, sparkle, grey background, gradient background, pantyhose, black legwear, boots, miniskirt, white headwear, beige skirt, white skirt, long skirt, pencil skirt, miniskirt, high heels, shadow, multiple views, reference sheet, hands in pockets, holding, bag, hand up, crossed arms"


def prompt(stage, expr="normal"):
    e = EXPR[expr][0]
    pose = POSE if expr != "shy" else POSE.replace("looking at viewer, ", "")
    return f"{PERSON}, {CLOTHES[stage]}, {SHOES}, {e}, {pose}, {TAIL}"


def neg(stage, expr="normal"):
    parts = [NEG_MODEL, NEG_POLICY, NEG_EXTRA, NEG_STAGE[stage], EXPR[expr][1]]
    return ", ".join(p for p in parts if p)
