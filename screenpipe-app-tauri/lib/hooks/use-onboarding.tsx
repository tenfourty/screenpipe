import { useSettings, awaitSettingsHydration } from "./use-settings";
import React, { useContext } from "react";

const OnboardingContext = React.createContext<{
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => Promise<void>;
} | null>(null);

export const OnboardingProvider = OnboardingContext.Provider;

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  const { settings, updateSettings } = useSettings();
  
  if (context) {
    // Use context if available (main app provides it)
    return context;
  }
  
  // Fallback for components that use this hook outside the provider
  const showOnboarding = settings.isFirstTimeUser;

  const setShowOnboarding = async (show: boolean) => {
    try {
      await awaitSettingsHydration();
      await updateSettings({ isFirstTimeUser: show });
    } catch (error) {
      console.error('Failed to update onboarding settings:', error);
    }
  };

  return { showOnboarding, setShowOnboarding };
};

