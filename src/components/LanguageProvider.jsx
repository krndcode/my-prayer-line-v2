"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getLanguageCode,
  normalizeLanguage,
  translateText,
} from "@/lib/localization";

const LanguageContext = createContext({
  language: "English",
  t: (text) => text,
});

export function useLanguage() {
  return useContext(LanguageContext);
}

export default function LanguageProvider({ children }) {
  const [language, setLanguage] = useState("English");

  useEffect(() => {
    const storedLanguage = normalizeLanguage(
      window.localStorage.getItem("my-prayer-line-language")
    );

    const updateLanguage = (preference) => {
      const nextLanguage = normalizeLanguage(preference);
      setLanguage(nextLanguage);
      document.documentElement.lang = getLanguageCode(nextLanguage);
      document.documentElement.dataset.language = nextLanguage.toLowerCase();
    };

    updateLanguage(storedLanguage);

    const handlePreferenceChange = (event) => {
      updateLanguage(event.detail?.language);
    };

    window.addEventListener(
      "my-prayer-line-language-change",
      handlePreferenceChange
    );

    return () => {
      window.removeEventListener(
        "my-prayer-line-language-change",
        handlePreferenceChange
      );
    };
  }, []);

  const t = useCallback(
    (text) => translateText(text, language),
    [language]
  );
  const contextValue = useMemo(() => ({ language, t }), [language, t]);

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
}
