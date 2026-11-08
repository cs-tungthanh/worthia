import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/charts/styles.css";
import AuthGate from "./AuthGate";
import "./styles.css";

// Lets date pickers parse typed dates as DD/MM/YYYY (config.ts DATE_INPUT_FORMAT) instead of the US order.
dayjs.extend(customParseFormat);

const theme = createTheme({ primaryColor: "teal" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <AuthGate />
    </MantineProvider>
  </StrictMode>,
);
