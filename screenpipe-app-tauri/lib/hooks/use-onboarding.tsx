import { useSettings } from "./use-settings";

export const useOnboarding = () => {
  const { settings, updateSettings } = useSettings();
  const showOnboarding = !settings.hasCompletedOnboarding;

  const setShowOnboarding = (show: boolean) => {
    updateSettings({ hasCompletedOnboarding: !show });
  };

  return { showOnboarding, setShowOnboarding };
};

