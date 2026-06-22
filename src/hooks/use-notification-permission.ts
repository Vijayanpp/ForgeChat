"use client";

import { useState, useCallback } from "react";

/**
 * Manages browser Notification API permission state.
 *
 * Returns the current permission ("default" | "granted" | "denied")
 * and a `request` function that prompts the user and updates state.
 *
 * Safe to call in SSR — guards against `Notification` being undefined.
 */
export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof Notification === "undefined") return "default";
    return Notification.permission;
  });

  const request = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  const isSupported = typeof Notification !== "undefined";

  return { permission, request, isSupported };
}
