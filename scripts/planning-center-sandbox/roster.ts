/** One-time browser bootstrap: the public Services API cannot create people or positions. */
export const sandboxPeople = {
  jake: "188326189",
  avery: "203771583",
  morgan: "203771585",
  riley: "203771587",
  casey: "203771591",
} as const;

export const sandboxPositions = {
  vocals: "40064760",
  guitar: "40064761",
  keys: "40064762",
  audio: "40064763",
} as const;
