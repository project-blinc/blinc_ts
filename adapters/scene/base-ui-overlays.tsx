import type { Signal } from 'blinc_ts/native';
import type { HostElement } from 'blinc_ts/native/host';
import type { Child } from '#jsx/jsx-runtime';
import { Dialog } from '../base-ui/dialog.js';
import { Popover } from '../base-ui/popover.js';
import { Tooltip } from '../base-ui/tooltip.js';

export interface Shared {
  open: Signal<boolean>;
  text: Signal<string>;
  delay: number;
  log: string[];
  refs: Record<string, HostElement>;
}

const ref = (s: Shared, name: string) => (e: HostElement) => {
  s.refs[name] = e;
};

export const tooltip = (s: Shared): Child => (
  <div style={{ position: 'absolute', left: 150, top: 150 }}>
    <Tooltip.Root delay={s.delay} onOpenChange={(o) => s.log.push(`tip:${o}`)}>
      <Tooltip.Trigger ref={ref(s, 'trigger')}>Hover me</Tooltip.Trigger>
      <Tooltip.Popup ref={ref(s, 'popup')} side="top">
        {() => s.text.get()}
      </Tooltip.Popup>
    </Tooltip.Root>
  </div>
);

export const popover = (s: Shared): Child => (
  <div style={{ position: 'absolute', left: 100, top: 50 }}>
    <Popover.Root open={s.open} onOpenChange={(o) => s.log.push(`popover:${o}`)}>
      <Popover.Trigger ref={ref(s, 'trigger')}>Open</Popover.Trigger>
      <Popover.Popup ref={ref(s, 'popup')} side="bottom" align="start">
        <Popover.Title>Title</Popover.Title>
        <Popover.Description>{() => s.text.get()}</Popover.Description>
        <button id="inner" ref={ref(s, 'inner')}>
          Inner
        </button>
        <Popover.Close ref={ref(s, 'close')}>Close</Popover.Close>
      </Popover.Popup>
    </Popover.Root>
    <button id="after" ref={ref(s, 'after')}>
      After
    </button>
  </div>
);

export const dialog = (s: Shared): Child => (
  <div>
    <Dialog.Root
      open={s.open}
      onOpenChange={(o) => s.log.push(`dialog:${o}`)}
      dismissible={() => s.text.get() !== 'locked'}
    >
      <Dialog.Trigger ref={ref(s, 'trigger')}>Open</Dialog.Trigger>
      <Dialog.Popup ref={ref(s, 'popup')}>
        <Dialog.Title>Sure?</Dialog.Title>
        <Dialog.Description>This cannot be undone.</Dialog.Description>
        <button id="first" ref={ref(s, 'first')}>
          First
        </button>
        <Dialog.Close ref={ref(s, 'close')}>Close</Dialog.Close>
      </Dialog.Popup>
    </Dialog.Root>
    <button id="behind" ref={ref(s, 'behind')}>
      Behind
    </button>
  </div>
);
