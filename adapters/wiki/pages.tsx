/** The wiki's pages, section by section, in the order the navigation lists them. */
import { adaptersPages } from './pages/adapters.js';
import { baseUiPages } from './pages/base-ui.js';
import { elementsPages } from './pages/elements.js';
import { startPages } from './pages/start.js';
import { stylingPages } from './pages/styling.js';
import type { WikiPage } from './page.js';

export type { WikiPage } from './page.js';

export const pages: readonly WikiPage[] = [
  ...startPages,
  ...adaptersPages,
  ...elementsPages,
  ...stylingPages,
  ...baseUiPages,
];
