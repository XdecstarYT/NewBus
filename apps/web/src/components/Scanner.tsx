import { useEffect, useRef, useState } from 'react';

/** In-app QR scanner (uses the browser's BarcodeDetector where available). */
export function Scanner({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't scan inside the game. Open your phone's camera app and point it at the QR code instead - it will open the package page for you.");
      return;
    }
    let stream: MediaStream | null = null;
    let stop = false;
    const detector = new Detector({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            if (found[0]?.rawValue) return onCode(found[0].rawValue);
          } catch {}
          setTimeout(loop, 250);
        };
        loop();
      })
      .catch(() => setError('Camera permission was denied. You can still type the code, or use your phone camera app.'));
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm">{error}</p> : <video ref={video} className="w-full rounded-2xl bg-black aspect-square object-cover" muted playsInline aria-label="Camera preview" />}
      <button className="btn-ghost btn-sm self-center" onClick={onClose}>Close camera</button>
    </div>
  );
}
