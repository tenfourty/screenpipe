import { homeDir } from "@tauri-apps/api/path";
import { platform } from "@tauri-apps/plugin-os";
import { Pipe } from "./use-pipes";
import { Language } from "@/lib/language";
import {
	action,
	Action,
	persist,
	PersistStorage,
	createContextStore,
} from "easy-peasy";
import { LazyStore, LazyStore as TauriStore } from "@tauri-apps/plugin-store";
import { localDataDir } from "@tauri-apps/api/path";
import { rename, remove, exists } from "@tauri-apps/plugin-fs";
import { flattenObject, unflattenObject } from "../utils";
import { useEffect, useCallback } from "react";
import posthog from "posthog-js";
import localforage from "localforage";
import merge from "lodash/merge";

export type VadSensitivity = "low" | "medium" | "high";

export type AIProviderType =
	| "native-ollama"
	| "openai"
	| "custom"
	| "embedded"
	| "screenpipe-cloud";

export type EmbeddedLLMConfig = {
	enabled: boolean;
	model: string;
	port: number;
};

export enum Shortcut {
	SHOW_SCREENPIPE = "show_screenpipe",
	START_RECORDING = "start_recording",
	STOP_RECORDING = "stop_recording",
}

export type User = {
	id?: string;
	email?: string;
	name?: string;
	image?: string;
	token?: string;
	clerk_id?: string;
	api_key?: string;
	credits?: {
		amount: number;
	};
	stripe_connected?: boolean;
	stripe_account_status?: "active" | "pending";
	github_username?: string;
	bio?: string;
	website?: string;
	contact?: string;
	cloud_subscribed?: boolean;
};

export type AIPreset = {
	id: string;
	maxContextChars: number;
	url: string;
	model: string;
	defaultPreset: boolean;
	prompt: string;
	//provider: AIProviderType;
} & (
	| {
			provider: "openai";
			apiKey: string;
	  }
	| {
			provider: "native-ollama";
	  }
	| {
			provider: "screenpipe-cloud";
	  }
	| {
			provider: "custom";
			apiKey?: string;
	  }
);

export type Settings = {
	openaiApiKey: string;
	deepgramApiKey: string;
	isLoading: boolean;
	aiModel: string;
	installedPipes: Pipe[];
	userId: string;
	customPrompt: string;
	devMode: boolean;
	audioTranscriptionEngine: string;
	ocrEngine: string;
	monitorIds: string[];
	audioDevices: string[];
	usePiiRemoval: boolean;
	restartInterval: number;
	port: number;
	dataDir: string;
	disableAudio: boolean;
	ignoredWindows: string[];
	includedWindows: string[];
	aiProviderType: AIProviderType;
	aiUrl: string;
	aiMaxContextChars: number;
	fps: number;
	vadSensitivity: VadSensitivity;
	analyticsEnabled: boolean;
	audioChunkDuration: number; // new field
	useChineseMirror: boolean; // Add this line
	embeddedLLM: EmbeddedLLMConfig;
	languages: Language[];
        enableBeta: boolean;
        isFirstTimeUser: boolean;
	autoStartEnabled: boolean;
	enableFrameCache: boolean; // Add this line
	enableUiMonitoring: boolean; // Add this line
	platform: string; // Add this line
	disabledShortcuts: Shortcut[];
	user: User;
	showScreenpipeShortcut: string;
	startRecordingShortcut: string;
	stopRecordingShortcut: string;
	startAudioShortcut: string;
	stopAudioShortcut: string;
	pipeShortcuts: Record<string, string>;
	enableRealtimeAudioTranscription: boolean;
	realtimeAudioTranscriptionEngine: string;
	disableVision: boolean;
	useAllMonitors: boolean;
	aiPresets: AIPreset[];
	enableRealtimeVision: boolean;
	autoUpdatePipes: boolean;
};

export const DEFAULT_PROMPT = `Rules:
- You can analyze/view/show/access videos to the user by putting .mp4 files in a code block (we'll render it) like this: \`/users/video.mp4\`, use the exact, absolute, file path from file_path property
- Do not try to embed video in links (e.g. [](.mp4) or https://.mp4) instead put the file_path in a code block using backticks
- Do not put video in multiline code block it will not render the video (e.g. \`\`\`bash\n.mp4\`\`\` IS WRONG) instead using inline code block with single backtick
- Always answer my question/intent, do not make up things
`;

const DEFAULT_SETTINGS: Settings = {
	aiPresets: [],
	openaiApiKey: "",
	deepgramApiKey: "", // for now we hardcode our key (dw about using it, we have bunch of credits)
	isLoading: true,
	aiModel: "gpt-4o",
	installedPipes: [],
	userId: "",
	customPrompt: `Rules:
- You can analyze/view/show/access videos to the user by putting .mp4 files in a code block (we'll render it) like this: \`/users/video.mp4\`, use the exact, absolute, file path from file_path property
- Do not try to embed video in links (e.g. [](.mp4) or https://.mp4) instead put the file_path in a code block using backticks
- Do not put video in multiline code block it will not render the video (e.g. \`\`\`bash\n.mp4\`\`\` IS WRONG) instead using inline code block with single backtick
- Always answer my question/intent, do not make up things
`,
	devMode: false,
	audioTranscriptionEngine: "whisper-large-v3-turbo",
	ocrEngine: "default",
	monitorIds: ["default"],
	audioDevices: ["default"],
	usePiiRemoval: false,
	restartInterval: 0,
	port: 3030,
	dataDir: "default",
	disableAudio: false,
	ignoredWindows: [],
	includedWindows: [],
	aiProviderType: "openai",
	aiUrl: "https://api.openai.com/v1",
	aiMaxContextChars: 512000,
	fps: 0.5,
	vadSensitivity: "high",
	analyticsEnabled: true,
	audioChunkDuration: 30, // default to 10 seconds
	useChineseMirror: false, // Add this line
	languages: [],
	embeddedLLM: {
		enabled: false,
		model: "llama3.2:1b-instruct-q4_K_M",
		port: 11434,
	},
        enableBeta: false,
        isFirstTimeUser: true,
	autoStartEnabled: true,
	enableFrameCache: true, // Add this line
	enableUiMonitoring: false, // Change from true to false
	platform: "unknown", // Add this line
	disabledShortcuts: [],
	user: {},
	showScreenpipeShortcut: "Super+Alt+S",
	startRecordingShortcut: "Super+Alt+U", // Super+Alt+R is used on windows by Xbox Game Bar
	stopRecordingShortcut: "Super+Alt+X",
	startAudioShortcut: "",
	stopAudioShortcut: "",
	pipeShortcuts: {},
	enableRealtimeAudioTranscription: false,
	realtimeAudioTranscriptionEngine: "deepgram",
	disableVision: false,
	useAllMonitors: false,
	enableRealtimeVision: true,
	autoUpdatePipes: false, // Default to false for auto-updating pipes
};

const DEFAULT_IGNORED_WINDOWS_IN_ALL_OS = [
	"bit",
	"VPN",
	"Trash",
	"Private",
	"Incognito",
	"Wallpaper",
	"Settings",
	"Keepass",
	"Recorder",
	"Vaults",
	"OBS Studio",
	"screenpipe",
];

const DEFAULT_IGNORED_WINDOWS_PER_OS: Record<string, string[]> = {
	macos: [
		".env",
		"Item-0",
		"App Icon Window",
		"Battery",
		"Shortcuts",
		"WiFi",
		"BentoBox",
		"Clock",
		"Dock",
		"DeepL",
		"Control Center",
	],
	windows: ["Nvidia", "Control Panel", "System Properties"],
	linux: ["Info center", "Discover", "Parted"],
};

// Model definition
export interface StoreModel {
        settings: Settings;
        setSettings: Action<StoreModel, Partial<Settings>>;
        resetSettings: Action<StoreModel>;
        resetSetting: Action<StoreModel, keyof Settings>;
}

export function createDefaultSettingsObject(): Settings {
	let defaultSettings = { ...DEFAULT_SETTINGS };
	try {
		const currentPlatform = platform();

		const ocrModel =
			currentPlatform === "macos"
				? "apple-native"
				: currentPlatform === "windows"
					? "windows-native"
					: "tesseract";

		defaultSettings.ocrEngine = ocrModel;
		defaultSettings.fps = currentPlatform === "macos" ? 0.5 : 1;
		defaultSettings.platform = currentPlatform;

		defaultSettings.ignoredWindows = [
			...DEFAULT_IGNORED_WINDOWS_IN_ALL_OS,
			...(DEFAULT_IGNORED_WINDOWS_PER_OS[currentPlatform] ?? []),
		];

		return defaultSettings;
	} catch (e) {
		return DEFAULT_SETTINGS;
	}
}

// Create a singleton store instance
let storePromise: Promise<LazyStore> | null = null;

/**
 * @warning Do not change autoSave to true, it causes race conditions
 */
export const getStore = async () => {
	if (!storePromise) {
		storePromise = (async () => {
			const dir = await localDataDir();
			const profilesStore = new TauriStore(`${dir}/screenpipe/profiles.bin`, {
				autoSave: false,
			});
			const activeProfile =
				(await profilesStore.get("activeProfile")) || "default";
			const file =
				activeProfile === "default"
					? `store.bin`
					: `store-${activeProfile}.bin`;
			return new TauriStore(`${dir}/screenpipe/${file}`, {
				autoSave: false,
			});
		})();
        }
        return storePromise;
};

export const resetStore = () => {
        storePromise = null;
};

const tauriStorage: PersistStorage = {
        getItem: async (_key: string) => {
                const tauriStore = await getStore();
                const allKeys = await tauriStore.keys();
                const values: Record<string, any> = {};

		for (const k of allKeys) {
			values[k] = await tauriStore.get(k);
		}

                return { settings: unflattenObject(values) };
        },
        setItem: async (_key: string, value: any) => {
                delete value.settings.customSettings;
                const flattenedValue = flattenObject(value.settings);

                const dir = await localDataDir();
                const profilesStore = new TauriStore(`${dir}/screenpipe/profiles.bin`, {
                        autoSave: false,
                });
                const activeProfile =
                        (await profilesStore.get("activeProfile")) || "default";
                const file =
                        activeProfile === "default"
                                ? `store.bin`
                                : `store-${activeProfile}.bin`;
                const storePath = `${dir}/screenpipe/${file}`;
                const tempPath = `${storePath}.tmp`;
                const backupPath = `${storePath}.bak`;

                const tempStore = new TauriStore(tempPath, { autoSave: false });

                try {
                        for (const [key, val] of Object.entries(flattenedValue)) {
                                if (!key || !key.length) continue;
                                const defaultValue =
                                        key in DEFAULT_SETTINGS
                                                ? DEFAULT_SETTINGS[key as keyof Settings]
                                                : "";
                                await tempStore.set(
                                        key,
                                        val === undefined ? defaultValue : val,
                                );
                        }

                        await tempStore.save();

                        if (await exists(storePath)) {
                                await rename(storePath, backupPath);
                        }

                        await rename(tempPath, storePath);

                        if (await exists(backupPath)) {
                                await remove(backupPath);
                        }

                        // Don't reset store after successful save - this was causing settings to be lost
                } catch (err) {
                        console.error("failed to save settings:", err);
                        try {
                                if (await exists(tempPath)) {
                                        await remove(tempPath);
                                }
                                if (await exists(backupPath)) {
                                        if (await exists(storePath)) {
                                                await remove(storePath);
                                        }
                                        await rename(backupPath, storePath);
                                }
                        } catch (rollbackErr) {
                                console.error("failed to rollback settings:", rollbackErr);
                        }
                        throw err;
                }
        },
	removeItem: async (_key: string) => {
		const tauriStore = await getStore();
		const keys = await tauriStore.keys();
		for (const key of keys) {
			await tauriStore.delete(key);
		}
		await tauriStore.save();
	},
};

export const store = createContextStore<StoreModel>(
        persist(
                {
                        settings: createDefaultSettingsObject(),
                        setSettings: action((state, payload) => {
                                state.settings = merge({}, state.settings, payload);
                        }),
			resetSettings: action((state) => {
				state.settings = createDefaultSettingsObject();
			}),
			resetSetting: action((state, key) => {
				const defaultValue = createDefaultSettingsObject()[key];
				(state.settings as any)[key] = defaultValue;
			}),
		},
		{
			storage: tauriStorage,
			mergeStrategy: "mergeDeep",
		},
	),
);

let hydrationResolved = false;
const pendingUpdates: (() => void)[] = [];

export const hydrationReady: Promise<void> = typeof window !== "undefined" && (store as any).persist?.resolveRehydration
        ? (store as any).persist.resolveRehydration()
                .then(() => {
                        hydrationResolved = true;
                        pendingUpdates.forEach((fn) => fn());
                        pendingUpdates.length = 0;
                })
                .catch((error: Error) => {
                        console.error('Settings hydration failed:', error);
                        // Fallback: mark as resolved with defaults to prevent hanging
                        hydrationResolved = true;
                        pendingUpdates.forEach((fn) => fn());
                        pendingUpdates.length = 0;
                })
        : Promise.resolve().then(() => {
                // During SSR, immediately resolve as "hydrated"
                hydrationResolved = true;
                pendingUpdates.forEach((fn) => fn());
                pendingUpdates.length = 0;
        });

export function awaitSettingsHydration(timeout = 10000) {
        return Promise.race([
                hydrationReady,
                new Promise<void>((_, reject) => 
                        setTimeout(() => reject(new Error('Settings hydration timeout')), timeout)
                )
        ]).catch(() => {
                // Timeout or error - proceed with defaults
                hydrationResolved = true;
                pendingUpdates.forEach((fn) => fn());
                pendingUpdates.length = 0;
        });
}

export function useSettings() {
        const settings = store.useStoreState((state) => state.settings);
        const setSettings = store.useStoreActions((actions) => actions.setSettings);
        const resetSettingsAction = store.useStoreActions(
                (actions) => actions.resetSettings,
        );
        const resetSettingAction = store.useStoreActions(
                (actions) => actions.resetSetting,
        );

        const runOrQueue = useCallback((fn: () => void): Promise<void> => {
                if (hydrationResolved) {
                        fn();
                        return Promise.resolve();
                }
                return new Promise((resolve) => {
                        pendingUpdates.push(() => {
                                fn();
                                resolve();
                        });
                });
        }, []);

        const updateSettings = useCallback(
                (payload: Partial<Settings>) => runOrQueue(() => setSettings(payload)),
                [runOrQueue, setSettings],
        );
        const resetSettings = useCallback(
                () => runOrQueue(() => resetSettingsAction()),
                [runOrQueue, resetSettingsAction],
        );
        const resetSetting = useCallback(
                (key: keyof Settings) => runOrQueue(() => resetSettingAction(key)),
                [runOrQueue, resetSettingAction],
        );

	useEffect(() => {
		if (settings.user?.id) {
			posthog.identify(settings.user?.id, {
				email: settings.user?.email,
				name: settings.user?.name,
				github_username: settings.user?.github_username,
				website: settings.user?.website,
				contact: settings.user?.contact,
			});
		}
	}, [settings.user?.id]);

	const getDataDir = async () => {
		const homeDirPath = await homeDir();

		if (
			settings.dataDir !== "default" &&
			settings.dataDir &&
			settings.dataDir !== ""
		)
			return settings.dataDir;

		let p = "macos";
		try {
			p = platform();
		} catch (e) {}

		return p === "macos" || p === "linux"
			? `${homeDirPath}/.screenpipe`
			: `${homeDirPath}\\.screenpipe`;
	};

        const loadUser = async (token: string, forceReload = false) => {
                try {
                        // try to get from cache first (unless force reload)
                        const cacheKey = `user_data_${token}`;
                        if (!forceReload) {
                                const cached = await localforage.getItem<{
                                        data: User;
                                        timestamp: number;
                                }>(cacheKey);

                                // use cache if less than 30s old
                                if (cached && Date.now() - cached.timestamp < 30000) {
                                        await updateSettings({
                                                user: cached.data,
                                        });
                                        return;
                                }
                        }

                        const response = await fetch(`https://screenpi.pe/api/user`, {
                                method: "POST",
                                headers: {
                                        "Content-Type": "application/json",
                                },
                                body: JSON.stringify({ token }),
                        });

                        if (!response.ok) {
                                throw new Error("failed to verify token");
                        }

                        const data = await response.json();
                        const userData = {
                                ...data.user,
                        } as User;

                        // if user was not logged in, send posthog event app_login with email
                        if (!settings.user?.id) {
                                posthog.capture("app_login", {
                                        email: userData.email,
                                });
                        }

                        // cache the result
                        await localforage.setItem(cacheKey, {
                                data: userData,
                                timestamp: Date.now(),
                        });

                        await updateSettings({
                                user: userData,
                        });
                } catch (err) {
                        console.error("failed to load user:", err);
                        throw err;
                }
        };

	const reloadStore = async () => {
		const store = await getStore();
		await store.reload();

		const allKeys = await store.keys();
		const values: Record<string, any> = {};

		for (const k of allKeys) {
			values[k] = await store.get(k);
		}

                await updateSettings(unflattenObject(values));
        };

        return {
                settings,
                updateSettings,
                resetSettings,
                reloadStore,
                loadUser,
                resetSetting,
                getDataDir,
        };
}
