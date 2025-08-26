"use client";

import {
  getStore,
  resetStore,
  useSettings,
  awaitSettingsHydration,
} from "@/lib/hooks/use-settings";

import React, { useEffect, useState } from "react";
import NotificationHandler from "@/components/notification-handler";
import Header from "@/components/header";
import { useToast } from "@/components/ui/use-toast";
import Onboarding from "@/components/onboarding";
import { OnboardingProvider } from "@/lib/hooks/use-onboarding";
import { ChangelogDialog } from "@/components/changelog-dialog";
import { BreakingChangesInstructionsDialog } from "@/components/breaking-changes-instructions-dialog";
import { useChangelogDialog } from "@/lib/hooks/use-changelog-dialog";
import { useStatusDialog } from "@/lib/hooks/use-status-dialog";
import { useSettingsDialog } from "@/lib/hooks/use-settings-dialog";

import { PipeStore } from "@/components/pipe-store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useProfiles } from "@/lib/hooks/use-profiles";
import { relaunch } from "@tauri-apps/plugin-process";
import { PipeApi } from "@/lib/api";
import localforage from "localforage";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { LoginDialog } from "../components/login-dialog";
import { ModelDownloadTracker } from "../components/model-download-tracker";

export default function Home() {
  const { settings, updateSettings, loadUser, reloadStore } = useSettings();
  const { setActiveProfile } = useProfiles();
  const { toast } = useToast();
  const { setShowChangelogDialog } = useChangelogDialog();
  const { open: openStatusDialog } = useStatusDialog();
  const { setIsOpen: setSettingsOpen } = useSettingsDialog();
  const isProcessingRef = React.useRef(false);
  const loadUserRef = React.useRef(loadUser);
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [shouldShowOnboarding, setShouldShowOnboarding] = React.useState<boolean | null>(null);

  // Keep loadUser ref current
  React.useEffect(() => {
    loadUserRef.current = loadUser;
  }, [loadUser]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await awaitSettingsHydration();
        if (cancelled) return;
        
        setIsHydrated(true);
        
        // Get fresh settings from store after hydration
        const store = await getStore();
        const freshSettings = await store.get("settings") as any;
        const isFirstTime = freshSettings?.isFirstTimeUser ?? false;
        setShouldShowOnboarding(isFirstTime);
        
        // Load user with current token
        const userToken = freshSettings?.user?.token;
        if (userToken) {
          loadUserRef.current(userToken);
        }
      } catch (error) {
        console.error('Failed to wait for settings hydration in user loading:', error);
        if (!cancelled) {
          setIsHydrated(true);
          setShouldShowOnboarding(false); // Default to not showing on error
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // Remove loadUser dependency to prevent re-runs

  // Create setShowOnboarding function
  const setShowOnboarding = React.useCallback(async (show: boolean) => {
    try {
      await awaitSettingsHydration();
      await updateSettings({ isFirstTimeUser: show });
      setShouldShowOnboarding(show);
    } catch (error) {
      console.error('Failed to update onboarding settings:', error);
    }
  }, [updateSettings]);

  useEffect(() => {
    const getAudioDevices = async () => {
      const store = await getStore();
      const devices = (await store.get("audioDevices")) as string[];
      return devices;
    };

    const setupDeepLink = async () => {
      const unsubscribeDeepLink = await onOpenUrl(async (urls) => {
        console.log("received deep link urls:", urls);
        for (const url of urls) {
          const parsedUrl = new URL(url);

          // Handle API key auth
          if (url.includes("api_key=")) {
            const apiKey = parsedUrl.searchParams.get("api_key");
            if (apiKey) {
              await updateSettings({ user: { token: apiKey } });
              toast({
                title: "logged in!",
                description: "you have been logged in",
              });
            }
          }

          if (url.includes("settings")) {
            setSettingsOpen(true);
          }

          if (url.includes("changelog")) {
            setShowChangelogDialog(true);
          }

          if (url.includes("onboarding")) {
            setShowOnboarding(true);
          }

          if (url.includes("status")) {
            openStatusDialog();
          }
        }
      });
      return unsubscribeDeepLink;
    };

    let deepLinkUnsubscribe: (() => void) | undefined;

    setupDeepLink().then((unsubscribe) => {
      deepLinkUnsubscribe = unsubscribe;
    });

    const unlisten = Promise.all([
      listen("shortcut-start-recording", async () => {
        await invoke("spawn_screenpipe");

        toast({
          title: "recording started",
          description: "screen recording has been initiated",
        });
      }),

      listen("shortcut-stop-recording", async () => {
        await invoke("stop_screenpipe");

        toast({
          title: "recording stopped",
          description: "screen recording has been stopped",
        });
      }),

      listen<string>("switch-profile", async (event) => {
        const profile = event.payload;
        setActiveProfile(profile);
        resetStore();
        await reloadStore();

        toast({
          title: "profile switched",
          description: `switched to ${profile} profile, restarting screenpipe now`,
        });

        await invoke("stop_screenpipe");

        await new Promise((resolve) => setTimeout(resolve, 1000));

        await invoke("spawn_screenpipe");

        await new Promise((resolve) => setTimeout(resolve, 1000));
        relaunch();
      }),

      listen<string>("open-pipe", async (event) => {
        const pipeId = event.payload;

        const pipeApi = new PipeApi();
        const pipeList = await pipeApi.listPipes();
        const pipe = pipeList.find((p) => p.id === pipeId);
        if (pipe) {
          await invoke("open_pipe_window", {
            port: pipe.port,
            title: pipe.id,
          });
        }
      }),

      listen("shortcut-start-audio", async () => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        try {
          const devices = await getAudioDevices();
          const pipeApi = new PipeApi();
          console.log("audio-devices", devices);
          await Promise.all(
            devices.map((device) => pipeApi.startAudio(device))
          );
          toast({
            title: "audio started",
            description: "audio has been started",
          });
        } catch (error) {
          console.error("error starting audio:", error);
          toast({
            title: "error starting audio",
            description:
              error instanceof Error ? error.message : "unknown error occurred",
            variant: "destructive",
          });
        } finally {
          isProcessingRef.current = false;
        }
      }),

      listen("shortcut-stop-audio", async (event) => {
        try {
          const devices = await getAudioDevices();
          const pipeApi = new PipeApi();
          devices.forEach((device) => {
            pipeApi.stopAudio(device);
          });
          toast({
            title: "audio stopped",
            description: "audio has been stopped",
          });
        } catch (error) {
          console.error("error stopping audio:", error);
          toast({
            title: "error stopping audio",
            description:
              error instanceof Error ? error.message : "unknown error occurred",
            variant: "destructive",
          });
        }
      }),
    ]);

    return () => {
      unlisten.then((listeners) => {
        listeners.forEach((unlistenFn) => unlistenFn());
      });
      if (deepLinkUnsubscribe) deepLinkUnsubscribe();
    };
  }, [setSettingsOpen]);

  useEffect(() => {
    const checkScreenPermissionRestart = async () => {
      try {
        await awaitSettingsHydration();
        
        const restartPending = await localforage.getItem(
          "screenPermissionRestartPending"
        );
        
        if (restartPending) {
          // Clear the flag first to prevent infinite loop
          await localforage.removeItem("screenPermissionRestartPending");
          
          // Only show onboarding if user is still first time user
          if (settings.isFirstTimeUser) {
            setShowOnboarding(true);
          }
        }
      } catch (error) {
        console.error('Failed to check screen permission restart:', error);
      }
    };

    checkScreenPermissionRestart();
  }, [setShowOnboarding, settings.isFirstTimeUser]);

  useEffect(() => {
    const unlisten = listen("cli-login", async (event) => {
      console.log("received cli-login event:", event);
      await reloadStore();
    });

    return () => {
      unlisten.then((unlistenFn) => unlistenFn());
    };
  }, []);

  // Show loading until settings are hydrated AND we know the onboarding state
  if (!isHydrated || shouldShowOnboarding === null) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 max-w-screen-2xl mx-auto relative min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <OnboardingProvider value={{ showOnboarding: shouldShowOnboarding, setShowOnboarding }}>
      <div className="flex flex-col items-center flex-1 max-w-screen-2xl mx-auto relative">
        <LoginDialog />
        <ModelDownloadTracker />
        <NotificationHandler />
        <div suppressHydrationWarning>
          {shouldShowOnboarding ? (
            <Onboarding />
          ) : (
            <>
              <ChangelogDialog />
              {/* <BreakingChangesInstructionsDialog /> */}
              <Header />
              <div className=" w-full">
                <PipeStore />
              </div>
            </>
          )}
        </div>
      </div>
    </OnboardingProvider>
  );
}
