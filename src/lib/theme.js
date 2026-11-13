export function resolveTheme(preference) {
  if (preference === "dark" || preference === "light") {
    return preference;
  }

  if (typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export function applyTheme(preference, persist = false) {
  if (typeof document === "undefined") return;

  const resolvedTheme = resolveTheme(preference);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;

  if (persist) {
    window.localStorage.setItem("my-prayer-line-theme", preference);
    window.dispatchEvent(
      new CustomEvent("my-prayer-line-theme-change", {
        detail: { preference },
      })
    );
  }
}
