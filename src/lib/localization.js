export const supportedLanguages = ["English", "French", "Spanish", "Portuguese"];

const languageCodes = {
  English: "en",
  French: "fr",
  Spanish: "es",
  Portuguese: "pt",
};

const translations = {
  French: {
    Home: "Accueil",
    "Prayer Space": "Espace de prière",
    "Heat Room": "Espace communautaire",
    Notifications: "Notifications",
    Donate: "Faire un don",
    "Contact support": "Contacter l’assistance",
    Profile: "Profil",
    More: "Plus",
    "View profile": "Voir le profil",
    "More profile options": "Plus d’options de profil",
    "Go to profile": "Aller au profil",
    "Close more navigation": "Fermer le menu Plus",
    "More navigation": "Menu Plus",
    "Connecting hearts through prayer": "Unis par la prière",
    "Live now": "En direct",
    "Your community is gathering in prayer":
      "Votre communauté se réunit pour prier",
    "Gather with your community in prayer":
      "Priez avec votre communauté",
    "Join prayer": "Rejoindre la prière",
    "Your account": "Votre compte",
    Preferences: "Préférences",
    "Choose how you want to use My Prayer Line.":
      "Personnalisez votre expérience My Prayer Line.",
    Language: "Langue",
    Appearance: "Apparence",
    "Prayer reminder frequency": "Fréquence des rappels de prière",
    "Light mode": "Mode clair",
    "Dark mode": "Mode sombre",
    "Use device setting": "Paramètre de l’appareil",
    Daily: "Chaque jour",
    Weekly: "Chaque semaine",
    Never: "Jamais",
    "Your appearance choice is applied throughout the app as soon as you save. System mode follows your device appearance setting.":
      "Votre choix d’apparence s’applique dès l’enregistrement. Le mode système suit les réglages de votre appareil.",
    "Preferences saved.": "Préférences enregistrées.",
    Save: "Enregistrer",
    Saving: "Enregistrement…",
    "Create group": "Créer un groupe",
    "Start a community": "Créer une communauté",
    "Find a group": "Trouver un groupe",
    "Discover your circle": "Découvrir votre communauté",
    "Request prayer": "Demander une prière",
    "Let others stand with you": "Laissez les autres vous soutenir",
    "Share testimony": "Partager un témoignage",
    "Celebrate His goodness": "Célébrer Sa bonté",
    Hello: "Bonjour",
    "Good morning": "Bonjour",
    "Good afternoon": "Bon après-midi",
    "Good evening": "Bonsoir",
    Scheduled: "Planifié",
    Live: "En direct",
    Completed: "Terminé",
  },
  Spanish: {
    Home: "Inicio",
    "Prayer Space": "Espacio de oración",
    "Heat Room": "Comunidad",
    Notifications: "Notificaciones",
    Donate: "Donar",
    "Contact support": "Contactar con soporte",
    Profile: "Perfil",
    More: "Más",
    "View profile": "Ver perfil",
    "More profile options": "Más opciones del perfil",
    "Go to profile": "Ir al perfil",
    "Close more navigation": "Cerrar menú Más",
    "More navigation": "Menú Más",
    "Connecting hearts through prayer": "Unimos corazones a través de la oración",
    "Live now": "En vivo",
    "Your community is gathering in prayer":
      "Tu comunidad se reúne para orar",
    "Gather with your community in prayer":
      "Reúnete con tu comunidad para orar",
    "Join prayer": "Unirse a la oración",
    "Your account": "Tu cuenta",
    Preferences: "Preferencias",
    "Choose how you want to use My Prayer Line.":
      "Personaliza tu experiencia en My Prayer Line.",
    Language: "Idioma",
    Appearance: "Apariencia",
    "Prayer reminder frequency": "Frecuencia de recordatorios de oración",
    "Light mode": "Modo claro",
    "Dark mode": "Modo oscuro",
    "Use device setting": "Usar configuración del dispositivo",
    Daily: "Diariamente",
    Weekly: "Semanalmente",
    Never: "Nunca",
    "Your appearance choice is applied throughout the app as soon as you save. System mode follows your device appearance setting.":
      "La apariencia elegida se aplica al guardar. El modo del sistema sigue la configuración de tu dispositivo.",
    "Preferences saved.": "Preferencias guardadas.",
    Save: "Guardar",
    Saving: "Guardando",
    "Create group": "Crear grupo",
    "Start a community": "Iniciar una comunidad",
    "Find a group": "Buscar un grupo",
    "Discover your circle": "Descubrir tu comunidad",
    "Request prayer": "Pedir oración",
    "Let others stand with you": "Deja que otros te acompañen",
    "Share testimony": "Compartir testimonio",
    "Celebrate His goodness": "Celebrar Su bondad",
    Hello: "Hola",
    "Good morning": "Buenos días",
    "Good afternoon": "Buenas tardes",
    "Good evening": "Buenas noches",
    Scheduled: "Programado",
    Live: "En vivo",
    Completed: "Completado",
  },
  Portuguese: {
    Home: "Início",
    "Prayer Space": "Espaço de oração",
    "Heat Room": "Comunidade",
    Notifications: "Notificações",
    Donate: "Doar",
    "Contact support": "Falar com o suporte",
    Profile: "Perfil",
    More: "Mais",
    "View profile": "Ver perfil",
    "More profile options": "Mais opções do perfil",
    "Go to profile": "Ir para o perfil",
    "Close more navigation": "Fechar menu Mais",
    "More navigation": "Menu Mais",
    "Connecting hearts through prayer": "Conectando corações por meio da oração",
    "Live now": "Ao vivo",
    "Your community is gathering in prayer":
      "Sua comunidade está reunida em oração",
    "Gather with your community in prayer":
      "Reúna-se com sua comunidade em oração",
    "Join prayer": "Participar da oração",
    "Your account": "Sua conta",
    Preferences: "Preferências",
    "Choose how you want to use My Prayer Line.":
      "Personalize sua experiência no My Prayer Line.",
    Language: "Idioma",
    Appearance: "Aparência",
    "Prayer reminder frequency": "Frequência dos lembretes de oração",
    "Light mode": "Modo claro",
    "Dark mode": "Modo escuro",
    "Use device setting": "Usar configuração do dispositivo",
    Daily: "Diariamente",
    Weekly: "Semanalmente",
    Never: "Nunca",
    "Your appearance choice is applied throughout the app as soon as you save. System mode follows your device appearance setting.":
      "A aparência escolhida é aplicada ao salvar. O modo do sistema segue a configuração do seu dispositivo.",
    "Preferences saved.": "Preferências salvas.",
    Save: "Salvar",
    Saving: "Salvando",
    "Create group": "Criar grupo",
    "Start a community": "Iniciar uma comunidade",
    "Find a group": "Encontrar um grupo",
    "Discover your circle": "Descobrir sua comunidade",
    "Request prayer": "Pedir oração",
    "Let others stand with you": "Deixe que outros apoiem você",
    "Share testimony": "Compartilhar testemunho",
    "Celebrate His goodness": "Celebrar Sua bondade",
    Hello: "Olá",
    "Good morning": "Bom dia",
    "Good afternoon": "Boa tarde",
    "Good evening": "Boa noite",
    Scheduled: "Agendado",
    Live: "Ao vivo",
    Completed: "Concluído",
  },
};

export function normalizeLanguage(language) {
  return supportedLanguages.includes(language) ? language : "English";
}

export function getLanguageCode(language) {
  return languageCodes[normalizeLanguage(language)];
}

export function translateText(text, language) {
  return translations[normalizeLanguage(language)]?.[text] || text;
}

export function applyLanguagePreference(language, persist = false) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const preference = normalizeLanguage(language);
  document.documentElement.lang = getLanguageCode(preference);
  document.documentElement.dataset.language = preference.toLowerCase();

  if (persist) {
    window.localStorage.setItem("my-prayer-line-language", preference);
  }

  window.dispatchEvent(
    new CustomEvent("my-prayer-line-language-change", {
      detail: { language: preference },
    })
  );
}
