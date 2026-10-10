import type { HostElement } from 'blinc_ts/native/host';
import type { Child } from '#jsx/jsx-runtime';
import { Collapsible } from '../base-ui/collapsible.js';
import { Check } from '../base-ui/icons.js';
import { Tabs } from '../base-ui/tabs.js';
import { Checkbox, Switch } from '../base-ui/toggle.js';

export type Refs = Record<string, HostElement>;

const ref = (refs: Refs, name: string) => (e: HostElement) => {
  refs[name] = e;
};

/** One of each part that moves as its state changes, apart from one another. */
export const motion = (refs: Refs): Child => (
  <div style={{ position: 'absolute', left: 20, top: 20, width: 360, gap: 24 }}>
    <div style={{ flexDirection: 'row', gap: 24, alignItems: 'center' }}>
      <Switch.Root ref={ref(refs, 'switch')}>
        <Switch.Thumb />
      </Switch.Root>
      <Checkbox.Root ref={ref(refs, 'checkbox')}>
        <Checkbox.Indicator keepMounted>
          <Check />
        </Checkbox.Indicator>
      </Checkbox.Root>
    </div>
    <Tabs.Root defaultValue="a">
      <Tabs.List ref={ref(refs, 'tray')}>
        <Tabs.Tab value="a" ref={ref(refs, 'a')}>
          Apples
        </Tabs.Tab>
        <Tabs.Tab value="b" ref={ref(refs, 'b')}>
          Bananas
        </Tabs.Tab>
      </Tabs.List>
    </Tabs.Root>
    <Collapsible.Root ref={ref(refs, 'collapsible')}>
      <Collapsible.Trigger ref={ref(refs, 'trigger')}>More</Collapsible.Trigger>
      <Collapsible.Panel ref={ref(refs, 'panel')}>
        <p style={{ margin: 0, width: 300 }}>
          A panel with enough text in it that it has height of its own, and a second line of it too.
        </p>
      </Collapsible.Panel>
    </Collapsible.Root>
    <div
      ref={ref(refs, 'below')}
      style={{ width: 120, height: 16, background: 'var(--primary)' }}
    />
  </div>
);
