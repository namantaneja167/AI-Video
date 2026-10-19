// @types/react-dom is not a dependency (none were added for this slice); this is the one call the app makes.
declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment): {render(node: import('react').ReactNode): void; unmount(): void};
}
