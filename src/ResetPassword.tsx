import { useState } from "react";
import { Alert, Anchor, Button, PasswordInput, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { authApi, type User } from "./api";
import { AuthCard } from "./Login";

export function ResetPassword({ token, onDone }: { token: string; onDone: (u: User | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { password: "", confirm: "" },
    validate: {
      password: (v) => (v.length < 8 ? "At least 8 characters" : null),
      confirm: (v, values) => (v === values.password ? null : "Passwords don't match"),
    },
  });

  const submit = form.onSubmit(async ({ password }) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await authApi.reset(token, password));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  });

  return (
    <AuthCard subtitle="Choose a new password">
      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}
      <form onSubmit={submit}>
        <Stack gap="sm">
          <PasswordInput
            label="New password"
            description="At least 8 characters"
            autoComplete="new-password"
            required
            {...form.getInputProps("password")}
          />
          <PasswordInput
            label="Confirm new password"
            autoComplete="new-password"
            required
            {...form.getInputProps("confirm")}
          />
          <Button type="submit" loading={busy} fullWidth mt="xs">
            Set new password
          </Button>
        </Stack>
      </form>
      <Text size="sm" ta="center" mt="md" c="dimmed">
        Changing it signs you out on every other device.{" "}
        <Anchor component="button" type="button" onClick={() => onDone(null)}>
          Back to sign in
        </Anchor>
      </Text>
    </AuthCard>
  );
}
