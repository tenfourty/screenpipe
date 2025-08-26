import { create } from 'zustand';
import { subscribeWithSelector, devtools } from 'zustand/middleware';
import { LazyStore } from '@tauri-apps/plugin-store';
import { localDataDir } from '@tauri-apps/api/path';
import { platform } from '@tauri-apps/plugin-os';
import { rename, remove, exists } from '@tauri-apps/plugin-fs';
import merge from 'lodash/merge';
import type { Settings, User, AIPreset } from './use-settings';
import { createDefaultSettingsObject } from './use-settings';

// Zustand store interface
interface SettingsStore {
  // State
  settings: Settings;
  isHydrated: boolean;
  
  // Actions
  updateSettings: (update: Partial<Settings>) => Promise<void>;
  resetSettings: () => Promise<void>;
  resetSetting: (key: keyof Settings) => Promise<void>;
  loadUser: (token: string, forceReload?: boolean) => Promise<void>;
  reloadStore: () => Promise<void>;
  
  // Internal
  _hydrate: () => Promise<void>;
  _persist: (settings: Partial<Settings>) => Promise<void>;
}

// Store persistence utilities
let storePromise: Promise<LazyStore> | null = null;

export const getZustandStore = async () => {
  if (!storePromise) {
    storePromise = (async () => {
      const dir = await localDataDir();
      const profilesStore = new LazyStore(`${dir}/screenpipe/profiles.bin`, {
        autoSave: false,
      });
      const activeProfile = 
        (await profilesStore.get('activeProfile')) || 'default';
      const file = 
        activeProfile === 'default'
          ? `store.bin`
          : `store-${activeProfile}.bin`;
      return new LazyStore(`${dir}/screenpipe/${file}`, {
        autoSave: false,
      });
    })();
  }
  return storePromise;
};

export const resetZustandStore = () => {
  storePromise = null;
};

// Simplified persistence - no complex flattening needed
const persistSettings = async (settings: Partial<Settings>) => {
  try {
    const store = await getZustandStore();
    
    // Save each top-level setting
    for (const [key, value] of Object.entries(settings)) {
      await store.set(key, value);
    }
    
    await store.save();
  } catch (error) {
    console.error('Failed to persist settings:', error);
    throw error;
  }
};

const loadPersistedSettings = async (): Promise<Partial<Settings>> => {
  try {
    const store = await getZustandStore();
    const keys = await store.keys();
    const settings: Record<string, any> = {};
    
    for (const key of keys) {
      settings[key] = await store.get(key);
    }
    
    return settings;
  } catch (error) {
    console.error('Failed to load persisted settings:', error);
    return {};
  }
};

// User loading functionality
const loadUserData = async (token: string): Promise<Partial<User>> => {
  try {
    // This would typically be an API call
    // For now, return empty object
    return {};
  } catch (error) {
    console.error('Failed to load user data:', error);
    return {};
  }
};

// Create the Zustand store
export const useSettingsZustand = create<SettingsStore>()(
  devtools(
    subscribeWithSelector(
      (set, get) => ({
        // Initial state
        settings: createDefaultSettingsObject(),
        isHydrated: false,
        
        // Actions
        updateSettings: async (update: Partial<Settings>) => {
          const currentSettings = get().settings;
          const newSettings = merge({}, currentSettings, update);
          
          // Update state immediately for optimistic updates
          set({ settings: newSettings });
          
          // Persist in background
          try {
            await get()._persist(update);
          } catch (error) {
            // Rollback on persistence error
            set({ settings: currentSettings });
            throw error;
          }
        },
        
        resetSettings: async () => {
          const defaultSettings = createDefaultSettingsObject();
          set({ settings: defaultSettings });
          
          try {
            await get()._persist(defaultSettings);
          } catch (error) {
            console.error('Failed to persist reset settings:', error);
            throw error;
          }
        },
        
        resetSetting: async (key: keyof Settings) => {
          const defaultSettings = createDefaultSettingsObject();
          const currentSettings = get().settings;
          const newSettings = {
            ...currentSettings,
            [key]: defaultSettings[key],
          };
          
          set({ settings: newSettings });
          
          try {
            await get()._persist({ [key]: defaultSettings[key] });
          } catch (error) {
            // Rollback on error
            set({ settings: currentSettings });
            throw error;
          }
        },
        
        loadUser: async (token: string, forceReload = false) => {
          try {
            const userData = await loadUserData(token); // TODO: Implement forceReload logic
            const currentSettings = get().settings;
            const newSettings = {
              ...currentSettings,
              user: merge({}, currentSettings.user, userData),
            };
            
            set({ settings: newSettings });
            await get()._persist({ user: newSettings.user });
          } catch (error) {
            console.error('Failed to load user:', error);
            throw error;
          }
        },
        
        reloadStore: async () => {
          resetZustandStore();
          await get()._hydrate();
        },
        
        // Internal methods
        _hydrate: async () => {
          try {
            const persistedSettings = await loadPersistedSettings();
            const defaultSettings = createDefaultSettingsObject();
            const hydratedSettings = merge({}, defaultSettings, persistedSettings);
            
            set({ 
              settings: hydratedSettings,
              isHydrated: true 
            });
          } catch (error) {
            console.error('Failed to hydrate settings:', error);
            set({ 
              settings: createDefaultSettingsObject(),
              isHydrated: true 
            });
          }
        },
        
        _persist: async (update: Partial<Settings>) => {
          await persistSettings(update);
        },
      })
    ),
    { name: 'settings-store' }
  )
);

// Auto-hydrate on store creation
useSettingsZustand.getState()._hydrate();

// Export utility function for awaiting hydration
export const awaitZustandHydration = async (): Promise<void> => {
  return new Promise((resolve) => {
    if (useSettingsZustand.getState().isHydrated) {
      resolve();
      return;
    }
    
    const unsubscribe = useSettingsZustand.subscribe(
      (state) => state.isHydrated,
      (isHydrated) => {
        if (isHydrated) {
          unsubscribe();
          resolve();
        }
      }
    );
  });
};