import React from 'react';
// @ts-expect-error react-dom ships no type declarations in this project
import {renderToStaticMarkup} from 'react-dom/server';
import {ChapterHeader, StageStrip, FullPageTakeaway} from '../../../src/library/chapters';

const parts = {ChapterHeader, StageStrip, FullPageTakeaway};
/** Rendered inside the bundle so the component and the renderer share one copy of React. */
export const html = (part: keyof typeof parts, props: any): string => renderToStaticMarkup(React.createElement(parts[part] as React.FC<any>, props));
