/** Unknown is explicit: absence of evidence must never be reported as direct. */
export type ProxyPathAssessment = "unknown" | "direct-confirmed" | "proxy-confirmed";
export type Measurement<T> =
  | { status: "measured"; value: T }
  | { status: "unavailable"; reason: string };
