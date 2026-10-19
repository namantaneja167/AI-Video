// The playhead lives outside React state so that 30 frames a second do not re-render the whole editor.
import {useSyncExternalStore} from 'react';

export class Playhead {
  frame = 0;
  playing = false;
  private listeners = new Set<() => void>();
  set(frame: number, playing: boolean) {
    if (frame === this.frame && playing === this.playing) return;
    this.frame = frame;
    this.playing = playing;
    this.listeners.forEach((l) => l());
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
}
export const useFrame = (p: Playhead): number => useSyncExternalStore(p.subscribe, () => p.frame);
export const usePlaying = (p: Playhead): boolean => useSyncExternalStore(p.subscribe, () => p.playing);
