import { Settings } from "@/lib/hooks/use-settings";

/**
 * Helper function to update settings and ensure they are persisted to the Tauri store
 * This should be used instead of calling updateSettings directly to ensure persistence
 */
export const updateSettingsWithPersistence = async (
  updateSettings: (settings: Partial<Settings>) => Promise<void>,
  newSettings: Partial<Settings>
): Promise<void> => {
  await updateSettings(newSettings);
  
  // Manual save to Tauri store to ensure persistence
  try {
    const { getStore } = await import('@/lib/hooks/use-settings');
    const store = await getStore();
    
    // Brief delay for state update
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Save the updated settings
    for (const [key, value] of Object.entries(newSettings)) {
      await store.set(key, value);
    }
    await store.save();
  } catch (error) {
    console.error('Failed to manually save settings:', error);
  }
};