import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { User } from "./auth/queries";
import type { EmailEnv } from "./email/send";

// What every domain router shares: the Worker's bindings, the signed-in user and common validators.

// Email settings (BREVO_API_KEY / RESEND_API_KEY, EMAIL_FROM) are described in ./email/send.ts.
export type Bindings = Env &
  EmailEnv & {
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  };
export type AppEnv = { Bindings: Bindings; Variables: { user: User } };

export const idParam = zValidator("param", z.object({ id: z.coerce.number().int().positive() }));
