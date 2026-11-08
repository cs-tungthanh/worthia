import { useState, type ReactNode } from "react";
import {
  Alert,
  Anchor,
  Button,
  Center,
  Divider,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { authApi, type User } from "./api";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export function AuthCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <Center mih="100dvh" px="md">
      <Paper withBorder radius="md" p="lg" w="100%" maw={380}>
        <Title order={1} size="h3" mb={4}>
          Wealth
        </Title>
        <Text c="dimmed" size="sm" mb="lg">
          {subtitle}
        </Text>
        {children}
      </Paper>
    </Center>
  );
}

type Mode = "login" | "register" | "forgot";

const SUBTITLES: Record<Mode, string> = {
  login: "Sign in to your account",
  register: "Create your account",
  forgot: "Reset your password",
};

export function Login({ onSignedIn, initialError }: { onSignedIn: (u: User) => void; initialError: string | null }) {
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";
  const forgot = mode === "forgot";

  const form = useForm({
    initialValues: { name: "", email: "", password: "" },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : "Enter a valid email"),
      password: (v) =>
        forgot ? null : registering && v.length < 8 ? "At least 8 characters" : v ? null : "Enter your password",
    },
  });

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    form.clearErrors();
  };

  const submit = form.onSubmit(async ({ name, email, password }) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (forgot) {
        await authApi.forgot(email.trim());
        setNotice(
          "If an account with a password exists for that email, we've sent a reset link. It expires in 30 minutes. Accounts that use Google sign-in can't reset a password here.",
        );
        return;
      }
      const user = registering
        ? await authApi.register(email.trim(), password, name.trim() || null)
        : await authApi.login(email.trim(), password);
      onSignedIn(user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  });

  return (
    <AuthCard subtitle={SUBTITLES[mode]}>
      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert color="teal" mb="md">
          {notice}
        </Alert>
      )}

      {!forgot && (
        <>
          <Button component="a" href={authApi.googleUrl} variant="default" fullWidth leftSection={<GoogleIcon />}>
            Continue with Google
          </Button>
          <Divider label="or with email" labelPosition="center" my="md" />
        </>
      )}

      <form onSubmit={submit}>
        <Stack gap="sm">
          {registering && <TextInput label="Name" autoComplete="name" {...form.getInputProps("name")} />}
          <TextInput label="Email" type="email" autoComplete="email" required {...form.getInputProps("email")} />
          {!forgot && (
            <PasswordInput
              label="Password"
              autoComplete={registering ? "new-password" : "current-password"}
              description={registering ? "At least 8 characters" : undefined}
              required
              {...form.getInputProps("password")}
            />
          )}
          {mode === "login" && (
            <Anchor component="button" type="button" size="sm" ta="right" onClick={() => switchTo("forgot")}>
              Forgot password?
            </Anchor>
          )}
          <Button type="submit" loading={busy} fullWidth mt="xs">
            {forgot ? "Send reset link" : registering ? "Create account" : "Sign in"}
          </Button>
        </Stack>
      </form>

      <Text size="sm" ta="center" mt="md">
        {forgot ? (
          <Anchor component="button" type="button" onClick={() => switchTo("login")}>
            Back to sign in
          </Anchor>
        ) : (
          <>
            {registering ? "Already have an account? " : "New here? "}
            <Anchor component="button" type="button" onClick={() => switchTo(registering ? "login" : "register")}>
              {registering ? "Sign in" : "Create an account"}
            </Anchor>
          </>
        )}
      </Text>
    </AuthCard>
  );
}
