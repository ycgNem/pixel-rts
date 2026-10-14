import { App } from './app/app';
import { quickMatch } from './app/title';
import type { MatchSetup } from './sim/types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const app = new App(canvas);
// debugging handle for e2e scripts and the console
(window as unknown as { __app: App }).__app = app;
(window as unknown as { __quick: (over?: Partial<MatchSetup>) => void }).__quick = (over) => quickMatch(app, over);
