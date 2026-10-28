'use client';
import { useEffect, useState } from 'react';
import { inDesktopWindow } from './desktop';

export const INSTALL_CHANGED = 'uchiyomi-install-changed';
export interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
type InstallWindow = Window & { __yomiInstall?: InstallPrompt | null; __yomiInstalled?: boolean };
export function captureInstallPrompt(event: Event): void {
  event.preventDefault();
  (window as InstallWindow).__yomiInstall = event as InstallPrompt;
  window.dispatchEvent(new Event(INSTALL_CHANGED));
}

export function useInstallApp() {
  const [canInstall, setCanInstall] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const sync = () => {
      setCanInstall(!!(window as InstallWindow).__yomiInstall);
      setStandalone(display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true || inDesktopWindow() || (window as InstallWindow).__yomiInstalled === true);
    };
    const installed = () => {
      (window as InstallWindow).__yomiInstall = null;
      (window as InstallWindow).__yomiInstalled = true;
      window.dispatchEvent(new Event(INSTALL_CHANGED));
      setStandalone(true);
    };
    sync();
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    window.addEventListener(INSTALL_CHANGED, sync);
    window.addEventListener('appinstalled', installed);
    display.addEventListener('change', sync);
    return () => {
      window.removeEventListener(INSTALL_CHANGED, sync);
      window.removeEventListener('appinstalled', installed);
      display.removeEventListener('change', sync);
    };
  }, []);
  const install = async () => {
    const prompt = (window as InstallWindow).__yomiInstall;
    if (!prompt) return false;
    // Call in the click's activation, before yielding; a prompt is usable only once.
    try {
      await prompt.prompt();
      return (await prompt.userChoice).outcome === 'accepted';
    } finally {
      if ((window as InstallWindow).__yomiInstall === prompt) (window as InstallWindow).__yomiInstall = null;
      window.dispatchEvent(new Event(INSTALL_CHANGED));
    }
  };
  return { canInstall, standalone, isIOS, install };
}
