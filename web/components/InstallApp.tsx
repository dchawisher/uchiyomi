'use client';
import { useState } from 'react';
import { useInstallApp } from '@/lib/installApp';
import { t as tr } from '@/lib/i18n';

export function InstallApp({ compact = false }: { compact?: boolean }) {
  const { canInstall, standalone, isIOS, install } = useInstallApp();
  const [help, setHelp] = useState(!compact);
  const [failed, setFailed] = useState(false);
  if (standalone) return null;
  return <div data-install-app className="min-w-0">
    <button type="button" className={compact ? 'w-full rounded-lg px-2 py-2 text-start text-sm text-fog-200 hover:bg-ink-800/70' : 'btn-accent px-4 py-2 text-sm'}
      onClick={() => {
        setHelp(true); setFailed(false);
        if (canInstall) void install().catch(() => setFailed(true));
      }}>{tr('Install Uchiyomi')}</button>
    {help && <p className="mt-2 max-w-prose text-sm text-fog-400" role={failed ? 'status' : undefined}>
      {isIOS ? tr('Tap Share in Safari, then Add to Home Screen.')
        : canInstall && !failed ? tr('Tap Install Uchiyomi to open the browser’s installation dialog.')
        : tr('In Android Chrome, tap ⋮, then Add to Home screen → Install. On desktop, use the install icon in the address bar. Open this site in Chrome itself, not inside another app.')}
    </p>}
  </div>;
}
