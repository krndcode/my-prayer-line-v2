"use client";

import { useEffect } from "react";
import { applyTheme } from "@/lib/theme";

export default function ThemeProvider({ children }) {
  useEffect(() => {
    let preference =
      window.localStorage.getItem("my-prayer-line-theme") || "light";
    let mediaQuery = null;

    const watchSystemTheme = (nextPreference) => {
      if (mediaQuery) {
        mediaQuery.removeEventListener("change", updateTheme);
        mediaQuery = null;
      }

      preference = nextPreference;
      applyTheme(preference);

      if (preference === "system") {
        mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", updateTheme);
      }
    };

    const updateTheme = () => applyTheme("system");
    const handlePreferenceChange = (event) => {
      watchSystemTheme(event.detail.preference);
    };

    watchSystemTheme(preference);
    window.addEventListener(
      "my-prayer-line-theme-change",
      handlePreferenceChange
    );

    return () => {
      window.removeEventListener(
        "my-prayer-line-theme-change",
        handlePreferenceChange
      );
      if (mediaQuery) mediaQuery.removeEventListener("change", updateTheme);
    };
  }, []);

  return children;
}
