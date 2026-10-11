/** What pages are made of: a page, prose, a note, and an example with its source beside it. */
import type { CssDiagnostic } from 'blinc_ts/native';
import type { HostElement } from 'blinc_ts/native/host';
import { onCleanup, signal, useHost } from '#jsx/owner';
import { Show } from '#jsx/flow';
import type { Child, JsxNode } from '#jsx/jsx-runtime';
import { Tabs } from '../base-ui/tabs.js';
import { highlight, languageOf, type Language } from './highlight.js';
import { sourceOf, sourceOfFile } from './source.js';

export function Page(props: { title: string; lead?: string; children?: Child }): JsxNode {
  return (
    <div class="wiki-page">
      <h1>{props.title}</h1>
      {props.lead ? <p class="wiki-lead">{props.lead}</p> : null}
      {props.children}
    </div>
  );
}

export function Note(props: { children?: Child }): JsxNode {
  return <div class="wiki-note">{props.children}</div>;
}

/**
 * A view whose module is imported the first time it is shown, so what that module imports costs
 * nothing until a page shows it.
 */
export function lazy(load: () => Promise<{ default: () => Child }>): () => Child {
  return function Lazy() {
    const loaded = signal<{ view: () => Child } | undefined>(undefined);
    let ended = false;
    onCleanup(() => (ended = true));
    void load().then((module) => {
      if (!ended) {
        loaded.set({ view: module.default });
      }
    });
    return <Show when={loaded}>{(m: { view: () => Child }) => <m.view />}</Show>;
  };
}

/** A live example, in a pane with its source on the next tab. Each is a component of its own file. */
export function Example(props: { name: string; title?: string; view: () => Child }): JsxNode {
  const Demo = props.view;
  return (
    <div class="wiki-example">
      {props.title ? <div class="wiki-example-title">{props.title}</div> : null}
      <Tabs.Root defaultValue="preview" variant="underline">
        <Tabs.List>
          <Tabs.Tab value="preview">Preview</Tabs.Tab>
          <Tabs.Tab value="source">Source</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="preview" keepMounted class="wiki-example-preview">
          <Demo />
        </Tabs.Panel>
        <Tabs.Panel value="source" class="wiki-example-source">
          <CodeLines text={sourceOf(props.name)} language="ts" />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

/** A file of an adapter, or lines of it, quoted as it is in the repository, with where it is. */
export function SourceView(props: {
  file: string;
  from?: number;
  to?: number;
  title?: string;
  language?: Language;
}): JsxNode {
  const lines = props.from ? ` (lines ${props.from} to ${props.to ?? 'the end'})` : '';
  return (
    <div class="wiki-example">
      <div class="wiki-example-title">
        {props.title ?? props.file}
        {lines}
      </div>
      <div class="wiki-example-source">
        <CodeLines
          text={sourceOfFile(props.file, props.from, props.to)}
          language={props.language ?? languageOf(props.file)}
          first={props.from ?? 1}
        />
      </div>
    </div>
  );
}

/** The value of the control an event came from. */
export function valueOf(event: { target: unknown }): string {
  return (event.target as HostElement).value;
}

/** Code to read, as it is written: a command, a configuration, a short example. */
export function Code(props: { title?: string; language?: Language; children: string }): JsxNode {
  return (
    <div class="wiki-example">
      {props.title ? <div class="wiki-example-title">{props.title}</div> : null}
      <div class="wiki-example-source">
        <CodeLines
          text={props.children.replace(/^\n+|\n+$/g, '')}
          language={props.language ?? 'shell'}
          numbers={false}
        />
      </div>
    </div>
  );
}

/** A table of reference: a row of headings over rows of cells. */
export function Table(props: {
  head: readonly string[];
  rows: readonly (readonly Child[])[];
}): JsxNode {
  return (
    <table class="wiki-table">
      <thead>
        <tr>
          {props.head.map((h) => (
            <th>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <tr>
            {row.map((cell) => (
              <td>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Add `css` to the host for as long as the component that asks is built, and say what the engine
 * made of it. An example with a look of its own brings its sheet this way.
 */
export function useSheet(css: string, file: string): readonly CssDiagnostic[] {
  const host = useHost();
  const layout = host.layout;
  const sheet = layout.addStyleSheet(css, { file });
  // What the parser could not read goes where the host reports what it could not apply.
  for (const d of sheet.diagnostics) {
    host.reportStyleError(`${file}:${d.line}:${d.column}: ${d.message}`);
  }
  onCleanup(() => {
    if (!layout.disposed) {
      layout.removeStyleSheet(sheet);
    }
  });
  return sheet.diagnostics;
}

/**
 * Code, highlighted as Blinc's code widget does it: a gutter of line numbers beside the lines, each
 * a row of spans coloured by the kind of token they are, from the theme's colours.
 */
export function CodeLines(props: {
  text: string;
  language: Language;
  /** The number of the first line. */
  first?: number;
  numbers?: boolean;
}): JsxNode {
  const lines = highlight(props.text, props.language);
  const first = props.first ?? 1;
  return (
    <div class="wiki-code">
      {props.numbers === false ? null : (
        <div class="wiki-code-gutter">
          {lines.map((_, i) => (
            <span>{String(first + i)}</span>
          ))}
        </div>
      )}
      <div class="wiki-code-lines">
        {lines.map((spans) => (
          <div class="wiki-code-line">
            {spans.length === 0 ? (
              <span> </span>
            ) : (
              spans.map((span) =>
                span.kind ? (
                  <span class={`tok-${span.kind}`}>{span.text}</span>
                ) : (
                  <span>{span.text}</span>
                ),
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
