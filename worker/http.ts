import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { User } from "./auth/queries";
import type { Bindings } from "./config";

// What every domain router shares: the Worker's bindings (see config.ts), the signed-in user and common validators.

export type AppEnv = { Bindings: Bindings; Variables: { user: User } };

export const idParam = zValidator("param", z.object({ id: z.coerce.number().int().positive() }));
