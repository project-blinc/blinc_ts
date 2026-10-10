/** What pages are made of: a page, prose, a note, and an example with its source beside it. */
import type { HostElement } from 'blinc_ts/native/host';
import type { Child, JsxNode } from '#jsx/jsx-runtime';
import { Tabs } from '../base-ui/tabs.js';
import { sourceOf } from './source.js';

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
          <pre>
            <code>{sourceOf(props.name)}</code>
          </pre>
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

/** The value of the control an event came from. */
export function valueOf(event: { target: unknown }): string {
  return (event.target as HostElement).value;
}
