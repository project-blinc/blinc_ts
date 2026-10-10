import type { Signal } from 'blinc_ts/native';
import type { HostElement } from 'blinc_ts/native/host';
import type { Child } from '#jsx/jsx-runtime';
import { Accordion } from '../base-ui/accordion.js';
import { Collapsible } from '../base-ui/collapsible.js';
import { Tabs } from '../base-ui/tabs.js';
import { Checkbox, Switch, Toggle } from '../base-ui/toggle.js';

const check = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5 5 9l4.5-5.5"/></svg>',
)}`;

export interface Showcase {
  tab: Signal<string>;
  refs: Record<string, HostElement>;
}

/** Every part, in the states a page shows them in. */
export const showcase = (s: Showcase): Child => (
  <div
    style={{ position: 'absolute', left: 16, top: 16, width: 440, gap: 18 }}
    ref={(e: HostElement) => {
      s.refs.page = e;
    }}
  >
    <div style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Toggle>Bold</Toggle>
      <Toggle defaultPressed>Italic</Toggle>
      <Toggle disabled>Disabled</Toggle>
      <Switch.Root ref={(e: HostElement) => (s.refs.off = e)}>
        <Switch.Thumb ref={(e: HostElement) => (s.refs['off-thumb'] = e)} />
      </Switch.Root>
      <Switch.Root defaultChecked ref={(e: HostElement) => (s.refs.on = e)}>
        <Switch.Thumb ref={(e: HostElement) => (s.refs['on-thumb'] = e)} />
      </Switch.Root>
      <Checkbox.Root ref={(e: HostElement) => (s.refs.unchecked = e)}>
        <Checkbox.Indicator>
          <img src={check} style={{ width: 12, height: 12 }} />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <Checkbox.Root defaultChecked ref={(e: HostElement) => (s.refs.checked = e)}>
        <Checkbox.Indicator>
          <img src={check} style={{ width: 12, height: 12 }} />
        </Checkbox.Indicator>
      </Checkbox.Root>
    </div>
    <Tabs.Root value={s.tab}>
      <Tabs.List ref={(e: HostElement) => (s.refs.list = e)}>
        <Tabs.Tab value="overview" ref={(e: HostElement) => (s.refs.overview = e)}>
          Overview
        </Tabs.Tab>
        <Tabs.Tab value="api" ref={(e: HostElement) => (s.refs.api = e)}>
          API
        </Tabs.Tab>
        <Tabs.Tab value="examples" disabled>
          Examples
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="overview">Parts that draw nothing of their own.</Tabs.Panel>
      <Tabs.Panel value="api">State is shared as a signal.</Tabs.Panel>
    </Tabs.Root>
    <Accordion.Root defaultValue={['one']}>
      <Accordion.Item value="one">
        <Accordion.Header>
          <Accordion.Trigger>What is a part?</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>An element with a class and the state it is in.</Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="two">
        <Accordion.Header>
          <Accordion.Trigger>How is it styled?</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>By the sheet, from the theme's variables.</Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
    <Collapsible.Root defaultOpen>
      <Collapsible.Trigger>Details</Collapsible.Trigger>
      <Collapsible.Panel>Shown while open.</Collapsible.Panel>
    </Collapsible.Root>
  </div>
);
