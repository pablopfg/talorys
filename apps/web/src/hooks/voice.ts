import { useCallback, useEffect, useRef, useState } from "react";
import { TRANSCRIPTION_LIMITS } from "@talorys/shared";

/** Types Whisper decodes, in order of preference: Opus where the browser records it, else AAC (Safari). */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

export type VoiceState = "idle" | "starting" | "recording";
export type VoiceError = "denied" | "unavailable";

/** Whether this browser can record audio here (it needs a secure page and MediaRecorder). */
export function voiceSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

function pickMimeType(): string | undefined {
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Records one clip from the microphone. `stop()` hands the clip to `onClip`; `cancel()` drops it.
 * Recording stops on its own at TRANSCRIPTION_LIMITS.maxClipSeconds, and the microphone is released
 * as soon as recording ends or the component unmounts.
 */
export function useVoiceRecorder({ onClip, onError }: { onClip: (clip: Blob) => void; onError: (error: VoiceError) => void }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const keep = useRef(false);
  const handlers = useRef({ onClip, onError });
  handlers.current = { onClip, onError };

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    recorder.current = null;
    setState("idle");
    setSeconds(0);
  }, []);

  const finish = useCallback((save: boolean) => {
    keep.current = save;
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
    else release();
  }, [release]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setState("starting");
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      setState("idle");
      handlers.current.onError(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "unavailable");
      return;
    }
    stream.current = media;
    const mimeType = pickMimeType();
    const r = new MediaRecorder(media, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    r.onstop = () => {
      const clip = new Blob(chunks, { type: r.mimeType || mimeType || "audio/webm" });
      release();
      if (keep.current && clip.size > 0) handlers.current.onClip(clip);
    };
    recorder.current = r;
    keep.current = false;
    r.start();
    setState("recording");
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= TRANSCRIPTION_LIMITS.maxClipSeconds) finish(true);
    }, 250);
  }, [state, release, finish]);

  // Leaving the page drops the recording and turns the microphone off.
  useEffect(() => () => {
    keep.current = false;
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
    if (timer.current) clearInterval(timer.current);
    for (const track of stream.current?.getTracks() ?? []) track.stop();
  }, []);

  return { state, seconds, start, stop: () => finish(true), cancel: () => finish(false) };
}

/** The clip as plain base64, the form the transcription API takes. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
