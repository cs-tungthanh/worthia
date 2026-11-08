import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/charts/styles.css";
import AuthGate from "./AuthGate";
import "./styles.css";

const theme = createTheme({ primaryColor: "teal" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <AuthGate />
    </MantineProvider>
  </StrictMode>,
);
