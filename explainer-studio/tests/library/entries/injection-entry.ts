import React from 'react';
// @ts-expect-error react-dom ships no type declarations in this project
import {renderToStaticMarkup} from 'react-dom/server';
import {ChapterTag} from '../../../src/library/chapters';
import {PromptInjection} from '../../../src/library/scenes/PromptInjection';
import {PromptInjectionScene} from '../../../src/library/scenes/PromptInjectionTreatments';
import {InterfaceProof} from '../../../src/library/scenes/injection/Interface';
import {InvestigationProof} from '../../../src/library/scenes/injection/Investigation';
import {MechanismProof} from '../../../src/library/scenes/injection/Mechanism';
import {fontSetFor} from '../../../src/library/fonts';
import {ShotLayer, irisClip, wipeClip} from '../../../src/library/Shot';

const COMPONENTS = {baseline: PromptInjection, interface: InterfaceProof, investigation: InvestigationProof, mechanism: MechanismProof};
/** Which component the dispatcher draws for these props, by name. */
export const chosen = (props: any): string => {
  const el: any = (PromptInjectionScene as any)(props);
  return Object.entries(COMPONENTS).find(([, c]) => c === el.type)![0];
};
export const fonts = fontSetFor('pip-paper-bundled');
export const html = (props: any): string => renderToStaticMarkup(React.createElement(PromptInjectionScene as React.FC<any>, props));
export const tagHtml = (props: any): string => renderToStaticMarkup(React.createElement(ChapterTag, props));
export const shotHtml = (cam: any, clip: any, child: string): string => renderToStaticMarkup(React.createElement(ShotLayer, {cam, clip}, React.createElement('i', null, child)));
export {irisClip, wipeClip};
