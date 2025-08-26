// app/providers.tsx
"use client";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect, useState, useCallback } from "react";
import { ChangelogDialogProvider } from "@/lib/hooks/use-changelog-dialog";
import React from "react";
import {
  store as SettingsStore,
  useSettings,
  awaitSettingsHydration,
} from "@/lib/hooks/use-settings";
import { 
  useSettingsZustand, 
  awaitZustandHydration 
} from "@/lib/hooks/use-settings-zustand";
import { profilesStore as ProfilesStore } from "@/lib/hooks/use-profiles";

// Separate analytics initialization to prevent unnecessary re-renders
const useAnalyticsInitialization = (analyticsEnabled: boolean) => {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isDebug = process.env.TAURI_ENV_DEBUG === "true";
    if (isDebug) return;

    // Only initialize once
    if (initialized) return;

    let cancelled = false;
    (async () => {
      try {
        await awaitSettingsHydration();
        if (cancelled) return;
        
        if (analyticsEnabled) {
          posthog.init("phc_Bt8GoTBPgkCpDrbaIZzJIEYt0CrJjhBiuLaBck1clce", {
            api_host: "https://eu.i.posthog.com",
            person_profiles: "identified_only",
            capture_pageview: false,
          });
        } else {
          posthog.opt_out_capturing();
        }
        setInitialized(true);
      } catch (error) {
        console.error('Failed to wait for settings hydration in analytics setup:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [analyticsEnabled, initialized]);

  // Handle analytics preference changes after initialization
  useEffect(() => {
    if (!initialized) return;
    
    if (analyticsEnabled) {
      posthog.opt_in_capturing();
    } else {
      posthog.opt_out_capturing();
    }
  }, [analyticsEnabled, initialized]);
};

// Memoized inner provider to prevent unnecessary re-renders
const ProviderInner = React.memo(({ children }: { children: React.ReactNode }) => {
  const { settings } = useSettings();
  
  // Initialize analytics with the hook
  useAnalyticsInitialization(settings.analyticsEnabled);

  return (
    <ProfilesStore.Provider>
      <ChangelogDialogProvider>
        <PostHogProvider client={posthog}>{children}</PostHogProvider>
      </ChangelogDialogProvider>
    </ProfilesStore.Provider>
  );
});

ProviderInner.displayName = 'ProviderInner';

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <SettingsStore.Provider>
      <ProviderInner>{children}</ProviderInner>
    </SettingsStore.Provider>
  );
};
