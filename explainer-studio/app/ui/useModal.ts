// What every modal dialog needs from the keyboard: focus moves in, Tab stays inside, Escape closes from anywhere, focus goes back to what opened it.
import {useEffect, useRef} from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack: HTMLElement[] = [];

export function useModal<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const opener = useRef<Element | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = document.activeElement; // before autoFocus moves focus into the dialog
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    stack.push(box);
    if (!box.contains(document.activeElement)) (box.querySelector<HTMLElement>('[autofocus],[data-autofocus]') ?? box.querySelector<HTMLElement>(FOCUSABLE) ?? box).focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== box) return; // only the top-most dialog reacts
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) { e.preventDefault(); box.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      stack.splice(stack.indexOf(box), 1);
      const back = opener.current;
      if (back instanceof HTMLElement && back !== document.body && document.contains(back)) back.focus();
    };
  }, []);
  return ref;
}
