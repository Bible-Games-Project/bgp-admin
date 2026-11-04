import { useCallback, useEffect, useRef, useState } from "react";

// Dictation with the browser's own speech recognition (Chrome, Edge and Safari have it;
// Firefox and the apps' WebViews don't, and then the microphone button isn't shown). The
// browser sends the audio to its speech service; the console only gets the words. The hook
// hands back the whole transcript so far each time it grows, in the browser's language.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, (new () => Recognition) | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation({
  onTranscript,
  onError,
}: {
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [supported] = useState(() => recognitionClass() !== null);
  const [listening, setListening] = useState(false);
  const current = useRef<Recognition | null>(null);
  const latest = useRef({ onTranscript, onError });
  latest.current = { onTranscript, onError };

  const start = useCallback(() => {
    const Recognition = recognitionClass();
    if (!Recognition || current.current) return;
    const recognition = new Recognition();
    recognition.lang = navigator.language || "es-ES";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      latest.current.onTranscript(text);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        latest.current.onError(
          "The browser didn't allow the microphone. Allow it for this site and try again.",
        );
      } else if (event.error !== "aborted" && event.error !== "no-speech") {
        latest.current.onError(`Dictation stopped (${event.error}).`);
      }
    };
    recognition.onend = () => {
      current.current = null;
      setListening(false);
    };
    try {
      recognition.start();
      current.current = recognition;
      setListening(true);
    } catch {
      latest.current.onError("Dictation couldn't start.");
    }
  }, []);

  const stop = useCallback(() => current.current?.stop(), []);
  useEffect(() => () => current.current?.abort(), []);

  return { supported, listening, start, stop };
}
