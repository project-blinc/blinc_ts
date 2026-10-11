import type { Child } from '#jsx/jsx-runtime';

/** A page of the wiki: where it is in the navigation, and what it shows. */
export interface WikiPage {
  readonly id: string;
  readonly title: string;
  readonly section: string;
  readonly view: () => Child;
}
