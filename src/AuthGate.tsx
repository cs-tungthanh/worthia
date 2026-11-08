import { useEffect, useState } from "react";
import { Center, Loader } from "@mantine/core";
import { authApi, SIGNED_OUT_EVENT, type User } from "./api";
import App from "./App";
import { Login } from "./Login";
import { ResetPassword } from "./ResetPassword";

// Google sign-in failures come back as /?auth_error=...; read it once and tidy the URL.
function takeAuthError() {
  const params = new URLSearchParams(location.search);
  const error = params.get("auth_error");
  if (error) history.replaceState(null, "", location.pathname);
  return error;
}

// Emailed reset links open /reset-password?token=...; take the token and drop it from the address bar
// (and from history) so it isn't left lying around.
function takeResetToken() {
  if (location.pathname !== "/reset-password") return null;
  const token = new URLSearchParams(location.search).get("token");
  history.replaceState(null, "", "/");
  return token;
}

export default function AuthGate() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = still checking
  const [authError] = useState(takeAuthError);
  const [resetToken, setResetToken] = useState(takeResetToken);

  useEffect(() => {
    authApi.me().then(setUser, () => setUser(null));
    const signedOut = () => setUser(null);
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, []);

  if (resetToken)
    return (
      <ResetPassword
        token={resetToken}
        onDone={(u) => {
          setResetToken(null);
          setUser(u);
        }}
      />
    );
  if (user === undefined)
    return (
      <Center mih="100dvh">
        <Loader />
      </Center>
    );
  if (!user) return <Login onSignedIn={setUser} initialError={authError} />;
  // key: a different account gets a fresh App with no leftover state from the previous one.
  return (
    <App
      key={user.id}
      user={user}
      onUserChange={setUser}
      onSignOut={() => authApi.logout().finally(() => setUser(null))}
    />
  );
}
