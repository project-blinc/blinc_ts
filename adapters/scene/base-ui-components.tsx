import type { Signal } from 'blinc_ts/native';
import type { HostElement } from 'blinc_ts/native/host';
import type { Child } from '#jsx/jsx-runtime';
import { Accordion } from '../base-ui/accordion.js';
import { Collapsible } from '../base-ui/collapsible.js';
import { Tabs } from '../base-ui/tabs.js';
import { Checkbox, Switch, Toggle } from '../base-ui/toggle.js';

/** What the views below read, the test writes, and the parts report. */
export interface Shared {
  flag: Signal<boolean>;
  value: Signal<string>;
  list: Signal<readonly string[]>;
  log: string[];
  refs: Record<string, HostElement>;
}

const ref = (shared: Shared, name: string) => (e: HostElement) => {
  shared.refs[name] = e;
};

export const toggles = (s: Shared): Child => (
  <div ref={ref(s, 'toggles')}>
    <Toggle
      ref={ref(s, 'toggle')}
      class="mine"
      onClick={() => s.log.push('click')}
      onPressedChange={(p) => s.log.push(`pressed:${p}`)}
    >
      Bold
    </Toggle>
    <Switch.Root
      ref={ref(s, 'switch')}
      checked={s.flag}
      onCheckedChange={(c) => s.log.push(`switch:${c}`)}
    >
      <Switch.Thumb ref={ref(s, 'thumb')} />
    </Switch.Root>
    <Switch.Root ref={ref(s, 'off')} disabled defaultChecked />
    <Switch.Root ref={ref(s, 'locked')} readOnly defaultChecked />
    <Checkbox.Root ref={ref(s, 'box')} indeterminate={() => s.value.get() === 'mixed'}>
      <Checkbox.Indicator ref={ref(s, 'tick')}>
        <i id="mark" />
      </Checkbox.Indicator>
    </Checkbox.Root>
    <Toggle
      ref={ref(s, 'fixed')}
      pressed={() => s.flag.get()}
      onPressedChange={(p) => s.log.push(`ask:${p}`)}
    />
  </div>
);

export const collapsible = (s: Shared): Child => (
  <div>
    <Collapsible.Root
      ref={ref(s, 'root')}
      open={s.flag}
      onOpenChange={(o) => s.log.push(`open:${o}`)}
    >
      <Collapsible.Trigger ref={ref(s, 'trigger')}>More</Collapsible.Trigger>
      <Collapsible.Panel ref={ref(s, 'panel')}>
        <p id="body">Hidden until open</p>
      </Collapsible.Panel>
    </Collapsible.Root>
    <Collapsible.Root defaultOpen>
      <Collapsible.Panel keepMounted ref={ref(s, 'kept')}>
        <p id="kept-body">Kept</p>
      </Collapsible.Panel>
    </Collapsible.Root>
  </div>
);

export const accordion = (s: Shared): Child => (
  <Accordion.Root ref={ref(s, 'root')} value={s.list} onValueChange={(v) => s.log.push(v.join())}>
    {['a', 'b', 'c'].map((name) => (
      <Accordion.Item value={name} disabled={name === 'b'}>
        <Accordion.Header>
          <Accordion.Trigger ref={ref(s, `trigger-${name}`)}>{`Item ${name}`}</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel ref={ref(s, `panel-${name}`)}>{`Body ${name}`}</Accordion.Panel>
      </Accordion.Item>
    ))}
  </Accordion.Root>
);

export const multiple = (s: Shared): Child => (
  <Accordion.Root ref={ref(s, 'root')} multiple defaultValue={['x']}>
    {['x', 'y'].map((name) => (
      <Accordion.Item value={name}>
        <Accordion.Trigger ref={ref(s, `trigger-${name}`)}>{name}</Accordion.Trigger>
        <Accordion.Panel>{`Body ${name}`}</Accordion.Panel>
      </Accordion.Item>
    ))}
  </Accordion.Root>
);

export const tabs = (s: Shared): Child => (
  <Tabs.Root ref={ref(s, 'root')} value={s.value} onValueChange={(v) => s.log.push(v)}>
    <Tabs.List ref={ref(s, 'list')} activateOnFocus={s.flag.peek()}>
      <Tabs.Tab value="one" ref={ref(s, 'one')}>
        One
      </Tabs.Tab>
      <Tabs.Tab value="two" disabled ref={ref(s, 'two')}>
        Two
      </Tabs.Tab>
      <Tabs.Tab value="three" ref={ref(s, 'three')}>
        Three
      </Tabs.Tab>
      <Tabs.Tab value="four" ref={ref(s, 'four')}>
        Four
      </Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="one" ref={ref(s, 'panel-one')}>
      First
    </Tabs.Panel>
    <Tabs.Panel value="two">Second</Tabs.Panel>
    <Tabs.Panel value="three" ref={ref(s, 'panel-three')}>
      Third
    </Tabs.Panel>
    <Tabs.Panel value="four">Fourth</Tabs.Panel>
  </Tabs.Root>
);

/** Tabs holding their own state, the first tab's by default. */
export const uncontrolledTabs = (s: Shared): Child => (
  <Tabs.Root ref={ref(s, 'root')} orientation="vertical">
    <Tabs.List ref={ref(s, 'list')}>
      <Tabs.Tab value="a" ref={ref(s, 'a')}>
        A
      </Tabs.Tab>
      <Tabs.Tab value="b" ref={ref(s, 'b')}>
        B
      </Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="a">Panel a</Tabs.Panel>
    <Tabs.Panel value="b">Panel b</Tabs.Panel>
  </Tabs.Root>
);
