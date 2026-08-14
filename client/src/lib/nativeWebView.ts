type NativeHandler = (name: string, payload?: unknown) => Promise<unknown>;

declare global {
  interface Window {
    flutter_inappwebview?: { callHandler: NativeHandler };
  }
}

function nativeBridge(): { callHandler: NativeHandler } | null {
  return window.flutter_inappwebview ?? null;
}

export async function shareWithNative(text: string): Promise<boolean> {
  const bridge = nativeBridge();
  if (!bridge || !text.trim()) return false;
  try {
    await bridge.callHandler('omNative', { action: 'share', text });
    return true;
  } catch {
    return false;
  }
}

export async function vibrateWithNative(): Promise<boolean> {
  const bridge = nativeBridge();
  if (!bridge) return false;
  try {
    await bridge.callHandler('omNative', { action: 'vibrate' });
    return true;
  } catch {
    return false;
  }
}

export async function openWithNativeBrowser(rawUrl: string): Promise<boolean> {
  const bridge = nativeBridge();
  if (!bridge) return false;
  try {
    const url = new URL(rawUrl, window.location.href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    await bridge.callHandler('omNative', { action: 'openExternal', url: url.toString() });
    return true;
  } catch {
    return false;
  }
}
