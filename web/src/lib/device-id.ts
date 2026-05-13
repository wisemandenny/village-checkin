const STORAGE_KEY = "studio_device_id";

export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setDeviceId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}

export function getOrCreateDeviceId(): { deviceId: string; isNew: boolean } {
  const existing = getDeviceId();
  if (existing) return { deviceId: existing, isNew: false };

  const deviceId = crypto.randomUUID();
  setDeviceId(deviceId);
  return { deviceId, isNew: true };
}
