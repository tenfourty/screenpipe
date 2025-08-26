// app/providers.tsx
"use client";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";
import { ChangelogDialogProvider } from "@/lib/hooks/use-changelog-dialog";
import React from "react";
import {
  store as SettingsStore,
  useSettings,
  awaitSettingsHydration,
} from "@/lib/hooks/use-settings";
import { profilesStore as ProfilesStore } from "@/lib/hooks/use-profiles";

// Inner component that has access to the settings store
const ProviderInner = ({ children }: { children: React.ReactNode }) => {
  const { settings } = useSettings();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isDebug = process.env.TAURI_ENV_DEBUG === "true";
    if (isDebug) return;

    let cancelled = false;
    (async () => {
      try {
        await awaitSettingsHydration();
        if (cancelled) return;
        
        if (settings.analyticsEnabled) {
          posthog.init("phc_Bt8GoTBPgkCpDrbaIZzJIEYt0CrJjhBiuLaBck1clce", {
            api_host: "https://eu.i.posthog.com",
            person_profiles: "identified_only",
            capture_pageview: false,
          });
        } else {
          posthog.opt_out_capturing();
        }
      } catch (error) {
        console.error('Failed to wait for settings hydration in analytics setup:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [settings.analyticsEnabled]);

  return (
    <ProfilesStore.Provider>
      <ChangelogDialogProvider>
        <PostHogProvider client={posthog}>{children}</PostHogProvider>
      </ChangelogDialogProvider>
    </ProfilesStore.Provider>
  );
};

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <SettingsStore.Provider>
      <ProviderInner>{children}</ProviderInner>
    </SettingsStore.Provider>
  );
};
