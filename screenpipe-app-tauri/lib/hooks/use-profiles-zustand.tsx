import { create } from 'zustand';
import { subscribeWithSelector, devtools } from 'zustand/middleware';
import { LazyStore } from '@tauri-apps/plugin-store';
import { localDataDir } from '@tauri-apps/api/path';
import { remove } from '@tauri-apps/plugin-fs';
import { createDefaultSettingsObject, type Settings } from './use-settings';

// Zustand profiles store interface
interface ProfilesStore {
  // State
  activeProfile: string;
  profiles: string[];
  shortcuts: Record<string, string>;
  isHydrated: boolean;
  
  // Actions
  setActiveProfile: (profile: string) => Promise<void>;
  createProfile: (data: { profileName: string; currentSettings: Settings }) => Promise<void>;
  deleteProfile: (profileName: string) => Promise<void>;
  updateShortcut: (data: { profile: string; shortcut: string }) => Promise<void>;
  
  // Internal
  _hydrate: () => Promise<void>;
  _persist: () => Promise<void>;
}

// Store utilities
let profilesStorePromise: Promise<LazyStore> | null = null;

const getProfilesStore = async () => {
  if (!profilesStorePromise) {
    profilesStorePromise = (async () => {
      const dir = await localDataDir();
      return new LazyStore(`${dir}/screenpipe/profiles.bin`, {
        autoSave: false,
      });
    })();
  }
  return profilesStorePromise;
};

// Persistence helpers
const persistProfiles = async (state: Pick<ProfilesStore, 'activeProfile' | 'profiles' | 'shortcuts'>) => {
  try {
    const store = await getProfilesStore();
    await store.set('activeProfile', state.activeProfile);
    await store.set('profiles', state.profiles);
    await store.set('shortcuts', state.shortcuts);
    await store.save();
  } catch (error) {
    console.error('Failed to persist profiles:', error);
    throw error;
  }
};

const loadPersistedProfiles = async (): Promise<{
  activeProfile: string;
  profiles: string[];
  shortcuts: Record<string, string>;
}> => {
  try {
    const store = await getProfilesStore();
    
    const activeProfile = ((await store.get('activeProfile')) as string) || 'default';
    const profiles = ((await store.get('profiles')) as string[]) || ['default'];
    const shortcuts = ((await store.get('shortcuts')) as Record<string, string>) || {};
    
    return { activeProfile, profiles, shortcuts };
  } catch (error) {
    console.error('Failed to load persisted profiles:', error);
    return {
      activeProfile: 'default' as string,
      profiles: ['default'] as string[],
      shortcuts: {} as Record<string, string>,
    };
  }
};

// Create the Zustand profiles store
export const useProfilesZustand = create<ProfilesStore>()(
  devtools(
    subscribeWithSelector(
      (set, get) => ({
        // Initial state
        activeProfile: 'default',
        profiles: ['default'],
        shortcuts: {},
        isHydrated: false,
        
        // Actions
        setActiveProfile: async (profile: string) => {
          set({ activeProfile: profile });
          await get()._persist();
        },
        
        createProfile: async ({ profileName, currentSettings }) => {
          const state = get();
          const newProfiles = [...state.profiles, profileName];
          
          set({ profiles: newProfiles });
          
          try {
            // Create a new settings store for the profile
            const dir = await localDataDir();
            const profileStore = new LazyStore(`${dir}/screenpipe/store-${profileName}.bin`, {
              autoSave: false,
            });
            
            // Copy current settings to the new profile
            for (const [key, value] of Object.entries(currentSettings)) {
              await profileStore.set(key, value);
            }
            await profileStore.save();
            
            // Persist profiles list
            await get()._persist();
          } catch (error) {
            // Rollback on error
            set({ profiles: state.profiles });
            console.error('Failed to create profile:', error);
            throw error;
          }
        },
        
        deleteProfile: async (profileName: string) => {
          if (profileName === 'default') {
            throw new Error('Cannot delete default profile');
          }
          
          const state = get();
          const newProfiles = state.profiles.filter(p => p !== profileName);
          const newShortcuts = { ...state.shortcuts };
          delete newShortcuts[profileName];
          
          set({ 
            profiles: newProfiles,
            shortcuts: newShortcuts,
            activeProfile: state.activeProfile === profileName ? 'default' : state.activeProfile
          });
          
          try {
            // Delete the profile store file
            const dir = await localDataDir();
            await remove(`${dir}/screenpipe/store-${profileName}.bin`);
            
            // Persist changes
            await get()._persist();
          } catch (error) {
            // Rollback on error
            set({ 
              profiles: state.profiles,
              shortcuts: state.shortcuts,
              activeProfile: state.activeProfile
            });
            console.error('Failed to delete profile:', error);
            throw error;
          }
        },
        
        updateShortcut: async ({ profile, shortcut }) => {
          const state = get();
          const newShortcuts = {
            ...state.shortcuts,
            [profile]: shortcut,
          };
          
          set({ shortcuts: newShortcuts });
          await get()._persist();
        },
        
        // Internal methods
        _hydrate: async () => {
          try {
            const persistedData = await loadPersistedProfiles();
            set({ 
              activeProfile: persistedData.activeProfile,
              profiles: persistedData.profiles,
              shortcuts: persistedData.shortcuts,
              isHydrated: true 
            });
          } catch (error) {
            console.error('Failed to hydrate profiles:', error);
            set({ 
              activeProfile: 'default',
              profiles: ['default'],
              shortcuts: {},
              isHydrated: true 
            });
          }
        },
        
        _persist: async () => {
          const state = get();
          await persistProfiles({
            activeProfile: state.activeProfile,
            profiles: state.profiles,
            shortcuts: state.shortcuts,
          });
        },
      })
    ),
    { name: 'profiles-store' }
  )
);

// Auto-hydrate on store creation
useProfilesZustand.getState()._hydrate();

// Export utility function for awaiting hydration
export const awaitProfilesHydration = async (): Promise<void> => {
  return new Promise((resolve) => {
    if (useProfilesZustand.getState().isHydrated) {
      resolve();
      return;
    }
    
    const unsubscribe = useProfilesZustand.subscribe(
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