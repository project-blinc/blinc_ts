/** What the wiki gives the pages built under it. */
import type { ThemeState } from 'blinc_ts/theme';
import { createContext } from '#jsx/flow';

/** The theme the wiki is drawn in, for the examples that show or change it. */
export const WikiTheme = createContext<ThemeState>();
