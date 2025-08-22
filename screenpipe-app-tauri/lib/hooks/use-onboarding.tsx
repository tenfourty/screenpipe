import { useSettings } from "./use-settings";

export const useOnboarding = () => {
  const { settings, updateSettings, isHydrated } = useSettings();
  
  // Wait for settings to be hydrated before determining onboarding state
  const showOnboarding = isHydrated ? !settings.hasCompletedOnboarding : false;

  const setShowOnboarding = (show: boolean) => {
    if (isHydrated) {
      updateSettings({ hasCompletedOnboarding: !show });
    }
  };

  return { showOnboarding, setShowOnboarding };
};

