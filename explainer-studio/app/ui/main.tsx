import './styles.css';
import {createRoot} from 'react-dom/client';
import {App} from './App';

// Remotion's staticFile() resolves against this base; the app server serves only the build's audio and the bundled fonts there.
(window as unknown as {remotion_staticBase: string}).remotion_staticBase = '/media';
createRoot(document.getElementById('root')!).render(<App />);
