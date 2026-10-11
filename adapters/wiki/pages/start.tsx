/** The wiki's Start pages. */
import type { WikiPage } from '../page.js';
import { Note, Page } from '../kit.js';

export const startPages: readonly WikiPage[] = [
  {
    id: 'overview',
    title: 'Overview',
    section: 'Start',
    view: () => (
      <Page
        title="blinc_ts"
        lead="A TypeScript SDK for native UI: a host that holds a tree of elements, styled in Rust and drawn by the GPU, for any framework to drive."
      >
        <p>
          blinc_ts has no opinion about how you write a view. It gives you a <b>host</b>: a tree of
          elements, as a browser's document is, that you create, edit and listen to. A user-agent
          stylesheet gives them looks and the host gives them behaviour: buttons submit forms, a
          select opens a list, text is edited in place. CSS, parsed and applied in Rust, styles the
          tree from a theme's variables, and a native window shows it.
        </p>
        <p>
          What turns a framework's idea of a view into calls on the host is an <b>adapter</b>. The
          repository has two, a JSX runtime and a Vue renderer, and the <b>Adapters</b> pages
          explain how they work and how to write your own, for a framework or for no framework at
          all.
        </p>
        <Note>
          This wiki is a Blinc app, written with the JSX adapter, so each example is live: use it,
          then read the source on the next tab. The switch at the top changes the colour scheme.
        </Note>
      </Page>
    ),
  },
];
