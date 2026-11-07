// Request limits shared by client and server. The client uses them to choose
// how much recent conversation to send; the server enforces them.

/** Most turns (user + assistant) sent to the model in one request. */
export const MAX_TURNS = 24;
/** Longest single message the model can be sent. The full text is still stored. */
export const MAX_CHARS_PER_TURN = 8_000;
/** Total characters across all turns in one request. */
export const MAX_CHARS_PER_REQUEST = 32_000;

// Retrieval of saved pages for a chat turn (source-linked memory experiment).
/** Most saved entries quoted into one request. */
export const MAX_SOURCES = 3;
/** Longest verbatim excerpt per source; longer pages are cut with a visible marker. */
export const MAX_CHARS_PER_SOURCE = 3_000;
/** Total characters of source text in one request. */
export const MAX_RETRIEVAL_CHARS = 6_000;
