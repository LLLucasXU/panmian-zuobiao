import { POST as research } from "../research/route";

// Each follow-up performs a fresh server-side research run. Client-supplied evidence is not trusted.
export const POST = research;
