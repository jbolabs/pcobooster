/**
 * The rocket logo's shapes in its own unrotated space, where the nose points along +x.
 * `ROCKET_TILT` turns that space to the logo's 45° climb, so motion written as
 * `translateX` inside it always follows the nose.
 */
export const ROCKET_VIEW_BOX = "46 42 168 168";

export const ROCKET_TILT =
  "translate(128 128) rotate(-45) scale(1.12) translate(-128 -128)";

export const ROCKET_HULL_PATH =
  "M121 103C158 89 196 100 219 122Q225 128 219 134C196 156 158 167 121 153Q112 149 112 140V116Q112 107 121 103Z";

export const ROCKET_FIN_PATHS = [
  "M150 104C137 90 127 83 118 82Q112 82 112 89V104Z",
  "M150 152C137 166 127 173 118 174Q112 174 112 167V152Z",
] as const;

export const ROCKET_WINDOW = { cx: 176, cy: 128, r: 13 } as const;

/**
 * The three exhaust flutes. `endX` is where each bar stops behind the hull (the middle one
 * is recessed, as in the logo); `y` is its centerline. Bars are 12 units thick with round
 * ends, and each dot sits one 6-unit gap past its bar.
 */
export const ROCKET_FLUTES = [
  { y: 110, endX: 104 },
  { y: 128, endX: 98 },
  { y: 146, endX: 104 },
] as const;

/** The logo's bar length, measured between the centers of its round ends. */
export const ROCKET_FLUTE_LENGTH = 21;
