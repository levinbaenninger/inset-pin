import { z } from "zod";

// Must run before any schema is built: Zod's JIT probes `new Function`, which the CSP forbids.
z.config({ jitless: true });
