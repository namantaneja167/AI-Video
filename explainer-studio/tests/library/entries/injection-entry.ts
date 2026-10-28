import React from 'react';
// @ts-expect-error react-dom ships no type declarations in this project
import {renderToStaticMarkup} from 'react-dom/server';
import {ChapterTag} from '../../../src/library/chapters';
import {PromptInjection} from '../../../src/library/scenes/PromptInjection';
import {PromptInjectionScene} from '../../../src/library/scenes/PromptInjectionTreatments';
import {InterfaceProof} from '../../../src/library/scenes/injection/Interface';
import {InvestigationProof} from '../../../src/library/scenes/injection/Investigation';
import {MechanismProof} from '../../../src/library/scenes/injection/Mechanism';
import {InterfaceProofR2, INTERFACE_ANSWER, INTERFACE_FRAME, interfaceKeys} from '../../../src/library/scenes/injection/InterfaceR2';
import {InvestigationProofR2} from '../../../src/library/scenes/injection/InvestigationR2';
import {MECHANISM_ANSWER_A, MECHANISM_ANSWER_B, MECHANISM_FRAME, MechanismProofR2, mechanismKeys, overviewHint} from '../../../src/library/scenes/injection/MechanismR2';
import {camRect, camTrack, rectCentre} from '../../../src/library/motion';
import {fontSetFor} from '../../../src/library/fonts';
import {ShotLayer, irisClip, wipeClip} from '../../../src/library/Shot';

const COMPONENTS = {baseline: PromptInjection, interface: InterfaceProof, investigation: InvestigationProof, mechanism: MechanismProof, 'interface-r2': InterfaceProofR2, 'investigation-r2': InvestigationProofR2, 'mechanism-r2': MechanismProofR2};
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

/** Visible words of a rendered frame: a proxy for how many labels compete for attention. */
export const visibleText = (props: any): string => html(props).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
/** Is this world rectangle fully inside the viewport at time t, through the scene's own camera? */
const inside = (cam: any, rect: any, frame: any) => { const r = camRect(cam, rect, rectCentre(frame)); return r.x >= frame.x - 0.5 && r.y >= frame.y - 0.5 && r.x + r.w <= frame.x + frame.w + 0.5 && r.y + r.h <= frame.y + frame.h + 0.5; };
export const interfaceShows = (q: any, from: number, t: number) => inside(camTrack(t, interfaceKeys(q, from)), INTERFACE_ANSWER, INTERFACE_FRAME);
export const mechanismShows = (q: any, from: number, t: number) => { const cam = camTrack(t, mechanismKeys(q, from)); return {a: inside(cam, MECHANISM_ANSWER_A, MECHANISM_FRAME), b: inside(cam, MECHANISM_ANSWER_B, MECHANISM_FRAME), hint: overviewHint(cam.k)}; };
