import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
}

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(display-mode: standalone)');
    setInstalled(media.matches || (navigator as any).standalone === true);
    setShowIosHint(isIosSafari());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || dismissed || (!promptEvent && !showIosHint)) return null;

  return (
    <div className="border-t bg-blue-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2 text-sm text-blue-950 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-medium">
          {promptEvent ? '避難ナビをホーム画面に追加できます。' : 'iPhoneでは共有ボタンから「ホーム画面に追加」を選択してください。'}
        </div>
        <div className="flex flex-wrap gap-2">
          {promptEvent && (
            <button
              type="button"
              className="min-h-[36px] rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-800"
              onClick={async () => {
                await promptEvent.prompt();
                await promptEvent.userChoice.catch(() => null);
                setPromptEvent(null);
              }}
            >
              ホーム画面に追加
            </button>
          )}
          <button
            type="button"
            className="min-h-[36px] rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-blue-900 ring-1 ring-blue-200 hover:bg-blue-100"
            onClick={() => setDismissed(true)}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
